# -*- coding: utf-8 -*-
"""
数据服务：读写 episode.json，扫描 data/ 目录

提供 Episode 的 CRUD 及 Shot 更新操作，所有数据以 data/{projectId}/{episodeId}/episode.json 为核心。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from models.schemas import DubStatus, Episode, Shot, VideoCandidate


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


def _score_episode_dir(ep_dir: Path) -> tuple[int, int, str]:
    """
    用于在多个目录对应同一 episodeId 时择优。
    优先：含画面描述 shot 更多 > 非 proj-default > pulledAt 更新。
    """
    try:
        data = json.loads((ep_dir / "episode.json").read_text(encoding="utf-8"))
    except Exception:
        return (0, 0, "")
    pid = data.get("projectId", "")
    pulled = data.get("pulledAt", "")
    vd_count = 0
    for sc in data.get("scenes", []):
        for sh in sc.get("shots", []):
            if (sh.get("visualDescription") or "").strip():
                vd_count += 1
    prefer_real_project = 0 if pid == "proj-default" else 1
    return (vd_count, prefer_real_project, pulled)


def _pick_best_episode_dir(candidates: list[Path]) -> Path | None:
    """从多个候选目录中选最优 episode.json 所在目录。"""
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    return max(candidates, key=_score_episode_dir)


def _collect_episode_dirs_for_id(episode_id: str) -> list[Path]:
    """收集 DATA_ROOT 下所有 episodeId 匹配的剧集目录。"""
    root = _get_data_root()
    if not root.exists():
        return []
    out: list[Path] = []
    for proj_dir in root.iterdir():
        if not proj_dir.is_dir():
            continue
        ep_dir = proj_dir / episode_id
        if ep_dir.is_dir() and (ep_dir / "episode.json").exists():
            out.append(ep_dir)
    return out


def _find_episode_dir(episode_id: str) -> Path | None:
    """
    根据 episodeId 查找 episode.json 所在目录。
    若存在多个 data/{projectId}/{episodeId}/（如 proj-default 与真实项目各一份），
    择优返回含 visualDescription 更完整、且非占位 projectId 的一份。
    """
    return _pick_best_episode_dir(_collect_episode_dirs_for_id(episode_id))


def list_episodes() -> list[dict[str, Any]]:
    """
    列出所有本地已拉取的 Episode。

    扫描 DATA_ROOT/{projectId}/{episodeId}/episode.json，
    返回 Episode 摘要列表（用于 GET /api/episodes）。
    同一 episodeId 多目录时只保留择优后的一条，避免列表重复且读到缺字段的旧副本。
    """
    root = _get_data_root()
    if not root.exists():
        return []
    # episodeId -> 该 id 下所有 episode 目录
    by_eid: dict[str, list[Path]] = {}
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
                eid = str(data.get("episodeId", ep_dir.name))
                by_eid.setdefault(eid, []).append(ep_dir)
            except Exception:
                continue

    result: list[dict[str, Any]] = []
    for eid, dirs in by_eid.items():
        best = _pick_best_episode_dir(dirs)
        if not best:
            continue
        try:
            data = json.loads((best / "episode.json").read_text(encoding="utf-8"))
            result.append({
                "projectId": data.get("projectId", best.parent.name),
                "episodeId": data.get("episodeId", eid),
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


def set_shot_dub(episode_id: str, shot_id: str, dub: DubStatus | None) -> Shot | None:
    """
    设置分镜的 dub 字段并落盘（None 表示清除配音元数据）。
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
                scene.shots[i] = shot.model_copy(update={"dub": dub})
                _save_episode(ep_dir, ep)
                return scene.shots[i]
    return None


def persist_episode(episode: Episode) -> None:
    """
    将完整 Episode 写回磁盘（用于更新 jianyingExport、dub 等根级或嵌套字段）。

    Args:
        episode: 内存中的完整 Episode

    Raises:
        ValueError: 未找到对应剧集目录
    """
    ep_dir = _find_episode_dir(episode.episodeId)
    if not ep_dir:
        raise ValueError("Episode not found")
    _save_episode(ep_dir, episode)


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


def update_video_candidate(
    episode_id: str,
    shot_id: str,
    candidate_id: str,
    updates: dict[str, Any],
) -> Shot | None:
    """
    更新指定 VideoCandidate 的字段（如 videoPath、taskStatus、thumbnailPath）。

    Args:
        episode_id: Episode UUID
        shot_id: Shot UUID
        candidate_id: 候选 id
        updates: 要合并到候选上的字段（与 VideoCandidate 字段名一致）
    """
    ep_dir = _find_episode_dir(episode_id)
    if not ep_dir:
        return None
    ep = get_episode(episode_id)
    if not ep:
        return None
    for scene in ep.scenes:
        for i, shot in enumerate(scene.shots):
            if shot.shotId != shot_id:
                continue
            new_list: list[VideoCandidate] = []
            found = False
            for c in shot.videoCandidates:
                if c.id == candidate_id:
                    d = c.model_dump()
                    for k, v in updates.items():
                        if k in d:
                            d[k] = v
                    new_list.append(VideoCandidate.model_validate(d))
                    found = True
                else:
                    new_list.append(c)
            if not found:
                return None
            scene.shots[i] = shot.model_copy(update={"videoCandidates": new_list})
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
    若切换为非 dub.sourceCandidateId 对应候选，则将 dub 标记为 stale（需重新配音）。
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
                new_dub = shot.dub
                if shot.dub and shot.dub.sourceCandidateId:
                    if shot.dub.sourceCandidateId != candidate_id:
                        new_dub = shot.dub.model_copy(
                            update={
                                "status": "stale",
                                "error": "已切换视频候选，需重新配音",
                            }
                        )
                scene.shots[i] = shot.model_copy(
                    update={
                        "videoCandidates": new_candidates,
                        "status": "selected",
                        "dub": new_dub,
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
