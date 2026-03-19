# -*- coding: utf-8 -*-
"""
任务状态路由：GET /tasks/:taskId, GET /tasks/batch
代理 Vidu 任务查询，同时支持本地任务追踪。
"""

import os
import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from fastapi import APIRouter, Query

from models.schemas import TaskStatusResponse

router = APIRouter()

# 本地任务状态缓存（内存，重启丢失；可后续改为持久化）
_local_tasks: dict[str, dict] = {}


def _get_vidu_client():
    """获取 ViduClient 实例。"""
    try:
        from src.vidu.client import ViduClient
    except ImportError:
        return None
    key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not key:
        return None
    return ViduClient(api_key=key)


@router.get("/tasks/{task_id}", response_model=TaskStatusResponse)
def get_task_status(task_id: str):
    """查询单个任务状态。"""
    # 1. 先查本地
    if task_id in _local_tasks:
        t = _local_tasks[task_id]
        return TaskStatusResponse(
            taskId=task_id,
            status=t.get("status", "pending"),
            progress=t.get("progress"),
            result=t.get("result"),
            error=t.get("error"),
        )
    # 2. 查 Vidu
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
def get_tasks_batch(ids: str = Query(default="", description="逗号分隔的 taskId")):
    """批量查询任务状态。ids 逗号分隔。"""
    task_ids = [x.strip() for x in ids.split(",") if x.strip()]
    if not task_ids:
        return []
    result = []
    # 分批查 Vidu（Vidu 支持一次查多个）
    vidu_ids = [tid for tid in task_ids if tid not in _local_tasks]
    if vidu_ids:
        client = _get_vidu_client()
        if client:
            try:
                resp = client.query_tasks(vidu_ids)
                for vt in resp.get("tasks", []):
                    tid = vt.get("id", "")
                    state = vt.get("state", "pending")
                    mapping = {"created": "pending", "queueing": "pending", "processing": "processing"}
                    status = mapping.get(state, "success" if state == "success" else "failed")
                    result.append(TaskStatusResponse(
                        taskId=tid,
                        status=status,
                        result={"creations": vt.get("creations"), "state": state},
                    ))
            except Exception:
                pass
    for tid in task_ids:
        if any(r.taskId == tid for r in result):
            continue
        if tid in _local_tasks:
            t = _local_tasks[tid]
            result.append(TaskStatusResponse(
                taskId=tid,
                status=t.get("status", "pending"),
                progress=t.get("progress"),
                result=t.get("result"),
                error=t.get("error"),
            ))
        else:
            result.append(TaskStatusResponse(taskId=tid, status="pending"))
    return result


def set_local_task(task_id: str, status: str, **kwargs):
    """供 generate 等路由更新本地任务状态。"""
    _local_tasks[task_id] = {"status": status, **kwargs}
