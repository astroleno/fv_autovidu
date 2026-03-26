# -*- coding: utf-8 -*-
"""
任务状态路由：GET /tasks/:taskId, GET /tasks/batch

任务状态持久化在 SQLite（DATA_ROOT/tasks.db），读接口**仅查询**，
不再触发 Vidu 查询、下载或写 episode.json（由 task_store.video_finalizer 后台完成）。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from pathlib import Path

from fastapi import APIRouter, Query, Request

from models.schemas import TaskStatusResponse
from services.context_service import (
    get_context_task_id,
    namespace_root_from_context_id,
)
from services.task_store import TaskRow, get_task_store

router = APIRouter()


def _namespace_for_task_row(row: TaskRow) -> Path | None:
    """任务创建时写入的 context_id → 数据命名空间；旧任务无 context_id 则仅扁平布局。"""
    return namespace_root_from_context_id(row.context_id)


def _reconcile_awaiting_video_if_episode_has_file(row: TaskRow) -> TaskRow:
    """
    若 SQLite 仍为 awaiting_external，但 episode 里该候选已有 videoPath，
    则补写 success（与 video_finalizer 幂等），避免 GET /tasks/batch 长期返回 processing、前端轮询空转。
    """
    if row.status != "awaiting_external" or row.kind != "video":
        return row
    if not row.episode_id or not row.shot_id or not row.candidate_id:
        return row
    from services import data_service

    ns = _namespace_for_task_row(row)
    shot = data_service.get_shot(row.episode_id, row.shot_id, ns)
    if not shot:
        return row
    cand = next((c for c in shot.videoCandidates if c.id == row.candidate_id), None)
    if not cand or not str(cand.videoPath or "").strip():
        return row
    store = get_task_store()
    meta = row.result if isinstance(row.result, dict) else {}
    store.set_task(
        row.id,
        "success",
        kind="video",
        episode_id=row.episode_id,
        shot_id=row.shot_id,
        candidate_id=row.candidate_id,
        external_task_id=row.external_task_id,
        result={**meta, "videoPath": cand.videoPath},
        context_id=row.context_id,
    )
    return store.get_task_row(row.id) or row


def _get_vidu_client():
    """获取 ViduClient（用于无前缀的裸 Vidu task id 回退查询）。"""
    try:
        from src.vidu.client import ViduClient
    except ImportError:
        return None
    key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not key:
        return None
    return ViduClient(api_key=key)


@router.get("/tasks/{task_id}", response_model=TaskStatusResponse)
def get_task_status(task_id: str, request: Request):
    """查询单个任务状态（仅读 SQLite；无记录时再尝试 Vidu 直连查询）。"""
    store = get_task_store()
    row = store.get_task_row(task_id)
    req_ctx = get_context_task_id(request)
    # 仅当任务已绑定**其它**上下文时隐藏；context_id 为空表示旧版/未绑定任务，应对当前请求返回真实状态，
    # 否则带 X-FV-Context-Id 的前端会一直拿到 pending，轮询永不结束。
    if row is not None and req_ctx is not None:
        if row.context_id is not None and row.context_id != req_ctx:
            return TaskStatusResponse(taskId=task_id, status="pending")
    if row is not None:
        row = _reconcile_awaiting_video_if_episode_has_file(row)
        api = row.to_api_response()
        return TaskStatusResponse(
            taskId=api["taskId"],
            status=api["status"],
            progress=api.get("progress"),
            result=api.get("result"),
            error=api.get("error"),
        )

    # 兼容：历史上可能直接轮询 Vidu 返回的裸 task id（未写入本地 tasks 表）
    client = _get_vidu_client()
    if client:
        try:
            resp = client.query_tasks([task_id])
            tasks = resp.get("tasks", [])
            if tasks:
                vt = tasks[0]
                state = vt.get("state", "pending")
                mapping = {"created": "pending", "queueing": "pending", "processing": "processing"}
                status = mapping.get(state, "success" if state == "success" else "failed")
                if state == "failed":
                    status = "failed"
                return TaskStatusResponse(
                    taskId=task_id,
                    status=status,
                    result={"creations": vt.get("creations"), "state": state},
                )
        except Exception:
            pass
    return TaskStatusResponse(taskId=task_id, status="pending")


@router.get("/tasks/batch", response_model=list[TaskStatusResponse])
def get_tasks_batch(
    request: Request,
    ids: str = Query(default="", description="逗号分隔的 taskId"),
):
    """批量查询任务状态；无本地记录且为 Vidu 裸 id 时分批 query_tasks。"""
    task_ids = [x.strip() for x in ids.split(",") if x.strip()]
    if not task_ids:
        return []

    store = get_task_store()
    by_id: dict[str, TaskStatusResponse] = {}
    need_vidu: list[str] = []
    req_ctx = get_context_task_id(request)

    for tid in task_ids:
        row = store.get_task_row(tid)
        if row is not None:
            if req_ctx is not None and row.context_id is not None and row.context_id != req_ctx:
                continue
            row = _reconcile_awaiting_video_if_episode_has_file(row)
            api = row.to_api_response()
            by_id[tid] = TaskStatusResponse(
                taskId=api["taskId"],
                status=api["status"],
                progress=api.get("progress"),
                result=api.get("result"),
                error=api.get("error"),
            )
        else:
            need_vidu.append(tid)

    # 去重，避免对同一裸 Vidu id 重复请求
    need_vidu_unique = list(dict.fromkeys(need_vidu))
    if need_vidu_unique:
        client = _get_vidu_client()
        if client:
            try:
                resp = client.query_tasks(need_vidu_unique)
                for vt in resp.get("tasks", []):
                    tid = str(vt.get("id", ""))
                    state = vt.get("state", "pending")
                    mapping = {"created": "pending", "queueing": "pending", "processing": "processing"}
                    status = mapping.get(state, "success" if state == "success" else "failed")
                    if state == "failed":
                        status = "failed"
                    by_id[tid] = TaskStatusResponse(
                        taskId=tid,
                        status=status,
                        result={"creations": vt.get("creations"), "state": state},
                    )
            except Exception:
                pass

    return [by_id.get(tid, TaskStatusResponse(taskId=tid, status="pending")) for tid in task_ids]
