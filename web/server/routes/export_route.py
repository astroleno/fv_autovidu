# -*- coding: utf-8 -*-
"""
导出路由：POST /export/rough-cut

按选定顺序拼接视频，输出到 export/episode_rough.mp4
"""

import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from fastapi import APIRouter, HTTPException

from models.schemas import ExportRoughCutRequest, ExportRoughCutResponse
from services import data_service
from services.ffmpeg_service import concat_videos

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
