# -*- coding: utf-8 -*-
"""
Episode 路由：GET list/detail, POST pull
"""

import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _SERVER_DIR.parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import APIRouter, HTTPException

from models.schemas import Episode, PullEpisodeRequest
from services import data_service

router = APIRouter()


@router.get("/episodes", response_model=list[dict])
def list_episodes():
    """列出所有本地已拉取的 Episode。"""
    return data_service.list_episodes()


@router.get("/episodes/{episode_id}", response_model=Episode)
def get_episode(episode_id: str):
    """获取单个 Episode 完整数据。"""
    ep = data_service.get_episode(episode_id)
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    return ep


@router.post("/episodes/pull", response_model=Episode)
def pull_episode(req: PullEpisodeRequest):
    """从平台拉取 Episode 到本地。"""
    try:
        from src.feeling.puller import pull_episode as do_pull
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="puller 模块未找到，请确保从项目根目录运行",
        )
    from config import DATA_ROOT
    # 若本地已有该剧集，从其目录推断 projectId（拉资产需正确 projectId）
    project_id = getattr(req, "projectId", None)
    if not project_id:
        ep_dir = data_service.get_episode_dir(req.episodeId)
        if ep_dir:
            project_id = ep_dir.parent.name
    project_id = project_id or "proj-default"

    try:
        result = do_pull(
            req.episodeId,
            DATA_ROOT,
            project_id=project_id,
            force_redownload=getattr(req, "forceRedownload", False),
        )
        return Episode.model_validate(result)
    except Exception as e:
        detail = str(e) if str(e) else repr(e)
        raise HTTPException(status_code=500, detail=f"拉取失败: {detail}")
