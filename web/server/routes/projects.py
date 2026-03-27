# -*- coding: utf-8 -*-
"""
项目（Project）路由：列表、详情、合并剧集列表、一键拉取全部。

前缀在 main.py 中挂载为 /api，因此本模块内路径为 /projects。
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_SERVER_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _SERVER_DIR.parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from models.schemas import (
    ProjectDetail,
    ProjectEpisodeItem,
    ProjectEpisodeListResponse,
    ProjectSummary,
    PullProjectResponse,
    PullProjectFailedItem,
)
from services import data_service
from services.context_service import (
    get_feeling_client,
    get_feeling_context,
    get_namespace_data_root_optional,
)

router = APIRouter()


def _pick(obj: dict[str, Any], *keys: str, default: Any = "") -> Any:
    """从 dict 中取多个候选 key 的第一个非空值。"""
    for k in keys:
        if k in obj and obj[k] is not None:
            return obj[k]
    return default


def _map_remote_project(raw: dict[str, Any]) -> dict[str, Any]:
    """将平台项目 dict 规范为 ProjectSummary 所需字段。"""
    pid = str(_pick(raw, "id", "projectId", default=""))
    title = str(_pick(raw, "title", "name", default="") or "")
    desc = str(_pick(raw, "description", "desc", "summary", default="") or "")
    cover = _pick(raw, "coverImage", "coverUrl", "thumbnail", "imageUrl", default=None)
    cover_s = str(cover) if cover else None
    created = _pick(raw, "createdAt", "created_at", default=None)
    updated = _pick(raw, "updatedAt", "updated_at", default=None)
    # 平台可能直接返回剧集数
    ep_count = _pick(raw, "episodeCount", "episode_count", "totalEpisodes", default=None)
    try:
        episode_count = int(ep_count) if ep_count is not None else 0
    except (TypeError, ValueError):
        episode_count = 0
    return {
        "projectId": pid,
        "title": title,
        "description": desc,
        "coverImage": cover_s,
        "episodeCount": episode_count,
        "createdAt": str(created) if created else None,
        "updatedAt": str(updated) if updated else None,
    }


def _local_episodes_by_project(namespace_root: Path | None) -> dict[str, list[dict[str, Any]]]:
    """按 projectId 聚合本地已拉取剧集摘要。"""
    out: dict[str, list[dict[str, Any]]] = {}
    for ep in data_service.list_episodes(namespace_root):
        pid = str(ep.get("projectId", "") or "")
        if not pid:
            continue
        out.setdefault(pid, []).append(ep)
    return out


def _pulled_count_for_project(project_id: str, by_project: dict[str, list[dict[str, Any]]]) -> int:
    """某项目下本地已有 episode 目录数量（去重 episodeId）。"""
    eps = by_project.get(project_id, [])
    seen: set[str] = set()
    for e in eps:
        eid = str(e.get("episodeId", ""))
        if eid:
            seen.add(eid)
    return len(seen)


def _merge_episode_lists(
    project_id: str,
    remote_eps: list[dict[str, Any]],
    local_eps: list[dict[str, Any]],
) -> list[ProjectEpisodeItem]:
    """
    远端列表为主，与本地按 episodeId 做并集；再补充 local_only。
    """
    remote_ids: set[str] = set()
    items: list[ProjectEpisodeItem] = []

    local_by_id: dict[str, dict[str, Any]] = {}
    for le in local_eps:
        eid = str(le.get("episodeId", ""))
        if eid:
            local_by_id[eid] = le

    for i, ep in enumerate(remote_eps):
        eid = str(_pick(ep, "id", "episodeId", default=""))
        if not eid:
            continue
        remote_ids.add(eid)
        title = str(_pick(ep, "title", "episodeTitle", "name", default=f"第{i + 1}集"))
        try:
            num = int(_pick(ep, "episodeNumber", "episode_number", "number", default=i + 1))
        except (TypeError, ValueError):
            num = i + 1
        loc = local_by_id.get(eid)
        if loc:
            items.append(
                ProjectEpisodeItem(
                    episodeId=eid,
                    title=str(loc.get("episodeTitle") or title),
                    episodeNumber=int(loc.get("episodeNumber", num) or num),
                    source="remote_and_local",
                    pulledLocally=True,
                    localProjectId=str(loc.get("projectId", project_id)),
                    pulledAt=str(loc.get("pulledAt") or "") or None,
                )
            )
        else:
            items.append(
                ProjectEpisodeItem(
                    episodeId=eid,
                    title=title,
                    episodeNumber=num,
                    source="remote_only",
                    pulledLocally=False,
                    localProjectId=None,
                    pulledAt=None,
                )
            )

    # local_only：本地有而远端列表无
    for eid, le in local_by_id.items():
        if eid not in remote_ids:
            items.append(
                ProjectEpisodeItem(
                    episodeId=eid,
                    title=str(le.get("episodeTitle", "")),
                    episodeNumber=int(le.get("episodeNumber", 0) or 0),
                    source="local_only",
                    pulledLocally=True,
                    localProjectId=str(le.get("projectId", project_id)),
                    pulledAt=str(le.get("pulledAt", "") or "") or None,
                )
            )

    def sort_key(x: ProjectEpisodeItem) -> tuple[int, str, str]:
        return (x.episodeNumber if x.episodeNumber else 10**9, x.title.lower(), x.episodeId)

    items.sort(key=sort_key)
    return items


@router.get("/projects", response_model=list[ProjectSummary])
def list_projects(request: Request):
    """项目列表：平台项目 + 本地 pulledEpisodeCount。"""
    ns = get_namespace_data_root_optional(request)
    try:
        client = get_feeling_client(request)
        raw_list = client.get_projects()
    except Exception as e:
        detail = str(e) if str(e) else repr(e)
        raise HTTPException(status_code=502, detail=f"获取平台项目列表失败: {detail}") from e

    by_proj = _local_episodes_by_project(ns)
    result: list[ProjectSummary] = []
    for raw in raw_list:
        m = _map_remote_project(raw)
        pid = m["projectId"]
        if not pid:
            continue
        pulled = _pulled_count_for_project(pid, by_proj)
        # episodeCount 优先用列表接口返回；缺省为 0（避免列表页对每个项目再请求剧集接口）
        try:
            ep_count = int(m.get("episodeCount") or 0)
        except (TypeError, ValueError):
            ep_count = 0
        result.append(
            ProjectSummary(
                projectId=pid,
                title=m.get("title") or "",
                description=m.get("description") or "",
                coverImage=m.get("coverImage"),
                episodeCount=ep_count,
                pulledEpisodeCount=pulled,
                createdAt=m.get("createdAt"),
                updatedAt=m.get("updatedAt"),
            )
        )
    return result


@router.get("/projects/{project_id}", response_model=ProjectDetail)
def get_project_detail(project_id: str, request: Request):
    """单项目详情（与列表项字段一致）。"""
    ns = get_namespace_data_root_optional(request)
    try:
        client = get_feeling_client(request)
        raw = client.get_project(project_id)
    except Exception as e:
        detail = str(e) if str(e) else repr(e)
        raise HTTPException(status_code=502, detail=f"获取平台项目失败: {detail}") from e

    by_proj = _local_episodes_by_project(ns)
    m = _map_remote_project(raw if raw else {"id": project_id})
    if not m.get("projectId"):
        m["projectId"] = project_id
    pid = str(m["projectId"])
    pulled = _pulled_count_for_project(pid, by_proj)
    ep_count = int(m.get("episodeCount") or 0)
    if ep_count == 0:
        try:
            ep_count = len(client.get_project_episodes(pid))
        except Exception:
            ep_count = 0

    return ProjectDetail(
        projectId=pid,
        title=str(m.get("title") or ""),
        description=str(m.get("description") or ""),
        coverImage=m.get("coverImage"),
        episodeCount=ep_count,
        pulledEpisodeCount=pulled,
        createdAt=m.get("createdAt"),
        updatedAt=m.get("updatedAt"),
    )


@router.get("/projects/{project_id}/episodes", response_model=ProjectEpisodeListResponse)
def list_project_episodes(project_id: str, request: Request):
    """远端剧集 + 本地拉取状态合并。"""
    ns = get_namespace_data_root_optional(request)
    try:
        client = get_feeling_client(request)
        remote = client.get_project_episodes(project_id)
        raw_proj = client.get_project(project_id)
    except Exception as e:
        detail = str(e) if str(e) else repr(e)
        raise HTTPException(status_code=502, detail=f"获取平台项目剧集失败: {detail}") from e

    m = _map_remote_project(raw_proj if raw_proj else {"id": project_id})
    if not m.get("projectId"):
        m["projectId"] = project_id
    title = str(m.get("title") or project_id)
    local_all = data_service.list_episodes(ns)
    local_for_project = [e for e in local_all if str(e.get("projectId", "")) == project_id]

    episodes = _merge_episode_lists(project_id, remote, local_for_project)
    return ProjectEpisodeListResponse(
        project={"projectId": m["projectId"], "title": title},
        episodes=episodes,
    )


class PullAllBody(BaseModel):
    """可选：一键拉取时的覆盖策略与首帧/资产下载范围。"""

    forceRedownload: bool = False
    skipImages: bool = False
    skipFrames: bool = False
    skipAssets: bool = False


@router.post("/projects/{project_id}/pull-all", response_model=PullProjectResponse)
def pull_all_project_episodes(project_id: str, request: Request, body: PullAllBody | None = None):
    """一键拉取项目下全部剧集；单集失败不导致整批 500。"""
    try:
        from src.feeling.puller import pull_project_with_report
    except ImportError:
        raise HTTPException(status_code=500, detail="puller 模块未找到，请从项目根目录运行")

    from config import DATA_ROOT

    ns = get_namespace_data_root_optional(request)
    output_root = Path(ns) if ns is not None else Path(DATA_ROOT)
    ctx = get_feeling_context(request)
    fs_tag = f"{ctx.env_key}/{ctx.workspace_key}" if ctx else ""
    client = get_feeling_client(request)

    opts = body or PullAllBody()
    try:
        report = pull_project_with_report(
            project_id,
            output_root,
            client=client,
            force_redownload=opts.forceRedownload,
            skip_frames=opts.skipFrames,
            skip_assets=opts.skipAssets,
            skip_images=opts.skipImages,
            fs_lock_namespace=fs_tag,
        )
    except Exception as e:
        detail = str(e) if str(e) else repr(e)
        raise HTTPException(status_code=500, detail=f"拉取项目失败: {detail}") from e

    requested = report.requested
    failed = [
        PullProjectFailedItem(episodeId=x["episodeId"], message=x.get("message", ""))
        for x in report.failed_episodes
    ]
    return PullProjectResponse(
        projectId=project_id,
        requested=requested,
        successCount=report.success_count,
        failedCount=len(failed),
        failedEpisodes=failed,
    )
