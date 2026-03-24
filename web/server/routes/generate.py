# -*- coding: utf-8 -*-
"""
生成路由：POST endframe, video, regen-frame

异步触发生成任务，立即返回 taskId 供前端轮询。
尾帧批量：每个 shot 独立 task；视频批量：按 mode 分发 Vidu（i2v / 首尾帧 start-end2video / 多参考图 reference2video）。

重要：FastAPI/Starlette 的 BackgroundTasks 会**按顺序**执行每个后台任务；
若对同一请求 add_task N 次同步函数，会**串行**跑完一张再跑下一张（总耗时 ≈ N × 单张耗时）。
因此批量尾帧/批量视频改为：只 add_task **一次**，在回调内用 ThreadPoolExecutor 按 ENDFRAME_CONCURRENCY / VIDEO_CONCURRENCY 真正并行。
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _SERVER_DIR.parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import APIRouter, BackgroundTasks, HTTPException

from models.schemas import (
    BatchEndframeResponse,
    EndframeTaskItem,
    Episode,
    GenerateEndframeRequest,
    GenerateVideoRequest,
    GenerateVideoResponse,
    RegenFrameRequest,
    RegenFrameResponse,
    Shot,
    ShotAsset,
    VideoCandidate,
    VideoMode,
)
from services import data_service
from services.task_store import get_task_store

_LOG = logging.getLogger(__name__)

router = APIRouter()

# 并发控制：
# 1) 批量任务内用 ThreadPoolExecutor(max_workers=...) 限制并行度（见 _run_*_batch_parallel）
# 2) Semaphore 保留在单任务函数内，防止将来从别处直接调用 _run_tail_frame 时打爆 API
# 默认 20 路；若 yunwu/Vidu 限流可改小环境变量
_ENDFRAME_SEM = threading.Semaphore(int(os.getenv("ENDFRAME_CONCURRENCY", "20")))
_VIDEO_SEM = threading.Semaphore(int(os.getenv("VIDEO_CONCURRENCY", "20")))


def _endframe_max_workers(n_tasks: int) -> int:
    """批量尾帧线程池大小：不超过任务数，不超过 ENDFRAME_CONCURRENCY。"""
    cap = int(os.getenv("ENDFRAME_CONCURRENCY", "20"))
    return max(1, min(n_tasks, cap))


def _video_max_workers(n_tasks: int) -> int:
    """批量视频线程池大小。"""
    cap = int(os.getenv("VIDEO_CONCURRENCY", "20"))
    return max(1, min(n_tasks, cap))


def _run_endframe_batch_parallel(specs: list[tuple[str, str, str]]) -> None:
    """
    在单个 BackgroundTask 内并行执行多路尾帧生成。

    Args:
        specs: (task_id, episode_id, shot_id) 列表
    """
    if not specs:
        return
    workers = _endframe_max_workers(len(specs))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(_run_tail_frame, tid, eid, sid) for tid, eid, sid in specs
        ]
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                # _run_tail_frame 内部已捕获；此处防御未预料异常
                print(f"[Warn] endframe batch worker: {e}")


def _run_video_batch_parallel(
    jobs: list[
        tuple[
            str,
            str,
            str,
            VideoMode,
            str | None,
            int | None,
            str | None,
            list[str] | None,
        ]
    ],
) -> None:
    """在单个 BackgroundTask 内并行提交多路 Vidu（与尾帧同理，避免 BackgroundTasks 串行）。"""
    if not jobs:
        return
    workers = _video_max_workers(len(jobs))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(
                _run_video_gen,
                task_id,
                episode_id,
                shot_id,
                mode,
                model,
                duration,
                resolution,
                ref_ids,
            )
            for (
                task_id,
                episode_id,
                shot_id,
                mode,
                model,
                duration,
                resolution,
                ref_ids,
            ) in jobs
        ]
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                print(f"[Warn] video batch worker: {e}")


def _default_video_model(mode: VideoMode) -> str:
    """按生成模式默认模型。"""
    # 首尾帧走官方 start-end2video（见 platform.vidu.com Start end to Video），默认与文档常用 fast 模型一致
    if mode == "first_last_frame":
        return "viduq3-turbo"
    if mode == "reference":
        return "viduq2-pro"
    return "viduq2-pro-fast"


def _normalize_aspect_ratio(aspect: str) -> str:
    """将 episode 中的比例转为 Vidu API 常用写法。"""
    a = (aspect or "9:16").strip().lower().replace(" ", "")
    if a in ("9:16", "16:9", "1:1", "4:3", "3:4"):
        return a
    return "9:16"


def _ts():
    """任务状态写入入口（SQLite）。"""
    return get_task_store()


def _run_tail_frame(task_id: str, episode_id: str, shot_id: str) -> None:
    """同步执行尾帧生成（在线程中运行）；yunwu 调用受信号量限制。"""
    try:
        _LOG.info(
            "[尾帧] 开始 task=%s episode=%s shot=%s",
            task_id,
            episode_id,
            shot_id,
        )
        ep = data_service.get_episode(episode_id)
        if not ep:
            _LOG.warning("[尾帧] 失败 task=%s: Episode not found", task_id)
            _ts().set_task(task_id, "failed", error="Episode not found")
            return
        shot = data_service.get_shot(episode_id, shot_id)
        if not shot:
            _LOG.warning("[尾帧] 失败 task=%s: Shot not found", task_id)
            _ts().set_task(task_id, "failed", error="Shot not found")
            return
        ep_dir = data_service.get_episode_dir(episode_id)
        if not ep_dir:
            _LOG.warning("[尾帧] 失败 task=%s: Episode dir not found", task_id)
            _ts().set_task(task_id, "failed", error="Episode dir not found")
            return
        first_path = ep_dir / shot.firstFrame
        if not first_path.exists():
            _LOG.warning(
                "[尾帧] 失败 task=%s: 首帧文件不存在 path=%s",
                task_id,
                shot.firstFrame,
            )
            _ts().set_task(task_id, "failed", error=f"First frame not found: {shot.firstFrame}")
            return
        assets_dir = ep_dir / "assets"
        asset_paths = [assets_dir / a.localPath.replace("assets/", "").lstrip("/") for a in shot.assets]
        asset_paths = [p for p in asset_paths if p.exists()][:2]
        with _ENDFRAME_SEM:
            from services.yunwu_service import generate_tail_frame

            img_data = generate_tail_frame(
                first_path,
                shot.imagePrompt,
                shot.videoPrompt,
                asset_paths,
            )
        # 优先用首帧路径 stem（如 frames/S003.png → S003_end.png），避免多镜头 shotNumber 重复时互相覆盖
        _stem = Path(shot.firstFrame).stem
        end_name = f"{_stem}_end.png" if _stem else f"S{shot.shotNumber:02d}_end.png"
        end_path = ep_dir / "endframes" / end_name
        end_path.parent.mkdir(parents=True, exist_ok=True)
        end_path.write_bytes(img_data)
        data_service.update_shot(episode_id, shot_id, {
            "endFrame": f"endframes/{end_name}",
            "status": "endframe_done",
        })
        _ts().set_task(task_id, "success", result={"path": f"endframes/{end_name}"})
        _LOG.info(
            "[尾帧] 成功 task=%s shot=%s endFrame=%s bytes=%d",
            task_id,
            shot_id,
            f"endframes/{end_name}",
            len(img_data),
        )
    except Exception as e:
        _LOG.exception("[尾帧] 异常 task=%s episode=%s shot=%s: %s", task_id, episode_id, shot_id, e)
        _ts().set_task(task_id, "failed", error=str(e))
        data_service.update_shot_status(episode_id, shot_id, "error")


@router.post("/generate/endframe", response_model=BatchEndframeResponse)
def generate_endframe(req: GenerateEndframeRequest, background_tasks: BackgroundTasks):
    """批量生成尾帧：每个 shot 独立 taskId，返回 tasks 列表。"""
    if not req.shotIds:
        raise HTTPException(status_code=400, detail="shotIds 不能为空")
    tasks_out: list[EndframeTaskItem] = []
    specs: list[tuple[str, str, str]] = []
    for shot_id in req.shotIds:
        task_id = f"endframe-{uuid.uuid4().hex[:12]}"
        _ts().set_task(task_id, "processing")
        data_service.update_shot_status(req.episodeId, shot_id, "endframe_generating")
        specs.append((task_id, req.episodeId, shot_id))
        tasks_out.append(EndframeTaskItem(taskId=task_id, shotId=shot_id))
    # 关键：只注册一个后台任务，内部线程池并行；勿对每镜头 add_task 一次（会串行）
    _LOG.info(
        "[尾帧] 已入队 batch episode=%s 镜头数=%d tasks=%s",
        req.episodeId,
        len(specs),
        [t for t, _, _ in specs],
    )
    background_tasks.add_task(_run_endframe_batch_parallel, specs)
    return BatchEndframeResponse(tasks=tasks_out)


def _run_video_gen(
    task_id: str,
    episode_id: str,
    shot_id: str,
    mode: VideoMode,
    model: str | None,
    duration: int | None,
    resolution: str | None,
    reference_asset_ids: list[str] | None,
) -> None:
    """同步执行视频生成（提交 Vidu）；任务完成与下载在 GET /tasks 轮询时同步处理。"""
    try:
        _LOG.info(
            "[视频] 开始 task=%s episode=%s shot=%s mode=%s",
            task_id,
            episode_id,
            shot_id,
            mode,
        )
        with _VIDEO_SEM:
            ep = data_service.get_episode(episode_id)
            if not ep:
                _LOG.warning("[视频] 失败 task=%s: Episode not found", task_id)
                _ts().set_task(task_id, "failed", error="Episode not found")
                return
            shot = data_service.get_shot(episode_id, shot_id)
            if not shot:
                _LOG.warning("[视频] 失败 task=%s: Shot not found", task_id)
                _ts().set_task(task_id, "failed", error="Shot not found")
                return
            ep_dir = data_service.get_episode_dir(episode_id)
            if not ep_dir:
                _LOG.warning("[视频] 失败 task=%s: Episode dir not found", task_id)
                _ts().set_task(task_id, "failed", error="Episode dir not found")
                return
            first_path = ep_dir / shot.firstFrame
            if not first_path.exists():
                _LOG.warning(
                    "[视频] 失败 task=%s: 首帧不存在 firstFrame=%s",
                    task_id,
                    shot.firstFrame,
                )
                _ts().set_task(task_id, "failed", error="First frame not found")
                return

            resolved_model = model or _default_video_model(mode)
            resolved_duration = int(duration if duration is not None else shot.duration)
            resolved_resolution = resolution or "720p"
            aspect = _normalize_aspect_ratio(shot.aspectRatio)

            from services import vidu_service

            resp: dict
            if mode == "first_frame":
                resp = vidu_service.submit_img2video(
                    first_path,
                    shot.videoPrompt,
                    model=resolved_model,
                    duration=resolved_duration,
                    resolution=resolved_resolution,
                    aspect_ratio=aspect,
                )
            elif mode == "first_last_frame":
                if not shot.endFrame:
                    _LOG.warning(
                        "[首尾帧视频] 失败 task=%s shot=%s: 未设置 endFrame，请先生成尾帧",
                        task_id,
                        shot_id,
                    )
                    _ts().set_task(task_id, "failed", error="需要先生成尾帧后再使用首尾帧模式")
                    data_service.update_shot_status(episode_id, shot_id, "error")
                    return
                end_path = ep_dir / shot.endFrame
                if not end_path.exists():
                    _LOG.warning(
                        "[首尾帧视频] 失败 task=%s shot=%s: 尾帧文件不存在 path=%s",
                        task_id,
                        shot_id,
                        shot.endFrame,
                    )
                    _ts().set_task(task_id, "failed", error=f"尾帧文件不存在: {shot.endFrame}")
                    data_service.update_shot_status(episode_id, shot_id, "error")
                    return
                _LOG.info(
                    "[首尾帧视频] 提交 Vidu task=%s shot=%s model=%s 首帧=%s 尾帧=%s dur=%s res=%s",
                    task_id,
                    shot_id,
                    resolved_model,
                    shot.firstFrame,
                    shot.endFrame,
                    resolved_duration,
                    resolved_resolution,
                )
                resp = vidu_service.submit_first_last_video(
                    first_path,
                    end_path,
                    shot.videoPrompt,
                    model=resolved_model,
                    duration=resolved_duration,
                    resolution=resolved_resolution,
                    aspect_ratio=aspect,
                )
            elif mode == "reference":
                assets_dir = ep_dir / "assets"
                ref_paths: list[Path] = []
                for a in shot.assets:
                    if not a.localPath:
                        continue
                    if reference_asset_ids and a.assetId not in reference_asset_ids:
                        continue
                    p = assets_dir / a.localPath.replace("assets/", "").lstrip("/")
                    if p.exists():
                        ref_paths.append(p)
                ref_paths = ref_paths[:7]
                if not ref_paths:
                    _ts().set_task(task_id, "failed", error="多参考图模式至少需要 1 张可用资产图")
                    data_service.update_shot_status(episode_id, shot_id, "error")
                    return
                resp = vidu_service.submit_reference_video(
                    ref_paths,
                    shot.videoPrompt,
                    model=resolved_model,
                    duration=resolved_duration,
                    resolution=resolved_resolution,
                    aspect_ratio=aspect,
                    with_subjects=False,
                )
            else:
                _ts().set_task(task_id, "failed", error=f"未知 mode: {mode}")
                return

            vidu_task_id = resp.get("task_id") or resp.get("id")
            if not vidu_task_id:
                _LOG.error(
                    "[视频] 失败 task=%s: Vidu 响应无 task_id resp_keys=%s",
                    task_id,
                    list(resp.keys()) if isinstance(resp, dict) else type(resp),
                )
                _ts().set_task(task_id, "failed", error="Vidu 未返回 task_id")
                return

            cand_id = f"cand-{uuid.uuid4().hex[:12]}"
            cand = VideoCandidate(
                id=cand_id,
                videoPath="",
                thumbnailPath="",
                seed=int(resp.get("seed") or 0),
                model=resolved_model,
                mode=mode,
                selected=False,
                createdAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                taskId=str(vidu_task_id),
                taskStatus="processing",
            )
            data_service.add_video_candidate(episode_id, shot_id, cand)
            data_service.update_shot_status(episode_id, shot_id, "video_generating")
            _ts().set_task(
                task_id,
                "awaiting_external",
                result={"vidu_task_id": str(vidu_task_id)},
                episode_id=episode_id,
                shot_id=shot_id,
                candidate_id=cand_id,
                kind="video",
                external_task_id=str(vidu_task_id),
            )
            _LOG.info(
                "[视频] 已提交待轮询 task=%s shot=%s mode=%s vidu_task_id=%s candidate=%s model=%s",
                task_id,
                shot_id,
                mode,
                vidu_task_id,
                cand_id,
                resolved_model,
            )
    except Exception as e:
        _LOG.exception(
            "[视频] 异常 task=%s episode=%s shot=%s mode=%s: %s",
            task_id,
            episode_id,
            shot_id,
            mode,
            e,
        )
        _ts().set_task(task_id, "failed", error=str(e))
        try:
            data_service.update_shot_status(episode_id, shot_id, "error")
        except Exception:
            pass


@router.post("/generate/video", response_model=GenerateVideoResponse)
def generate_video(req: GenerateVideoRequest, background_tasks: BackgroundTasks):
    """批量生成视频。"""
    if not req.shotIds:
        raise HTTPException(status_code=400, detail="shotIds 不能为空")
    tasks_out = []
    ref_ids = req.referenceAssetIds
    jobs: list[
        tuple[
            str,
            str,
            str,
            VideoMode,
            str | None,
            int | None,
            str | None,
            list[str] | None,
        ]
    ] = []
    for shot_id in req.shotIds:
        task_id = f"video-{uuid.uuid4().hex[:12]}"
        _ts().set_task(task_id, "processing")
        # 与尾帧接口一致：在返回 200 前即写入镜头状态，避免前端立刻 fetchEpisode 时仍显示
        # 上一次失败残留的「出错」；后台 _run_video_gen 若校验失败会再写回 error。
        data_service.update_shot_status(req.episodeId, shot_id, "video_generating")
        jobs.append(
            (
                task_id,
                req.episodeId,
                shot_id,
                req.mode,
                req.model,
                req.duration,
                req.resolution,
                ref_ids,
            )
        )
        tasks_out.append({"taskId": task_id, "shotId": shot_id})
    # #region agent log
    try:
        _dbg = _PROJECT_ROOT / ".cursor" / "debug.log"
        _dbg.parent.mkdir(parents=True, exist_ok=True)
        with open(_dbg, "a", encoding="utf-8") as _df:
            _df.write(
                json.dumps(
                    {
                        "hypothesisId": "H_race_episode",
                        "location": "generate.generate_video",
                        "message": "sync_shot_video_generating",
                        "data": {"episodeId": req.episodeId, "shotIds": list(req.shotIds)},
                        "timestamp": int(time.time() * 1000),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    except Exception:
        pass
    # #endregion
    _LOG.info(
        "[视频] 已入队 batch episode=%s mode=%s 镜头数=%d tasks=%s",
        req.episodeId,
        req.mode,
        len(jobs),
        [j[0] for j in jobs],
    )
    background_tasks.add_task(_run_video_batch_parallel, jobs)
    return GenerateVideoResponse(tasks=tasks_out)


def _resolve_regen_asset_paths(
    ep: Episode,
    shot: Shot,
    asset_ids: list[str],
    ep_dir: Path,
) -> list[Path]:
    """
    按请求中的 asset_ids 顺序解析本地资产文件路径（最多 2 个）。

    与前端资产库一致：合并 **剧集级** ``episode.assets`` 与 **镜头级** ``shot.assets`` 的元数据，
    同一 assetId 以镜头级记录覆盖剧集级（与拉取后镜头上挂接为准）。
    仅当 ``assets/`` 下文件存在时加入列表；未知 id 或缺文件会跳过（不中断任务）。
    """
    by_id: dict[str, ShotAsset] = {}
    for a in ep.assets:
        by_id[a.assetId] = a
    for a in shot.assets:
        by_id[a.assetId] = a
    assets_dir = ep_dir / "assets"
    out: list[Path] = []
    for aid in asset_ids:
        meta = by_id.get(aid)
        if not meta:
            continue
        p = assets_dir / meta.localPath.replace("assets/", "").lstrip("/")
        if p.exists():
            out.append(p)
        if len(out) >= 2:
            break
    return out


def _run_regen_frame(task_id: str, episode_id: str, shot_id: str, image_prompt: str, asset_ids: list[str]):
    """同步执行单帧重生。"""
    try:
        ep = data_service.get_episode(episode_id)
        if not ep:
            _ts().set_task(task_id, "failed", error="Episode not found")
            return
        shot = data_service.get_shot(episode_id, shot_id)
        if not shot:
            _ts().set_task(task_id, "failed", error="Shot not found")
            return
        ep_dir = data_service.get_episode_dir(episode_id)
        if not ep_dir:
            _ts().set_task(task_id, "failed", error="Episode dir not found")
            return
        first_path = ep_dir / shot.firstFrame
        if not first_path.exists():
            _ts().set_task(task_id, "failed", error="First frame not found")
            return
        asset_paths = _resolve_regen_asset_paths(ep, shot, asset_ids or [], ep_dir)
        from services.yunwu_service import regenerate_first_frame
        img_data = regenerate_first_frame(first_path, image_prompt, asset_paths)
        frame_path = ep_dir / shot.firstFrame
        frame_path.write_bytes(img_data)
        data_service.update_shot(episode_id, shot_id, {
            "imagePrompt": image_prompt,
            "endFrame": None,
            "videoCandidates": [],
            "status": "pending",
        })
        _ts().set_task(task_id, "success", result={"newFramePath": shot.firstFrame})
    except Exception as e:
        _ts().set_task(task_id, "failed", error=str(e))


@router.post("/generate/regen-frame", response_model=RegenFrameResponse)
def regen_frame(req: RegenFrameRequest, background_tasks: BackgroundTasks):
    """单帧重生。"""
    task_id = f"regen-{uuid.uuid4().hex[:12]}"
    _ts().set_task(task_id, "processing")
    background_tasks.add_task(
        _run_regen_frame,
        task_id, req.episodeId, req.shotId, req.imagePrompt, req.assetIds or [],
    )
    shot = data_service.get_shot(req.episodeId, req.shotId)
    return RegenFrameResponse(
        taskId=task_id,
        shotId=req.shotId,
        newFramePath=shot.firstFrame if shot else "",
    )
