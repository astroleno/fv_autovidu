# -*- coding: utf-8 -*-
"""
生成路由：POST endframe, video, regen-frame

异步触发生成任务，立即返回 taskId 供前端轮询。
尾帧批量：每个 shot 独立 task；视频批量：按 mode 分发 Vidu（i2v / 首尾帧 reference2video / 多参考图）。
"""

from __future__ import annotations

import os
import sys
import threading
import uuid
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
    GenerateEndframeRequest,
    GenerateVideoRequest,
    GenerateVideoResponse,
    RegenFrameRequest,
    RegenFrameResponse,
    VideoCandidate,
    VideoMode,
)
from services import data_service
from services.task_store import get_task_store

router = APIRouter()

# 并发控制：BackgroundTasks 在线程池执行同步函数，使用 threading.Semaphore
# 默认 5 路并发可调；若 yunwu 限流可改小或设置环境变量 ENDFRAME_CONCURRENCY
_ENDFRAME_SEM = threading.Semaphore(int(os.getenv("ENDFRAME_CONCURRENCY", "5")))
_VIDEO_SEM = threading.Semaphore(int(os.getenv("VIDEO_CONCURRENCY", "5")))


def _default_video_model(mode: VideoMode) -> str:
    """按生成模式默认模型（与 TODO_PLAN 一致）。"""
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
    except Exception as e:
        _ts().set_task(task_id, "failed", error=str(e))
        data_service.update_shot_status(episode_id, shot_id, "error")


@router.post("/generate/endframe", response_model=BatchEndframeResponse)
def generate_endframe(req: GenerateEndframeRequest, background_tasks: BackgroundTasks):
    """批量生成尾帧：每个 shot 独立 taskId，返回 tasks 列表。"""
    if not req.shotIds:
        raise HTTPException(status_code=400, detail="shotIds 不能为空")
    tasks_out: list[EndframeTaskItem] = []
    for shot_id in req.shotIds:
        task_id = f"endframe-{uuid.uuid4().hex[:12]}"
        _ts().set_task(task_id, "processing")
        data_service.update_shot_status(req.episodeId, shot_id, "endframe_generating")
        background_tasks.add_task(_run_tail_frame, task_id, req.episodeId, shot_id)
        tasks_out.append(EndframeTaskItem(taskId=task_id, shotId=shot_id))
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
        with _VIDEO_SEM:
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
                    _ts().set_task(task_id, "failed", error="需要先生成尾帧后再使用首尾帧模式")
                    data_service.update_shot_status(episode_id, shot_id, "error")
                    return
                end_path = ep_dir / shot.endFrame
                if not end_path.exists():
                    _ts().set_task(task_id, "failed", error=f"尾帧文件不存在: {shot.endFrame}")
                    data_service.update_shot_status(episode_id, shot_id, "error")
                    return
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
    except Exception as e:
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
    for shot_id in req.shotIds:
        task_id = f"video-{uuid.uuid4().hex[:12]}"
        _ts().set_task(task_id, "processing")
        background_tasks.add_task(
            _run_video_gen,
            task_id,
            req.episodeId,
            shot_id,
            req.mode,
            req.model,
            req.duration,
            req.resolution,
            ref_ids,
        )
        tasks_out.append({"taskId": task_id, "shotId": shot_id})
    return GenerateVideoResponse(tasks=tasks_out)


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
        assets_dir = ep_dir / "assets"
        asset_paths = []
        for a in shot.assets:
            if a.assetId in asset_ids:
                p = assets_dir / a.localPath.replace("assets/", "").lstrip("/")
                if p.exists():
                    asset_paths.append(p)
        asset_paths = asset_paths[:2]
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
