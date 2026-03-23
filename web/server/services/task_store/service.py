# -*- coding: utf-8 -*-
"""
任务状态业务服务（TaskStoreService）

对外提供与原 `set_local_task` 等价的持久化语义，并封装查询、启动恢复入口。
路由层与后台线程应通过本类访问 SQLite，避免直接依赖 repository。
"""

from __future__ import annotations

import time
from typing import Any, Optional

from . import repository
from .db import get_connection, init_db
from .models import TaskRow


def infer_kind_from_task_id(task_id: str) -> str:
    """
    根据 taskId 前缀推断 kind（与历史命名约定一致）。

    无法识别时返回 unknown，调用方应尽快补全 kind。
    """
    tid = str(task_id)
    if tid.startswith("video-"):
        return "video"
    if tid.startswith("endframe-"):
        return "endframe"
    if tid.startswith("regen-"):
        return "regen"
    if tid.startswith("dub-"):
        return "dub"
    return "unknown"


class TaskStoreService:
    """
    任务状态库门面：创建/更新/查询。

    线程安全：内部使用线程级 SQLite 连接（见 db.get_connection）。
    """

    @staticmethod
    def init_database() -> None:
        """建表；应在应用启动最早调用。"""
        init_db()

    @staticmethod
    def migrate_legacy_json() -> int:
        """从 tasks_state.json 导入历史记录（可选，幂等）。"""
        conn = get_connection()
        return repository.migrate_legacy_tasks_state_json(conn)

    @staticmethod
    def mark_interrupted_processing() -> int:
        """启动时将 processing 标为失败。"""
        conn = get_connection()
        return repository.mark_processing_interrupted_on_startup(conn)

    def set_task(self, task_id: str, status: str, **kwargs: Any) -> None:
        """
        替代原 `set_local_task`：按 id 写入或合并整行状态。

        支持的 kwargs：kind, episode_id, shot_id, candidate_id, external_task_id,
        result (dict), error, progress, payload (dict), started_at, completed_at。

        未传入的字段尽量保留数据库中已有值（与原内存 dict 覆盖语义略有不同：
        显式传 None 仍会写入 None）。
        """
        conn = get_connection()
        existing = repository.get_task_by_id(conn, task_id)
        now = time.time()

        kind = kwargs.get("kind")
        if kind is None:
            kind = existing.kind if existing else infer_kind_from_task_id(task_id)

        def _pick(key: str, default: Any = None) -> Any:
            if key in kwargs:
                return kwargs[key]
            if existing is not None:
                return getattr(existing, key)
            return default

        res = _pick("result", {})
        if res is None:
            res = {}
        if not isinstance(res, dict):
            res = {}

        pay = _pick("payload", {})
        if pay is None:
            pay = {}
        if not isinstance(pay, dict):
            pay = {}

        ext = _pick("external_task_id", None)
        if ext is None and isinstance(res.get("vidu_task_id"), str):
            ext = res.get("vidu_task_id")

        row = TaskRow(
            id=str(task_id),
            kind=str(kind),
            status=status,
            episode_id=_pick("episode_id", None),
            shot_id=_pick("shot_id", None),
            candidate_id=_pick("candidate_id", None),
            external_task_id=ext if isinstance(ext, str) else None,
            payload=pay,
            result=res,
            error=_pick("error", None),
            progress=_pick("progress", None),
            created_at=existing.created_at if existing else now,
            updated_at=now,
            started_at=_pick("started_at", existing.started_at if existing else None),
            completed_at=_pick("completed_at", existing.completed_at if existing else None),
        )
        if "started_at" in kwargs and kwargs["started_at"] is not None:
            row.started_at = float(kwargs["started_at"])
        if status == "processing" and row.started_at is None:
            row.started_at = now
        # 外部等待态不应保留完成时间
        if status == "awaiting_external":
            row.completed_at = None
        # 终态统一写入完成时间，便于统计与排查
        if status in ("success", "failed"):
            row.completed_at = now
        repository.upsert_task(conn, row)

    def get_task_row(self, task_id: str) -> Optional[TaskRow]:
        """返回 TaskRow；无记录时 None。"""
        conn = get_connection()
        return repository.get_task_by_id(conn, task_id)

    def get_task(self, task_id: str) -> Optional[dict[str, Any]]:
        """返回 to_api_response 字典。"""
        row = self.get_task_row(task_id)
        if row is None:
            return None
        return row.to_api_response()

    def get_tasks_batch_rows(self, task_ids: list[str]) -> list[TaskRow]:
        conn = get_connection()
        return repository.get_tasks_by_ids(conn, task_ids)

    def create_pending_task(
        self,
        task_id: str,
        kind: str,
        *,
        episode_id: Optional[str] = None,
        shot_id: Optional[str] = None,
        candidate_id: Optional[str] = None,
        payload: Optional[dict[str, Any]] = None,
    ) -> None:
        """显式创建 pending 任务（可选，用于需要完整 payload 快照的场景）。"""
        conn = get_connection()
        now = time.time()
        row = TaskRow(
            id=str(task_id),
            kind=kind,
            status="pending",
            episode_id=episode_id,
            shot_id=shot_id,
            candidate_id=candidate_id,
            payload=payload or {},
            result={},
            created_at=now,
            updated_at=now,
        )
        repository.upsert_task(conn, row)

    def set_awaiting_external(
        self,
        task_id: str,
        *,
        external_task_id: str,
        result: dict[str, Any],
        episode_id: str,
        shot_id: str,
        candidate_id: str,
        kind: str = "video",
    ) -> None:
        """video 已提交 Vidu，进入外部等待态。"""
        self.set_task(
            task_id,
            "awaiting_external",
            kind=kind,
            episode_id=episode_id,
            shot_id=shot_id,
            candidate_id=candidate_id,
            external_task_id=external_task_id,
            result=result,
        )


# 进程内单例，便于路由与后台线程共享门面（无连接状态）
_default_store: Optional[TaskStoreService] = None


def get_task_store() -> TaskStoreService:
    """返回全局 TaskStoreService 单例。"""
    global _default_store
    if _default_store is None:
        _default_store = TaskStoreService()
    return _default_store
