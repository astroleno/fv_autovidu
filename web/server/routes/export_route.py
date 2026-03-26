# -*- coding: utf-8 -*-
"""
导出路由：
- POST /export/rough-cut — 按选定顺序拼接视频，输出到 export/episode_rough.mp4
- POST /export/jianying-draft — 剪映草稿（JSON + 素材 + 复制到本机 draftPath，不生成 ZIP）
- GET /export/jianying-draft/path — 探测本机剪映草稿目录候选
- GET /system/jianying-draft-path — 与 reference/packages/ugc-export-integrations README 中 UGCFlow 路径一致（别名，同上）
"""

import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _SERVER_DIR.parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import APIRouter, HTTPException, Request

from src.feeling.episode_fs_lock import episode_fs_lock

from config import DATA_ROOT
from models.schemas import (
    ExportRoughCutRequest,
    ExportRoughCutResponse,
    JianyingExportRequest,
    JianyingExportResponse,
)
from services import data_service
from services.candidate_pick import pick_playable_video_candidate
from services.context_service import (
    fs_lock_tag_from_namespace_root,
    get_feeling_client,
    get_namespace_data_root_optional,
)
from services.ffmpeg_service import concat_videos
from services.jianying_service import export_jianying_draft, guess_jianying_draft_root_candidates

router = APIRouter()


@router.post("/export/rough-cut", response_model=ExportRoughCutResponse)
def export_rough_cut(req: ExportRoughCutRequest, request: Request):
    """导出粗剪：按 shot 顺序拼接选定的视频（ffmpeg 在锁内，与同集 repull 互斥）。"""
    ns = get_namespace_data_root_optional(request)
    tag = fs_lock_tag_from_namespace_root(ns)
    with episode_fs_lock(req.episodeId, data_namespace=tag):
        ep = data_service.get_episode(req.episodeId, ns)
        if not ep:
            raise HTTPException(status_code=404, detail="Episode not found")
        ep_dir = data_service.get_episode_dir(req.episodeId, ns)
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
            shot = data_service.get_shot(req.episodeId, shot_id, ns)
            if not shot:
                continue
            cand = pick_playable_video_candidate(shot)
            if not cand or not cand.videoPath:
                continue
            full = ep_dir / cand.videoPath
            if full.exists():
                video_paths.append(full)
        if not video_paths:
            raise HTTPException(
                status_code=400,
                detail="没有可拼接的视频（需各镜头至少有一条已落盘的 videoPath）",
            )
        export_dir = ep_dir / "export"
        export_dir.mkdir(parents=True, exist_ok=True)
        output_path = export_dir / "episode_rough.mp4"
        concat_videos(video_paths, output_path)
        # 返回可用于 /api/files/ 的路径（相对 DATA_ROOT，含命名空间）
        rel = str(output_path.resolve().relative_to(Path(DATA_ROOT).resolve()))
        return ExportRoughCutResponse(exportPath=rel)


@router.post("/export/jianying-draft", response_model=JianyingExportResponse)
def export_jianying_draft_endpoint(req: JianyingExportRequest, request: Request):
    """
    导出剪映草稿：将已选视频按叙事顺序写入草稿目录，并复制到本机 draftPath。

    必填 draftPath（非空）；不生成 ZIP。
    """
    try:
        ns = get_namespace_data_root_optional(request)
        client = get_feeling_client(request)
        data = export_jianying_draft(
            req,
            include_dub_audio=True,
            namespace_root=ns,
            feeling_client=client,
        )
        return JianyingExportResponse(**data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"写入草稿失败: {exc}") from exc


def _jianying_draft_path_hints_payload() -> dict:
    """本机剪映草稿根目录候选：与 reference 包所述 draftPath 语义一致（写入 {draftPath}/{draftId}/）。"""
    cands = guess_jianying_draft_root_candidates()
    return {
        "detectedPath": cands[0] if cands else None,
        "candidates": cands,
    }


@router.get("/export/jianying-draft/path")
def get_jianying_draft_path_hints():
    """
    返回本机探测到的剪映草稿根目录候选（macOS 常见路径）。
    若未找到则 detectedPath 为 null，前端可提示用户手动填写。
    """
    return _jianying_draft_path_hints_payload()


@router.get("/system/jianying-draft-path")
def get_jianying_draft_path_hints_ugc_reference_alias():
    """
    与 `reference/packages/ugc-export-integrations/README.md` §2.1 中
    `GET /api/system/jianying-draft-path` 对齐（fv_autovidu 挂载在 /api 下）。
    响应与 GET /export/jianying-draft/path 完全相同。
    """
    return _jianying_draft_path_hints_payload()
