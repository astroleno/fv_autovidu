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

from fastapi import APIRouter, HTTPException, Request

from models.schemas import Episode, PullEpisodeRequest
from services import data_service
from services.context_service import (
    get_feeling_client,
    get_feeling_context,
    get_namespace_data_root_optional,
)

router = APIRouter()


@router.get("/episodes", response_model=list[dict])
def list_episodes(request: Request):
    """列出所有本地已拉取的 Episode（随 X-FV-Context-Id 限定命名空间）。"""
    ns = get_namespace_data_root_optional(request)
    return data_service.list_episodes(ns)


@router.get("/episodes/{episode_id}", response_model=Episode)
def get_episode(episode_id: str, request: Request):
    """获取单个 Episode 完整数据。"""
    ns = get_namespace_data_root_optional(request)
    ep = data_service.get_episode(episode_id, ns)
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    return ep


@router.post("/episodes/pull", response_model=Episode)
def pull_episode(req: PullEpisodeRequest, request: Request):
    """从平台拉取 Episode 到本地。"""
    try:
        from src.feeling.puller import pull_episode as do_pull
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="puller 模块未找到，请确保从项目根目录运行",
        )
    from config import DATA_ROOT

    ns = get_namespace_data_root_optional(request)
    output_root = ns if ns is not None else Path(DATA_ROOT)
    ctx = get_feeling_context(request)
    fs_tag = f"{ctx.env_key}/{ctx.workspace_key}" if ctx else ""
    client = get_feeling_client(request)
    # 单副本归一化：不再从旧本地目录反推 projectId，避免错误项目被固化；缺省用 proj-default
    project_id = getattr(req, "projectId", None) or "proj-default"

    try:
        result = do_pull(
            req.episodeId,
            output_root,
            project_id=project_id,
            force_redownload=getattr(req, "forceRedownload", False),
            skip_images=getattr(req, "skipImages", False),
            client=client,
            fs_lock_namespace=fs_tag,
        )
        return Episode.model_validate(result)
    except Exception as e:
        detail = str(e) if str(e) else repr(e)
        raise HTTPException(status_code=500, detail=f"拉取失败: {detail}")
