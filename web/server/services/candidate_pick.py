# -*- coding: utf-8 -*-
"""
视频候选选取（导出 / 粗剪时间线）

与前端 TimelinePage 逻辑一致：有 videoPath 的候选中优先 selected，否则第一条。
避免用户仅「视频完成」、未在镜头详情点「选定」时，时间线与导出始终为空。
"""
from __future__ import annotations

from models.schemas import Shot, VideoCandidate


def pick_playable_video_candidate(shot: Shot) -> VideoCandidate | None:
    """返回用于播放/拼接/剪映的候选；若无落盘视频则 None。"""
    with_path = [c for c in shot.videoCandidates if (c.videoPath or "").strip()]
    if not with_path:
        return None
    for c in with_path:
        if c.selected:
            return c
    return with_path[0]
