# -*- coding: utf-8 -*-
"""
Episode 路由：GET list/detail, PATCH partial update, POST pull
"""

import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _SERVER_DIR.parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import APIRouter, Body, HTTPException, Request

from models.schemas import Episode, PullEpisodeRequest
from services import data_service
from services.context_service import (
    get_feeling_client,
    get_feeling_context,
    get_namespace_data_root_optional,
)

router = APIRouter()

# PATCH /episodes/{id} 仅允许写入的 Episode 根字段（其余键丢弃，避免误改结构）
_ALLOWED_EPISODE_PATCH_KEYS = frozenset(
    {"dubTargetLocale", "sourceLocale", "dubDefaultVoiceId", "characterVoices"}
)


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


@router.patch("/episodes/{episode_id}", response_model=Episode)
def patch_episode(
    episode_id: str,
    request: Request,
    body: dict = Body(default_factory=dict),
):
    """部分更新 Episode（本地化字段 + 一期 STS 集默认音色）。"""
    ns = get_namespace_data_root_optional(request)
    raw = body if isinstance(body, dict) else {}
    filtered = {k: v for k, v in raw.items() if k in _ALLOWED_EPISODE_PATCH_KEYS}
    ep = data_service.update_episode(episode_id, filtered, ns)
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

    # 命名空间拉取时 output_root 为 DATA_ROOT/env/ws，合并快照须同时扫扁平 DATA_ROOT，
    # 否则读不到「只在旧路径」下的 episode.json，尾帧/视频候选会丢失（见 puller._collect_local_episode_merge_state）
    merge_extra_roots: tuple[Path, ...] | None = None
    if ns is not None:
        merge_extra_roots = (Path(DATA_ROOT).resolve(),)

    try:
        result = do_pull(
            req.episodeId,
            output_root,
            project_id=project_id,
            force_redownload=req.forceRedownload,
            skip_frames=req.skipFrames,
            skip_assets=req.skipAssets,
            skip_images=req.skipImages,
            client=client,
            fs_lock_namespace=fs_tag,
            merge_extra_roots=merge_extra_roots,
        )
        return Episode.model_validate(result)
    except Exception as e:
        detail = str(e) if str(e) else repr(e)
        raise HTTPException(status_code=500, detail=f"拉取失败: {detail}")
