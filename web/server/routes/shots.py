# -*- coding: utf-8 -*-
"""
Shot 路由：GET list/detail, PATCH update, POST select
"""

import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from fastapi import APIRouter, Body, HTTPException

from models.schemas import Shot, SelectCandidateRequest
from services import data_service

router = APIRouter()


def _flatten_shots(ep):
    """从 Episode 提取扁平 Shot 列表。"""
    shots = []
    for scene in ep.scenes:
        shots.extend(scene.shots)
    return shots


@router.get("/episodes/{episode_id}/shots", response_model=list[Shot])
def list_shots(episode_id: str):
    """获取 Episode 下所有 Shot（扁平列表）。"""
    ep = data_service.get_episode(episode_id)
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    return _flatten_shots(ep)


@router.get("/episodes/{episode_id}/shots/{shot_id}", response_model=Shot)
def get_shot(episode_id: str, shot_id: str):
    """获取单个 Shot。"""
    shot = data_service.get_shot(episode_id, shot_id)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    return shot


@router.patch("/episodes/{episode_id}/shots/{shot_id}", response_model=Shot)
def update_shot(episode_id: str, shot_id: str, updates: dict = Body(default_factory=dict)):
    """更新 Shot 字段。"""
    shot = data_service.update_shot(episode_id, shot_id, updates or {})
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    return shot


@router.post("/episodes/{episode_id}/shots/{shot_id}/select", response_model=Shot)
def select_candidate(episode_id: str, shot_id: str, req: SelectCandidateRequest):
    """选定某个视频候选。"""
    shot = data_service.select_candidate(episode_id, shot_id, req.candidateId)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot or candidate not found")
    return shot
