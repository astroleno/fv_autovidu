# -*- coding: utf-8 -*-
"""
任务状态路由：GET /tasks/:taskId, GET /tasks/batch
代理 Vidu 任务查询，同时支持本地任务追踪。

本地 video-* 任务在轮询时会同步查询 Vidu：成功则下载 mp4 到 data/.../videos/ 并更新 episode.json。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import requests

_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from fastapi import APIRouter, Query

from models.schemas import TaskStatusResponse

router = APIRouter()

# 本地任务状态缓存（内存，重启丢失；可后续改为持久化）
_local_tasks: dict[str, dict] = {}


def _get_vidu_client():
    """获取 ViduClient 实例。"""
    try:
        from src.vidu.client import ViduClient
    except ImportError:
        return None
    key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not key:
        return None
    return ViduClient(api_key=key)


def _extract_creation_video_url(vt: dict) -> str | None:
    """从 Vidu query_tasks 单条 task 中解析视频下载 URL。"""
    cr = vt.get("creations")
    if cr is None:
        return None
    if isinstance(cr, list) and len(cr) > 0:
        return cr[0].get("url") or cr[0].get("watermarked_url")
    if isinstance(cr, dict):
        return cr.get("url") or cr.get("watermarked_url")
    return None


def maybe_finalize_video_task(task_id: str) -> None:
    """
    若本地任务为 video-* 且仍为 processing，则查询 Vidu；成功则下载视频并写回 episode。
    失败则更新候选 taskStatus 与 shot.status。
    """
    if task_id not in _local_tasks:
        return
    t = _local_tasks[task_id]
    if t.get("kind") != "video":
        return
    if t.get("status") not in ("processing", "pending"):
        return
    meta = t.get("result") or {}
    vidu_id = meta.get("vidu_task_id")
    episode_id = t.get("episode_id")
    shot_id = t.get("shot_id")
    candidate_id = t.get("candidate_id")
    if not vidu_id or not episode_id or not shot_id or not candidate_id:
        return

    client = _get_vidu_client()
    if not client:
        return

    from services import data_service

    try:
        resp = client.query_tasks([str(vidu_id)])
        tasks = resp.get("tasks", [])
        if not tasks:
            return
        vt = tasks[0]
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
            _local_tasks[task_id] = {
                "status": "failed",
                "error": "Vidu 任务失败",
                "result": meta,
                "episode_id": episode_id,
                "shot_id": shot_id,
                "candidate_id": candidate_id,
                "kind": "video",
            }
            return
        if state != "success":
            return

        video_url = _extract_creation_video_url(vt)
        if not video_url:
            _local_tasks[task_id] = {
                "status": "failed",
                "error": "Vidu 成功但未返回视频 URL",
                "result": meta,
                "episode_id": episode_id,
                "shot_id": shot_id,
                "candidate_id": candidate_id,
                "kind": "video",
            }
            data_service.update_video_candidate(
                episode_id,
                shot_id,
                candidate_id,
                {"taskStatus": "failed"},
            )
            return

        ep_dir = data_service.get_episode_dir(episode_id)
        if not ep_dir:
            _local_tasks[task_id] = {
                "status": "failed",
                "error": "Episode 目录不存在",
                "result": meta,
                "kind": "video",
            }
            return

        videos_dir = ep_dir / "videos"
        videos_dir.mkdir(parents=True, exist_ok=True)
        safe_name = f"{shot_id}_{candidate_id}.mp4"
        dest = videos_dir / safe_name
        r = requests.get(video_url, timeout=180)
        r.raise_for_status()
        dest.write_bytes(r.content)
        rel_path = f"videos/{safe_name}"

        data_service.update_video_candidate(
            episode_id,
            shot_id,
            candidate_id,
            {
                "videoPath": rel_path,
                "taskStatus": "success",
                "model": str(vt.get("model") or ""),
            },
        )
        data_service.update_shot(episode_id, shot_id, {"status": "video_done"})
        _local_tasks[task_id] = {
            "status": "success",
            "result": {**meta, "videoPath": rel_path, "creations": vt.get("creations")},
            "episode_id": episode_id,
            "shot_id": shot_id,
            "candidate_id": candidate_id,
            "kind": "video",
        }
    except Exception as e:
        _local_tasks[task_id] = {
            "status": "failed",
            "error": str(e),
            "result": meta,
            "episode_id": episode_id,
            "shot_id": shot_id,
            "candidate_id": candidate_id,
            "kind": "video",
        }
        try:
            data_service.update_video_candidate(
                episode_id,
                shot_id,
                candidate_id,
                {"taskStatus": "failed"},
            )
        except Exception:
            pass


@router.get("/tasks/{task_id}", response_model=TaskStatusResponse)
def get_task_status(task_id: str):
    """查询单个任务状态。"""
    # 1. 先查本地（video 任务可能需同步 Vidu 并完成下载）
    if task_id in _local_tasks:
        maybe_finalize_video_task(task_id)
        t = _local_tasks[task_id]
        return TaskStatusResponse(
            taskId=task_id,
            status=t.get("status", "pending"),
            progress=t.get("progress"),
            result=t.get("result"),
            error=t.get("error"),
        )
    # 2. 查 Vidu
    client = _get_vidu_client()
    if client:
        try:
            resp = client.query_tasks([task_id])
            tasks = resp.get("tasks", [])
            if tasks:
                vt = tasks[0]
                state = vt.get("state", "pending")
                mapping = {"created": "pending", "queueing": "pending", "processing": "processing"}
                status = mapping.get(state, "success" if state == "success" else "failed")
                if state == "failed":
                    status = "failed"
                return TaskStatusResponse(
                    taskId=task_id,
                    status=status,
                    result={"creations": vt.get("creations"), "state": state},
                )
        except Exception:
            pass
    return TaskStatusResponse(taskId=task_id, status="pending")


@router.get("/tasks/batch", response_model=list[TaskStatusResponse])
def get_tasks_batch(ids: str = Query(default="", description="逗号分隔的 taskId")):
    """批量查询任务状态。ids 逗号分隔。"""
    task_ids = [x.strip() for x in ids.split(",") if x.strip()]
    if not task_ids:
        return []
    for tid in task_ids:
        if tid in _local_tasks:
            maybe_finalize_video_task(tid)
    result = []
    # 分批查 Vidu（Vidu 支持一次查多个）
    vidu_ids = [tid for tid in task_ids if tid not in _local_tasks]
    if vidu_ids:
        client = _get_vidu_client()
        if client:
            try:
                resp = client.query_tasks(vidu_ids)
                for vt in resp.get("tasks", []):
                    tid = vt.get("id", "")
                    state = vt.get("state", "pending")
                    mapping = {"created": "pending", "queueing": "pending", "processing": "processing"}
                    status = mapping.get(state, "success" if state == "success" else "failed")
                    result.append(TaskStatusResponse(
                        taskId=tid,
                        status=status,
                        result={"creations": vt.get("creations"), "state": state},
                    ))
            except Exception:
                pass
    for tid in task_ids:
        if any(r.taskId == tid for r in result):
            continue
        if tid in _local_tasks:
            t = _local_tasks[tid]
            result.append(TaskStatusResponse(
                taskId=tid,
                status=t.get("status", "pending"),
                progress=t.get("progress"),
                result=t.get("result"),
                error=t.get("error"),
            ))
        else:
            result.append(TaskStatusResponse(taskId=tid, status="pending"))
    return result


def set_local_task(task_id: str, status: str, **kwargs):
    """供 generate 等路由更新本地任务状态。"""
    _local_tasks[task_id] = {"status": status, **kwargs}
