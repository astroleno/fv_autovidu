# -*- coding: utf-8 -*-
"""
导出路由：
- POST /export/rough-cut — 按选定顺序拼接视频，输出到 export/episode_rough.mp4
- POST /export/jianying-draft — 剪映草稿包（JSON + 素材 + 可选 ZIP）
- GET /export/jianying-draft/path — 探测本机剪映草稿目录候选
"""

import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from fastapi import APIRouter, HTTPException

from models.schemas import (
    ExportRoughCutRequest,
    ExportRoughCutResponse,
    JianyingExportRequest,
    JianyingExportResponse,
)
from services import data_service
from services.ffmpeg_service import concat_videos
from services.jianying_service import export_jianying_draft, guess_jianying_draft_root_candidates

router = APIRouter()


@router.post("/export/rough-cut", response_model=ExportRoughCutResponse)
def export_rough_cut(req: ExportRoughCutRequest):
    """导出粗剪：按 shot 顺序拼接选定的视频。"""
    ep = data_service.get_episode(req.episodeId)
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    ep_dir = data_service.get_episode_dir(req.episodeId)
    if not ep_dir:
        raise HTTPException(status_code=404, detail="Episode dir not found")
    # 收集选定视频路径（按 shot 顺序）
    video_paths: list[Path] = []
    shot_ids = req.shotIds or []
    if not shot_ids:
        for scene in ep.scenes:
            for shot in scene.shots:
                shot_ids.append(shot.shotId)
    for shot_id in shot_ids:
        shot = data_service.get_shot(req.episodeId, shot_id)
        if not shot:
            continue
        selected = next((c for c in shot.videoCandidates if c.selected), None)
        if not selected or not selected.videoPath:
            continue
        full = ep_dir / selected.videoPath
        if full.exists():
            video_paths.append(full)
    if not video_paths:
        raise HTTPException(status_code=400, detail="没有选定的视频可导出")
    export_dir = ep_dir / "export"
    export_dir.mkdir(parents=True, exist_ok=True)
    output_path = export_dir / "episode_rough.mp4"
    concat_videos(video_paths, output_path)
    # 返回可用于 /api/files/ 的路径：projectId/episodeId/export/episode_rough.mp4
    rel = str(output_path.relative_to(ep_dir.parent.parent))
    return ExportRoughCutResponse(exportPath=rel)


@router.post("/export/jianying-draft", response_model=JianyingExportResponse)
def export_jianying_draft_endpoint(req: JianyingExportRequest):
    """
    导出剪映草稿：将已选视频按叙事顺序写入草稿目录，可选 ZIP 与本机剪映目录。

    约束：createZip 与 draftPath 至少其一（首版默认 ZIP，避免依赖剪映安装路径）。
    """
    if not req.createZip and not (req.draftPath and str(req.draftPath).strip()):
        raise HTTPException(
            status_code=400,
            detail="请开启 createZip 或提供有效的 draftPath（至少一种导出目标）",
        )
    try:
        data = export_jianying_draft(req, include_dub_audio=True)
        return JianyingExportResponse(**data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"写入草稿失败: {exc}") from exc


@router.get("/export/jianying-draft/path")
def get_jianying_draft_path_hints():
    """
    返回本机探测到的剪映草稿根目录候选（macOS 常见路径）。
    若未找到则 detectedPath 为 null，前端可提示用户手动填写。
    """
    cands = guess_jianying_draft_root_candidates()
    return {
        "detectedPath": cands[0] if cands else None,
        "candidates": cands,
    }
