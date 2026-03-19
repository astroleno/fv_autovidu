# -*- coding: utf-8 -*-
"""
数据服务：读写 episode.json，扫描 data/ 目录

提供 Episode 的 CRUD 及 Shot 更新操作，所有数据以 data/{projectId}/{episodeId}/episode.json 为核心。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from models.schemas import Episode, Shot, VideoCandidate


def _get_data_root() -> Path:
    """从环境变量获取数据根目录，默认为项目根目录下的 data/。"""
    import os
    root = os.environ.get("DATA_ROOT", "data")
    p = Path(root)
    if not p.is_absolute():
        # web/server/services/data_service.py -> 上溯到项目根
        proj_root = Path(__file__).resolve().parent.parent.parent.parent
        p = (proj_root / root).resolve()
    return p


def _find_episode_dir(episode_id: str) -> Path | None:
    """
    根据 episodeId 查找 episode.json 所在目录。
    扫描 DATA_ROOT/*/*/episode.json，匹配 episodeId。
    """
    root = _get_data_root()
    if not root.exists():
        return None
    for proj_dir in root.iterdir():
        if not proj_dir.is_dir():
            continue
        ep_dir = proj_dir / episode_id
        if ep_dir.is_dir() and (ep_dir / "episode.json").exists():
            return ep_dir
    return None


def list_episodes() -> list[dict[str, Any]]:
    """
    列出所有本地已拉取的 Episode。

    扫描 DATA_ROOT/{projectId}/{episodeId}/episode.json，
    返回 Episode 摘要列表（用于 GET /api/episodes）。
    """
    root = _get_data_root()
    if not root.exists():
        return []
    result: list[dict[str, Any]] = []
    for proj_dir in root.iterdir():
        if not proj_dir.is_dir():
            continue
        for ep_dir in proj_dir.iterdir():
            if not ep_dir.is_dir():
                continue
            json_path = ep_dir / "episode.json"
            if not json_path.exists():
                continue
            try:
                data = json.loads(json_path.read_text(encoding="utf-8"))
                result.append({
                    "projectId": data.get("projectId", proj_dir.name),
                    "episodeId": data.get("episodeId", ep_dir.name),
                    "episodeTitle": data.get("episodeTitle", ""),
                    "episodeNumber": data.get("episodeNumber", 0),
                    "pulledAt": data.get("pulledAt", ""),
                    "scenes": data.get("scenes", []),
                })
            except Exception:
                continue
    return result


def get_episode(episode_id: str) -> Episode | None:
    """
    获取单个 Episode 完整数据。

    Args:
        episode_id: Episode UUID

    Returns:
        Episode 或 None（未找到）
    """
    ep_dir = _find_episode_dir(episode_id)
    if not ep_dir:
        return None
    json_path = ep_dir / "episode.json"
    data = json.loads(json_path.read_text(encoding="utf-8"))
    return Episode.model_validate(data)


def get_episode_dir(episode_id: str) -> Path | None:
    """获取 Episode 数据目录路径。"""
    return _find_episode_dir(episode_id)


def get_shot(episode_id: str, shot_id: str) -> Shot | None:
    """从 Episode 中获取单个 Shot。"""
    ep = get_episode(episode_id)
    if not ep:
        return None
    for scene in ep.scenes:
        for shot in scene.shots:
            if shot.shotId == shot_id:
                return shot
    return None


def _save_episode(ep_dir: Path, episode: Episode) -> None:
    """将 Episode 写回 episode.json。"""
    json_path = ep_dir / "episode.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(episode.model_dump(mode="json"), f, ensure_ascii=False, indent=2)


def update_shot(episode_id: str, shot_id: str, updates: dict[str, Any]) -> Shot | None:
    """
    更新 Shot 字段。

    Args:
        episode_id: Episode UUID
        shot_id: Shot UUID
        updates: 要更新的字段（如 status, endFrame, imagePrompt 等）

    Returns:
        更新后的 Shot，未找到返回 None
    """
    ep_dir = _find_episode_dir(episode_id)
    if not ep_dir:
        return None
    ep = get_episode(episode_id)
    if not ep:
        return None
    for scene in ep.scenes:
        for i, shot in enumerate(scene.shots):
            if shot.shotId == shot_id:
                d = shot.model_dump()
                for k, v in updates.items():
                    if k in d:
                        d[k] = v
                scene.shots[i] = Shot.model_validate(d)
                _save_episode(ep_dir, ep)
                return scene.shots[i]
    return None


def update_shot_status(episode_id: str, shot_id: str, status: str) -> Shot | None:
    """更新 Shot 状态。"""
    return update_shot(episode_id, shot_id, {"status": status})


def add_video_candidate(
    episode_id: str,
    shot_id: str,
    candidate: VideoCandidate,
) -> Shot | None:
    """向 Shot 添加视频候选。"""
    ep_dir = _find_episode_dir(episode_id)
    if not ep_dir:
        return None
    ep = get_episode(episode_id)
    if not ep:
        return None
    for scene in ep.scenes:
        for i, shot in enumerate(scene.shots):
            if shot.shotId == shot_id:
                cand_list = list(shot.videoCandidates)
                cand_list.append(candidate)
                scene.shots[i] = shot.model_copy(update={"videoCandidates": cand_list})
                _save_episode(ep_dir, ep)
                return scene.shots[i]
    return None


def select_candidate(
    episode_id: str,
    shot_id: str,
    candidate_id: str,
) -> Shot | None:
    """
    选定某个视频候选。
    将指定 candidate 的 selected 置为 True，其他置为 False，并更新 shot.status 为 "selected"。
    """
    ep_dir = _find_episode_dir(episode_id)
    if not ep_dir:
        return None
    ep = get_episode(episode_id)
    if not ep:
        return None
    for scene in ep.scenes:
        for i, shot in enumerate(scene.shots):
            if shot.shotId == shot_id:
                new_candidates = []
                for c in shot.videoCandidates:
                    new_candidates.append(
                        c.model_copy(update={"selected": c.id == candidate_id})
                    )
                scene.shots[i] = shot.model_copy(
                    update={
                        "videoCandidates": new_candidates,
                        "status": "selected",
                    }
                )
                _save_episode(ep_dir, ep)
                return scene.shots[i]
    return None


def resolve_file_path(episode_id: str, relative_path: str) -> Path | None:
    """
    解析相对路径为绝对路径。

    relative_path 相对于 data/{projectId}/{episodeId}/，如 frames/S01.png。

    Returns:
        绝对路径，若文件不存在或路径非法则返回 None
    """
    ep_dir = _find_episode_dir(episode_id)
    if not ep_dir:
        return None
    # 防止路径穿越
    p = (ep_dir / relative_path).resolve()
    if not str(p).startswith(str(ep_dir.resolve())):
        return None
    return p if p.exists() else None
