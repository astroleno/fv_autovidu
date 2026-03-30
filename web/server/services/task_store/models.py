# -*- coding: utf-8 -*-
"""
任务行模型（TaskRow）

与 tasks 表一一对应；payload/result 在内存中为 dict，落库为 JSON 字符串。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class TaskRow:
    """
    单条任务记录，对应 SQLite tasks 表。

    Attributes:
        id: 任务 ID，如 video-xxx、endframe-xxx。
        kind: 任务类型 video | endframe | dub | regen。
        status: pending | processing | awaiting_external | success | failed。
        episode_id / shot_id / candidate_id: 业务关联（可选）。
        external_task_id: 外部侧任务 ID（如 Vidu 返回的 task id）。
        payload: 创建时入参快照（JSON）。
        result: 结果/中间态（JSON），如 vidu_task_id、videoPath。
        error: 失败原因。
        progress: 可选进度 0-100，供前端展示。
        context_id: Feeling 多上下文时的 profile id；旧任务为 None。
        时间戳均为 Unix 秒（float）。
    """

    id: str
    kind: str
    status: str = "pending"
    episode_id: Optional[str] = None
    shot_id: Optional[str] = None
    candidate_id: Optional[str] = None
    external_task_id: Optional[str] = None
    payload: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    progress: Optional[int] = None
    context_id: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None

    def to_api_status(self) -> str:
        """
        映射为前端 TaskStatus（pending|processing|success|failed）。

        awaiting_external 视为 processing，与前端轮询约定一致。
        """
        if self.status == "awaiting_external":
            return "processing"
        if self.status in ("pending", "processing", "success", "failed"):
            return self.status
        return "pending"

    def to_api_response(self) -> dict[str, Any]:
        """
        转为与 TaskStatusResponse 兼容的 dict（由路由层再包 Pydantic）。

        Returns:
            taskId, status, progress, result, error
        """
        return {
            "taskId": self.id,
            "status": self.to_api_status(),
            "progress": self.progress,
            "result": self.result if self.result else None,
            "error": self.error,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "completedAt": self.completed_at,
        }

    @classmethod
    def from_sqlite_row(cls, row: Any) -> TaskRow:
        """从 sqlite3.Row 还原 TaskRow。"""
        payload_raw = row["payload"] or "{}"
        result_raw = row["result"] or "{}"
        try:
            payload = json.loads(payload_raw) if isinstance(payload_raw, str) else {}
        except json.JSONDecodeError:
            payload = {}
        try:
            result = json.loads(result_raw) if isinstance(result_raw, str) else {}
        except json.JSONDecodeError:
            result = {}
        if not isinstance(payload, dict):
            payload = {}
        if not isinstance(result, dict):
            result = {}
        ctx_raw = row["context_id"] if "context_id" in row.keys() else None
        ctx_id = str(ctx_raw) if ctx_raw else None
        return cls(
            id=str(row["id"]),
            kind=str(row["kind"]),
            status=str(row["status"]),
            episode_id=row["episode_id"],
            shot_id=row["shot_id"],
            candidate_id=row["candidate_id"],
            external_task_id=row["external_task_id"],
            payload=payload,
            result=result,
            error=row["error"],
            progress=row["progress"],
            context_id=ctx_id,
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
            started_at=float(row["started_at"]) if row["started_at"] is not None else None,
            completed_at=float(row["completed_at"]) if row["completed_at"] is not None else None,
        )
