# -*- coding: utf-8 -*-
"""
生成路由：POST endframe, video, regen-frame

异步触发生成任务，立即返回 taskId 供前端轮询。
"""

import uuid
import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _SERVER_DIR.parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import APIRouter, BackgroundTasks, HTTPException

from models.schemas import (
    GenerateEndframeRequest,
    GenerateEndframeResponse,
    GenerateVideoRequest,
    GenerateVideoResponse,
    RegenFrameRequest,
    RegenFrameResponse,
)
from services import data_service
from routes.tasks import set_local_task

router = APIRouter()


def _run_tail_frame(task_id: str, episode_id: str, shot_id: str):
    """同步执行尾帧生成（在线程中运行）。"""
    try:
        ep = data_service.get_episode(episode_id)
        if not ep:
            set_local_task(task_id, "failed", error="Episode not found")
            return
        shot = data_service.get_shot(episode_id, shot_id)
        if not shot:
            set_local_task(task_id, "failed", error="Shot not found")
            return
        ep_dir = data_service.get_episode_dir(episode_id)
        if not ep_dir:
            set_local_task(task_id, "failed", error="Episode dir not found")
            return
        first_path = ep_dir / shot.firstFrame
        if not first_path.exists():
            set_local_task(task_id, "failed", error=f"First frame not found: {shot.firstFrame}")
            return
        assets_dir = ep_dir / "assets"
        asset_paths = [assets_dir / a.localPath.replace("assets/", "").lstrip("/") for a in shot.assets]
        asset_paths = [p for p in asset_paths if p.exists()][:2]
        from services.yunwu_service import generate_tail_frame
        img_data = generate_tail_frame(
            first_path,
            shot.imagePrompt,
            shot.videoPrompt,
            asset_paths,
        )
        end_name = f"S{shot.shotNumber:02d}_end.png"
        end_path = ep_dir / "endframes" / end_name
        end_path.parent.mkdir(parents=True, exist_ok=True)
        end_path.write_bytes(img_data)
        data_service.update_shot(episode_id, shot_id, {
            "endFrame": f"endframes/{end_name}",
            "status": "endframe_done",
        })
        set_local_task(task_id, "success", result={"path": f"endframes/{end_name}"})
    except Exception as e:
        set_local_task(task_id, "failed", error=str(e))
        data_service.update_shot_status(episode_id, shot_id, "error")


@router.post("/generate/endframe", response_model=GenerateEndframeResponse)
def generate_endframe(req: GenerateEndframeRequest, background_tasks: BackgroundTasks):
    """批量生成尾帧。前端可能逐个 shot 调用，此处支持单 shot。"""
    if not req.shotIds:
        raise HTTPException(status_code=400, detail="shotIds 不能为空")
    shot_id = req.shotIds[0]
    task_id = f"endframe-{uuid.uuid4().hex[:12]}"
    set_local_task(task_id, "processing")
    data_service.update_shot_status(req.episodeId, shot_id, "endframe_generating")
    background_tasks.add_task(_run_tail_frame, task_id, req.episodeId, shot_id)
    return GenerateEndframeResponse(taskId=task_id, shotId=shot_id)


def _run_video_gen(task_id: str, episode_id: str, shot_id: str, mode: str):
    """同步执行视频生成（提交到 Vidu，需后续 poll + download）。"""
    try:
        ep = data_service.get_episode(episode_id)
        if not ep:
            set_local_task(task_id, "failed", error="Episode not found")
            return
        shot = data_service.get_shot(episode_id, shot_id)
        if not shot:
            set_local_task(task_id, "failed", error="Shot not found")
            return
        ep_dir = data_service.get_episode_dir(episode_id)
        if not ep_dir:
            set_local_task(task_id, "failed", error="Episode dir not found")
            return
        first_path = ep_dir / shot.firstFrame
        if not first_path.exists():
            set_local_task(task_id, "failed", error="First frame not found")
            return
        from services.vidu_service import submit_img2video
        resp = submit_img2video(first_path, shot.videoPrompt)
        vidu_task_id = resp.get("task_id") or resp.get("id")
        if vidu_task_id:
            from models.schemas import VideoCandidate
            cand = VideoCandidate(
                id=f"cand-{uuid.uuid4().hex[:12]}",
                videoPath="",
                thumbnailPath="",
                seed=0,
                model=resp.get("model", ""),
                mode=mode,
                selected=False,
                createdAt="",
                taskId=vidu_task_id,
                taskStatus="processing",
            )
            data_service.add_video_candidate(episode_id, shot_id, cand)
            data_service.update_shot_status(episode_id, shot_id, "video_generating")
            set_local_task(task_id, "processing", result={"vidu_task_id": vidu_task_id})
        else:
            set_local_task(task_id, "failed", error="Vidu 未返回 task_id")
    except Exception as e:
        set_local_task(task_id, "failed", error=str(e))


@router.post("/generate/video", response_model=GenerateVideoResponse)
def generate_video(req: GenerateVideoRequest, background_tasks: BackgroundTasks):
    """批量生成视频。"""
    if not req.shotIds:
        raise HTTPException(status_code=400, detail="shotIds 不能为空")
    tasks_out = []
    for shot_id in req.shotIds:
        task_id = f"video-{uuid.uuid4().hex[:12]}"
        set_local_task(task_id, "processing")
        background_tasks.add_task(_run_video_gen, task_id, req.episodeId, shot_id, req.mode)
        tasks_out.append({"taskId": task_id, "shotId": shot_id})
    return GenerateVideoResponse(tasks=tasks_out)


def _run_regen_frame(task_id: str, episode_id: str, shot_id: str, image_prompt: str, asset_ids: list[str]):
    """同步执行单帧重生。"""
    try:
        ep = data_service.get_episode(episode_id)
        if not ep:
            set_local_task(task_id, "failed", error="Episode not found")
            return
        shot = data_service.get_shot(episode_id, shot_id)
        if not shot:
            set_local_task(task_id, "failed", error="Shot not found")
            return
        ep_dir = data_service.get_episode_dir(episode_id)
        if not ep_dir:
            set_local_task(task_id, "failed", error="Episode dir not found")
            return
        first_path = ep_dir / shot.firstFrame
        if not first_path.exists():
            set_local_task(task_id, "failed", error="First frame not found")
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
        set_local_task(task_id, "success", result={"newFramePath": shot.firstFrame})
    except Exception as e:
        set_local_task(task_id, "failed", error=str(e))


@router.post("/generate/regen-frame", response_model=RegenFrameResponse)
def regen_frame(req: RegenFrameRequest, background_tasks: BackgroundTasks):
    """单帧重生。"""
    task_id = f"regen-{uuid.uuid4().hex[:12]}"
    set_local_task(task_id, "processing")
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
