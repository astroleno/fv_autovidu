# -*- coding: utf-8 -*-
"""
Shot 路由：GET list/detail, PATCH update, POST select
"""

import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from fastapi import APIRouter, Body, HTTPException, Request

from models.schemas import Shot, SelectCandidateRequest
from services import data_service
from services.context_service import get_namespace_data_root_optional

router = APIRouter()


def _flatten_shots(ep):
    """从 Episode 提取扁平 Shot 列表。"""
    shots = []
    for scene in ep.scenes:
        shots.extend(scene.shots)
    return shots


@router.get("/episodes/{episode_id}/shots", response_model=list[Shot])
def list_shots(episode_id: str, request: Request):
    """获取 Episode 下所有 Shot（扁平列表）。"""
    ns = get_namespace_data_root_optional(request)
    ep = data_service.get_episode(episode_id, ns)
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    return _flatten_shots(ep)


@router.get("/episodes/{episode_id}/shots/{shot_id}", response_model=Shot)
def get_shot(episode_id: str, shot_id: str, request: Request):
    """获取单个 Shot。"""
    ns = get_namespace_data_root_optional(request)
    shot = data_service.get_shot(episode_id, shot_id, ns)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    return shot


@router.patch("/episodes/{episode_id}/shots/{shot_id}", response_model=Shot)
def update_shot(
    episode_id: str,
    shot_id: str,
    request: Request,
    updates: dict = Body(default_factory=dict),
):
    """更新 Shot 字段。"""
    ns = get_namespace_data_root_optional(request)
    shot = data_service.update_shot(episode_id, shot_id, updates or {}, ns)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    return shot


@router.post("/episodes/{episode_id}/shots/{shot_id}/select", response_model=Shot)
def select_candidate(episode_id: str, shot_id: str, req: SelectCandidateRequest, request: Request):
    """选定某个视频候选。"""
    ns = get_namespace_data_root_optional(request)
    shot = data_service.select_candidate(episode_id, shot_id, req.candidateId, ns)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot or candidate not found")
    return shot
