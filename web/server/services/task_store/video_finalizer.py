# -*- coding: utf-8 -*-
"""
Video 任务收尾线程（Video Finalizer）

将原 `GET /api/tasks` 中的 Vidu 查询、视频下载、episode.json 写回迁移到后台循环，
避免读接口产生副作用。

仅处理 `kind=video` 且 `status=awaiting_external` 的任务；幂等：若候选已有 videoPath 则跳过写盘。
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional

import requests

from . import repository
from .db import get_connection
from .models import TaskRow
from .service import get_task_store

_LOG = logging.getLogger(__name__)

# 轮询间隔（秒）；略缩短以便尽快把 awaiting_external 收敛为 success/failed
_POLL_INTERVAL_SEC = 5.0

# 无 Vidu 客户端时只打一次告警，避免刷屏
_warned_no_vidu_client = False

_thread: Optional[threading.Thread] = None
_stop = threading.Event()


def _get_vidu_client():
    try:
        from src.vidu.client import ViduClient
    except ImportError:
        return None
    key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not key:
        return None
    return ViduClient(api_key=key)


def _extract_creation_video_url(vt: dict) -> Optional[str]:
    cr = vt.get("creations")
    if cr is None:
        return None
    if isinstance(cr, list) and len(cr) > 0:
        return cr[0].get("url") or cr[0].get("watermarked_url")
    if isinstance(cr, dict):
        return cr.get("url") or cr.get("watermarked_url")
    return None


def _finalize_one_task(task: TaskRow) -> None:
    """
    对单条 awaiting_external 的 video 任务：查 Vidu、下载、更新 episode、更新 SQLite。
    """
    from services import data_service

    meta = task.result or {}
    vidu_id = meta.get("vidu_task_id") or task.external_task_id
    episode_id = task.episode_id
    shot_id = task.shot_id
    candidate_id = task.candidate_id
    task_id = task.id

    if not vidu_id or not episode_id or not shot_id or not candidate_id:
        get_task_store().set_task(
            task_id,
            "failed",
            kind="video",
            episode_id=episode_id,
            shot_id=shot_id,
            candidate_id=candidate_id,
            result=meta,
            error="任务缺少 Vidu 或分镜元数据，无法收尾",
        )
        return

    # 幂等：episode 里该候选已有视频路径则直接成功
    shot = data_service.get_shot(episode_id, shot_id)
    if shot:
        cand = next((c for c in shot.videoCandidates if c.id == candidate_id), None)
        if cand and cand.videoPath and str(cand.videoPath).strip():
            get_task_store().set_task(
                task_id,
                "success",
                kind="video",
                episode_id=episode_id,
                shot_id=shot_id,
                candidate_id=candidate_id,
                external_task_id=str(vidu_id),
                result={**meta, "videoPath": cand.videoPath},
            )
            return

    global _warned_no_vidu_client
    client = _get_vidu_client()
    if not client:
        if not _warned_no_vidu_client:
            _warned_no_vidu_client = True
            _LOG.warning(
                "VIDU_API_KEY（或 API_KEY）未配置：video_finalizer 无法查询 Vidu、下载 mp4，"
                "视频任务会长期保持 processing；请在项目根 .env 配置后重启后端。"
            )
        return

    try:
        resp = client.query_tasks([str(vidu_id)])
        tasks = resp.get("tasks", [])
        vt = tasks[0] if tasks else None
        # 部分环境下 list 查询偶发空列表，但 GET /tasks/{id}/creations 仍可拿到状态与生成物
        if vt is None:
            try:
                qc = client.query_creations(str(vidu_id))
                if isinstance(qc, dict) and (
                    qc.get("state") is not None or qc.get("creations") is not None
                ):
                    vt = qc
            except Exception:  # pylint: disable=broad-except
                pass
        if vt is None:
            return
        state = str(vt.get("state", ""))
        if state in ("created", "queueing", "processing"):
            return

        if state == "failed":
            data_service.update_video_candidate(
                episode_id,
                shot_id,
                candidate_id,
                {"taskStatus": "failed"},
            )
            data_service.update_shot_status(episode_id, shot_id, "error")
            get_task_store().set_task(
                task_id,
                "failed",
                kind="video",
                episode_id=episode_id,
                shot_id=shot_id,
                candidate_id=candidate_id,
                result=meta,
                error="Vidu 任务失败",
            )
            return

        if state != "success":
            return

        video_url = _extract_creation_video_url(vt)
        if not video_url:
            data_service.update_video_candidate(
                episode_id,
                shot_id,
                candidate_id,
                {"taskStatus": "failed"},
            )
            get_task_store().set_task(
                task_id,
                "failed",
                kind="video",
                episode_id=episode_id,
                shot_id=shot_id,
                candidate_id=candidate_id,
                result=meta,
                error="Vidu 成功但未返回视频 URL",
            )
            return

        ep_dir = data_service.get_episode_dir(episode_id)
        if not ep_dir:
            get_task_store().set_task(
                task_id,
                "failed",
                kind="video",
                episode_id=episode_id,
                shot_id=shot_id,
                candidate_id=candidate_id,
                result=meta,
                error="Episode 目录不存在",
            )
            return

        videos_dir = ep_dir / "videos"
        videos_dir.mkdir(parents=True, exist_ok=True)
        safe_name = f"{shot_id}_{candidate_id}.mp4"
        dest = videos_dir / safe_name
        r = requests.get(video_url, timeout=180)
        r.raise_for_status()
        dest.write_bytes(r.content)
        rel_path = f"videos/{safe_name}"

        # 提交阶段已写入 seed；若完成态响应带非零 seed 则覆盖（与 Vidu 最终一致）
        cand_updates: dict[str, object] = {
            "videoPath": rel_path,
            "taskStatus": "success",
            "model": str(vt.get("model") or ""),
        }
        fin_seed = int(vt.get("seed") or 0)
        if fin_seed > 0:
            cand_updates["seed"] = fin_seed
        res_from_vt = vt.get("resolution")
        if isinstance(res_from_vt, str) and res_from_vt.strip():
            cand_updates["resolution"] = res_from_vt.strip()

        data_service.update_video_candidate(
            episode_id,
            shot_id,
            candidate_id,
            cand_updates,
        )
        # 任一条候选仍标记为 selected 时，镜头终态应为 selected（精出/多候选期间可能曾被写成 video_generating）
        shot_after = data_service.get_shot(episode_id, shot_id)
        if shot_after and any(c.selected for c in shot_after.videoCandidates):
            data_service.update_shot(episode_id, shot_id, {"status": "selected"})
        else:
            data_service.update_shot(episode_id, shot_id, {"status": "video_done"})
        get_task_store().set_task(
            task_id,
            "success",
            kind="video",
            episode_id=episode_id,
            shot_id=shot_id,
            candidate_id=candidate_id,
            external_task_id=str(vidu_id),
            result={**meta, "videoPath": rel_path, "creations": vt.get("creations")},
        )
    except Exception as e:  # pylint: disable=broad-except
        _LOG.exception("video finalize 失败 task_id=%s", task_id)
        try:
            data_service.update_video_candidate(
                episode_id,
                shot_id,
                candidate_id,
                {"taskStatus": "failed"},
            )
        except Exception:
            pass
        get_task_store().set_task(
            task_id,
            "failed",
            kind="video",
            episode_id=episode_id,
            shot_id=shot_id,
            candidate_id=candidate_id,
            result=meta,
            error=str(e),
        )


def _loop() -> None:
    while not _stop.is_set():
        try:
            conn = get_connection()
            batch = repository.get_tasks_by_status(conn, "awaiting_external", kind="video")
            for t in batch:
                if _stop.is_set():
                    break
                _finalize_one_task(t)
        except Exception:  # pylint: disable=broad-except
            _LOG.exception("video finalizer 循环异常")
        _stop.wait(_POLL_INTERVAL_SEC)


def start_video_finalizer_background() -> None:
    """启动守护线程（进程生命周期内单例）。"""
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="video-finalizer", daemon=True)
    _thread.start()
