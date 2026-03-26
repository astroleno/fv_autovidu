# -*- coding: utf-8 -*-
"""
数据服务：读写 episode.json，扫描 data/ 目录

提供 Episode 的 CRUD 及 Shot 更新操作，核心为 episode.json。

路径约定：
- 旧版扁平：DATA_ROOT/{projectId}/{episodeId}/episode.json
- 多上下文：DATA_ROOT/{envKey}/{workspaceKey}/{projectId}/{episodeId}/episode.json

namespace_root 为 DATA_ROOT/{envKey}/{workspaceKey} 的绝对路径；为 None 时列表仅扫扁平布局，
且按 episodeId 查找时会先搜命名空间（若传入）再回退扁平目录。
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

_LOG = logging.getLogger(__name__)

# ---------- 并发安全：同一 episode.json 的「读 → 改 → 写」必须串行 ----------
# 并行尾帧会同时调用 update_shot；若不加锁，后写回的线程会覆盖先完成的镜头状态，
# 导致部分镜头永远停在 endframe_generating、但磁盘上 endframes 文件已存在。
_episode_mutation_locks: dict[str, threading.Lock] = {}
_episode_mutation_locks_guard = threading.Lock()


def _mutation_storage_key(episode_id: str, namespace_root: Path | None) -> str:
    """同一 episodeId 在不同命名空间下必须隔离锁，避免跨 workspace 阻塞或错写。"""
    if namespace_root is None:
        return episode_id
    return f"{namespace_root.resolve()}::{episode_id}"


def _episode_mutation_lock(episode_id: str, namespace_root: Path | None = None) -> threading.Lock:
    """返回该剧集专用的互斥锁（懒创建；按 episodeId + 命名空间）。"""
    key = _mutation_storage_key(episode_id, namespace_root)
    with _episode_mutation_locks_guard:
        if key not in _episode_mutation_locks:
            _episode_mutation_locks[key] = threading.Lock()
        return _episode_mutation_locks[key]

from models.schemas import DubStatus, Episode, Shot, VideoCandidate

# 与 web/server/config.py、pull 路由使用同一 DATA_ROOT，避免「拉取写 A 目录、读接口扫 B 目录」导致 404
from config import DATA_ROOT as _CONFIG_DATA_ROOT


def _legacy_data_root() -> Path:
    """全局 DATA_ROOT（旧版扁平布局的根），与 config.DATA_ROOT 一致。"""
    return Path(_CONFIG_DATA_ROOT).resolve()


def _looks_like_env_namespace(dir_path: Path) -> bool:
    """
    若目录结构形如 envKey/workspaceKey/projectId/episodeId/episode.json，则判定为命名空间根，
    避免在「无上下文列表」时把 dev/ 误当作 projectId。

    仅用目录形态启发式判断，不依赖 feeling_contexts.json。
    """
    try:
        for w in dir_path.iterdir():
            if not w.is_dir():
                continue
            for p in w.iterdir():
                if not p.is_dir():
                    continue
                for e in p.iterdir():
                    if e.is_dir() and (e / "episode.json").is_file():
                        return True
    except OSError:
        pass
    return False


def _score_episode_dir(ep_dir: Path) -> tuple[int, int, str]:
    """
    历史多副本并存时的择优键（过渡期）：画面描述更全 > 非 proj-default > pulledAt 更新。
    单副本归一化完成后不应再出现多目录；保留本逻辑避免上线瞬间「纯路径序」读到更差副本。
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


def _collect_episode_dirs_for_id(
    episode_id: str,
    namespace_root: Path | None = None,
) -> list[Path]:
    """
    收集 episodeId 匹配的剧集目录。

    若传入 namespace_root，先在其下查找；无论是否传入，都会再扫描旧版扁平 DATA_ROOT
    （跳过「疑似环境命名空间」顶层目录），用于迁移期回退读。
    """
    out: list[Path] = []
    seen: set[str] = set()

    def _add(ep_dir: Path) -> None:
        key = str(ep_dir.resolve())
        if key not in seen:
            seen.add(key)
            out.append(ep_dir)

    if namespace_root is not None:
        nr = namespace_root.resolve()
        if nr.exists():
            for proj_dir in nr.iterdir():
                if not proj_dir.is_dir():
                    continue
                ep_dir = proj_dir / episode_id
                if ep_dir.is_dir() and (ep_dir / "episode.json").exists():
                    _add(ep_dir)

    root = _legacy_data_root()
    if root.exists():
        for proj_dir in root.iterdir():
            if not proj_dir.is_dir():
                continue
            if _looks_like_env_namespace(proj_dir):
                continue
            ep_dir = proj_dir / episode_id
            if ep_dir.is_dir() and (ep_dir / "episode.json").exists():
                _add(ep_dir)
    return out


def _find_episode_dir(episode_id: str, namespace_root: Path | None = None) -> Path | None:
    """
    根据 episodeId 查找 episode.json 所在目录。

    单副本归一化后通常唯一；若仍存在历史多副本，择优并打 WARNING（不依赖路径字典序）。
    """
    matches = _collect_episode_dirs_for_id(episode_id, namespace_root)
    if not matches:
        return None
    if len(matches) > 1:
        matches.sort(key=lambda p: str(p))
        _LOG.warning(
            "episodeId=%s 存在 %d 个副本: %s — 请重新拉取该剧集以触发归一化清理",
            episode_id,
            len(matches),
            [str(m) for m in matches],
        )
    return _pick_best_episode_dir(matches)


def list_episodes(namespace_root: Path | None = None) -> list[dict[str, Any]]:
    """
    列出本地已拉取的 Episode（GET /api/episodes）。

    Args:
        namespace_root: 多上下文时为 DATA_ROOT/env/workspace；为 None 时仅扫扁平布局
            （顶层目录若疑似 env 命名空间则跳过，避免把 dev/ 当项目）。

    同一 episodeId 多目录时择优保留一条；仍多副本时打 WARNING。
    """
    project_parents: list[Path] = []
    if namespace_root is not None:
        nr = namespace_root.resolve()
        if nr.is_dir():
            project_parents.append(nr)
    else:
        legacy = _legacy_data_root()
        if legacy.exists():
            for top in legacy.iterdir():
                if not top.is_dir():
                    continue
                if _looks_like_env_namespace(top):
                    continue
                project_parents.append(top)

    if not project_parents:
        return []

    by_eid: dict[str, list[Path]] = {}
    for proj_dir in project_parents:
        if not proj_dir.exists() or not proj_dir.is_dir():
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
    for eid, dirs in sorted(by_eid.items(), key=lambda x: x[0]):
        dirs_sorted = sorted(dirs, key=lambda p: str(p))
        best = _pick_best_episode_dir(dirs_sorted)
        if not best:
            continue
        if len(dirs_sorted) > 1:
            _LOG.warning(
                "episodeId=%s 重复 %d 处 — 请重新拉取以归一化: %s",
                eid,
                len(dirs_sorted),
                [str(d) for d in dirs_sorted],
            )
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


def get_episode(episode_id: str, namespace_root: Path | None = None) -> Episode | None:
    """
    获取单个 Episode 完整数据。

    Args:
        episode_id: Episode UUID
        namespace_root: 多上下文数据子根；None 时仅扁平回退扫描

    Returns:
        Episode 或 None（未找到）
    """
    ep_dir = _find_episode_dir(episode_id, namespace_root)
    if not ep_dir:
        return None
    json_path = ep_dir / "episode.json"
    data = json.loads(json_path.read_text(encoding="utf-8"))
    return Episode.model_validate(data)


def get_episode_dir(episode_id: str, namespace_root: Path | None = None) -> Path | None:
    """获取 Episode 数据目录路径。"""
    return _find_episode_dir(episode_id, namespace_root)


def get_shot(
    episode_id: str,
    shot_id: str,
    namespace_root: Path | None = None,
) -> Shot | None:
    """从 Episode 中获取单个 Shot。"""
    ep = get_episode(episode_id, namespace_root)
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


def set_shot_dub(
    episode_id: str,
    shot_id: str,
    dub: DubStatus | None,
    namespace_root: Path | None = None,
) -> Shot | None:
    """
    设置分镜的 dub 字段并落盘（None 表示清除配音元数据）。
    """
    with _episode_mutation_lock(episode_id, namespace_root):
        ep_dir = _find_episode_dir(episode_id, namespace_root)
        if not ep_dir:
            return None
        ep = get_episode(episode_id, namespace_root)
        if not ep:
            return None
        for scene in ep.scenes:
            for i, shot in enumerate(scene.shots):
                if shot.shotId == shot_id:
                    scene.shots[i] = shot.model_copy(update={"dub": dub})
                    _save_episode(ep_dir, ep)
                    return scene.shots[i]
        return None


def persist_episode(episode: Episode, namespace_root: Path | None = None) -> None:
    """
    将完整 Episode 写回磁盘（用于更新 jianyingExport、dub 等根级或嵌套字段）。

    Args:
        episode: 内存中的完整 Episode
        namespace_root: 数据子根

    Raises:
        ValueError: 未找到对应剧集目录
    """
    with _episode_mutation_lock(episode.episodeId, namespace_root):
        ep_dir = _find_episode_dir(episode.episodeId, namespace_root)
        if not ep_dir:
            raise ValueError("Episode not found")
        _save_episode(ep_dir, episode)


def update_shot(
    episode_id: str,
    shot_id: str,
    updates: dict[str, Any],
    namespace_root: Path | None = None,
) -> Shot | None:
    """
    更新 Shot 字段。

    Args:
        episode_id: Episode UUID
        shot_id: Shot UUID
        updates: 要更新的字段（如 status, endFrame, imagePrompt 等）
        namespace_root: 数据子根

    Returns:
        更新后的 Shot，未找到返回 None
    """
    with _episode_mutation_lock(episode_id, namespace_root):
        ep_dir = _find_episode_dir(episode_id, namespace_root)
        if not ep_dir:
            return None
        ep = get_episode(episode_id, namespace_root)
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


def update_shot_status(
    episode_id: str,
    shot_id: str,
    status: str,
    namespace_root: Path | None = None,
) -> Shot | None:
    """更新 Shot 状态。"""
    return update_shot(episode_id, shot_id, {"status": status}, namespace_root)


def add_video_candidate(
    episode_id: str,
    shot_id: str,
    candidate: VideoCandidate,
    namespace_root: Path | None = None,
) -> Shot | None:
    """向 Shot 添加视频候选。"""
    with _episode_mutation_lock(episode_id, namespace_root):
        ep_dir = _find_episode_dir(episode_id, namespace_root)
        if not ep_dir:
            return None
        ep = get_episode(episode_id, namespace_root)
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
    namespace_root: Path | None = None,
) -> Shot | None:
    """
    更新指定 VideoCandidate 的字段（如 videoPath、taskStatus、thumbnailPath）。

    Args:
        episode_id: Episode UUID
        shot_id: Shot UUID
        candidate_id: 候选 id
        updates: 要合并到候选上的字段（与 VideoCandidate 字段名一致）
        namespace_root: 数据子根
    """
    with _episode_mutation_lock(episode_id, namespace_root):
        ep_dir = _find_episode_dir(episode_id, namespace_root)
        if not ep_dir:
            return None
        ep = get_episode(episode_id, namespace_root)
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
    namespace_root: Path | None = None,
) -> Shot | None:
    """
    选定某个视频候选。
    将指定 candidate 的 selected 置为 True，其他置为 False，并更新 shot.status 为 "selected"。
    若切换为非 dub.sourceCandidateId 对应候选，则将 dub 标记为 stale（需重新配音）。
    """
    with _episode_mutation_lock(episode_id, namespace_root):
        ep_dir = _find_episode_dir(episode_id, namespace_root)
        if not ep_dir:
            return None
        ep = get_episode(episode_id, namespace_root)
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


def resolve_file_path(
    episode_id: str,
    relative_path: str,
    namespace_root: Path | None = None,
) -> Path | None:
    """
    解析相对路径为绝对路径。

    relative_path 相对于 data/{projectId}/{episodeId}/，如 frames/S01.png。

    Returns:
        绝对路径，若文件不存在或路径非法则返回 None
    """
    ep_dir = _find_episode_dir(episode_id, namespace_root)
    if not ep_dir:
        return None
    # 防止路径穿越
    p = (ep_dir / relative_path).resolve()
    if not str(p).startswith(str(ep_dir.resolve())):
        return None
    return p if p.exists() else None
