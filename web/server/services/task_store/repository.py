# -*- coding: utf-8 -*-
"""
任务表纯 SQL 访问层（repository）

不包含业务规则，仅 CRUD 与启动恢复 SQL。
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

import sqlite3

from .models import TaskRow
from .runtime_config import DATA_ROOT


def _commit(conn: sqlite3.Connection) -> None:
    conn.commit()


def get_task_by_id(conn: sqlite3.Connection, task_id: str) -> Optional[TaskRow]:
    """按主键查询单条任务。"""
    row = conn.execute(
        "SELECT * FROM tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    if row is None:
        return None
    return TaskRow.from_sqlite_row(row)


def get_tasks_by_ids(conn: sqlite3.Connection, task_ids: list[str]) -> list[TaskRow]:
    """批量查询；保持与输入 id 列表顺序一致（便于前端对齐）。"""
    if not task_ids:
        return []
    placeholders = ",".join("?" * len(task_ids))
    cur = conn.execute(
        f"SELECT * FROM tasks WHERE id IN ({placeholders})",
        tuple(task_ids),
    )
    by_id = {str(r["id"]): TaskRow.from_sqlite_row(r) for r in cur.fetchall()}
    return [by_id[tid] for tid in task_ids if tid in by_id]


def get_tasks_by_status(
    conn: sqlite3.Connection,
    status: str,
    kind: Optional[str] = None,
) -> list[TaskRow]:
    """按状态（及可选 kind）查询任务列表。"""
    if kind is None:
        cur = conn.execute(
            "SELECT * FROM tasks WHERE status = ? ORDER BY updated_at ASC",
            (status,),
        )
    else:
        cur = conn.execute(
            "SELECT * FROM tasks WHERE status = ? AND kind = ? ORDER BY updated_at ASC",
            (status, kind),
        )
    return [TaskRow.from_sqlite_row(r) for r in cur.fetchall()]


def get_latest_task_for_target(
    conn: sqlite3.Connection,
    *,
    episode_id: str,
    shot_id: str,
    kind: str,
    context_id: str | None = None,
) -> Optional[TaskRow]:
    """按业务关联返回最近一条任务。"""
    sql = [
        "SELECT * FROM tasks",
        "WHERE episode_id = ? AND shot_id = ? AND kind = ?",
    ]
    params: list[object] = [episode_id, shot_id, kind]
    if context_id is not None:
        sql.append("AND (context_id IS NULL OR context_id = ?)")
        params.append(context_id)
    sql.append("ORDER BY updated_at DESC, created_at DESC LIMIT 1")
    row = conn.execute(" ".join(sql), tuple(params)).fetchone()
    if row is None:
        return None
    return TaskRow.from_sqlite_row(row)


def insert_task(conn: sqlite3.Connection, task: TaskRow) -> None:
    """插入新任务（若 id 已存在则抛异常由上层处理）。"""
    now = time.time()
    if task.created_at <= 0:
        task.created_at = now
    if task.updated_at <= 0:
        task.updated_at = now
    conn.execute(
        """
        INSERT INTO tasks (
            id, kind, status, episode_id, shot_id, candidate_id,
            external_task_id, payload, result, error, progress,
            created_at, updated_at, started_at, completed_at, context_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task.id,
            task.kind,
            task.status,
            task.episode_id,
            task.shot_id,
            task.candidate_id,
            task.external_task_id,
            json.dumps(task.payload, ensure_ascii=False),
            json.dumps(task.result, ensure_ascii=False),
            task.error,
            task.progress,
            task.created_at,
            task.updated_at,
            task.started_at,
            task.completed_at,
            task.context_id,
        ),
    )
    _commit(conn)


def update_task(conn: sqlite3.Connection, task: TaskRow) -> None:
    """按 id 全量更新（假定行已存在）。"""
    task.updated_at = time.time()
    conn.execute(
        """
        UPDATE tasks SET
            kind = ?, status = ?, episode_id = ?, shot_id = ?, candidate_id = ?,
            external_task_id = ?, payload = ?, result = ?, error = ?, progress = ?,
            updated_at = ?, started_at = ?, completed_at = ?, context_id = ?
        WHERE id = ?
        """,
        (
            task.kind,
            task.status,
            task.episode_id,
            task.shot_id,
            task.candidate_id,
            task.external_task_id,
            json.dumps(task.payload, ensure_ascii=False),
            json.dumps(task.result, ensure_ascii=False),
            task.error,
            task.progress,
            task.updated_at,
            task.started_at,
            task.completed_at,
            task.context_id,
            task.id,
        ),
    )
    _commit(conn)


def upsert_task(conn: sqlite3.Connection, task: TaskRow) -> None:
    """
    插入或更新任务（替代原 set_local_task 的整表覆盖语义）。

    若已存在同 id，保留原 created_at；否则使用 task.created_at。
    """
    now = time.time()
    existing = get_task_by_id(conn, task.id)
    if existing is not None:
        task.created_at = existing.created_at
    else:
        if task.created_at <= 0:
            task.created_at = now
    task.updated_at = now
    conn.execute(
        """
        INSERT INTO tasks (
            id, kind, status, episode_id, shot_id, candidate_id,
            external_task_id, payload, result, error, progress,
            created_at, updated_at, started_at, completed_at, context_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            status = excluded.status,
            episode_id = excluded.episode_id,
            shot_id = excluded.shot_id,
            candidate_id = excluded.candidate_id,
            external_task_id = excluded.external_task_id,
            payload = excluded.payload,
            result = excluded.result,
            error = excluded.error,
            progress = excluded.progress,
            updated_at = excluded.updated_at,
            started_at = excluded.started_at,
            completed_at = excluded.completed_at,
            context_id = COALESCE(excluded.context_id, tasks.context_id)
        """,
        (
            task.id,
            task.kind,
            task.status,
            task.episode_id,
            task.shot_id,
            task.candidate_id,
            task.external_task_id,
            json.dumps(task.payload, ensure_ascii=False),
            json.dumps(task.result, ensure_ascii=False),
            task.error,
            task.progress,
            task.created_at,
            task.updated_at,
            task.started_at,
            task.completed_at,
            task.context_id,
        ),
    )
    _commit(conn)


def mark_processing_interrupted_on_startup(
    conn: sqlite3.Connection,
    error_message: str = "服务重启中断，请手动重试",
) -> int:
    """
    启动时将仍为 processing 的任务标为失败（弱恢复语义）。

    Returns:
        受影响行数。
    """
    now = time.time()
    cur = conn.execute(
        """
        UPDATE tasks
        SET status = 'failed',
            error = ?,
            completed_at = ?,
            updated_at = ?
        WHERE status = 'processing'
        """,
        (error_message, now, now),
    )
    _commit(conn)
    return cur.rowcount


def migrate_legacy_tasks_state_json(conn: sqlite3.Connection) -> int:
    """
    从 tasks_state.json 导入历史 video 任务（一次性兼容升级）。

    仅当 JSON 中存在、且 SQLite 中尚无同 id 时插入；
    已存在 id 不覆盖，避免冲掉新数据。

    Returns:
        导入条数。
    """
    path = Path(DATA_ROOT) / "tasks_state.json"
    if not path.is_file():
        return 0
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0
    tasks = raw.get("tasks")
    if not isinstance(tasks, dict):
        return 0
    count = 0
    now = time.time()
    for tid, row in tasks.items():
        if not str(tid).startswith("video-"):
            continue
        if not isinstance(row, dict):
            continue
        if get_task_by_id(conn, str(tid)) is not None:
            continue
        status = str(row.get("status") or "pending")
        kind = str(row.get("kind") or "video")
        res = row.get("result")
        if not isinstance(res, dict):
            res = {}
        vid = res.get("vidu_task_id")
        ext = str(vid) if vid else None
        # 若缺 vidu 元数据，落库为 failed（与旧 restore 一致）
        if not ext or not str(row.get("episode_id") or "").strip():
            task = TaskRow(
                id=str(tid),
                kind=kind,
                status="failed",
                episode_id=row.get("episode_id"),
                shot_id=row.get("shot_id"),
                candidate_id=row.get("candidate_id"),
                external_task_id=ext,
                payload={},
                result=res,
                error=row.get("error")
                or "服务重启后无法恢复：缺少 Vidu 任务元数据（历史 tasks_state.json）",
                created_at=now,
                updated_at=now,
                completed_at=now,
            )
        else:
            # 有外部任务：与旧逻辑一致，进入 awaiting_external 以便 finalizer 收敛
            if status in ("success", "failed"):
                st = status
                comp = now
            elif status == "processing" or status == "pending":
                st = "awaiting_external"
                comp = None
            else:
                st = "awaiting_external"
                comp = None
            task = TaskRow(
                id=str(tid),
                kind=kind,
                status=st,
                episode_id=row.get("episode_id"),
                shot_id=row.get("shot_id"),
                candidate_id=row.get("candidate_id"),
                external_task_id=ext,
                payload={},
                result=res,
                error=row.get("error"),
                created_at=now,
                updated_at=now,
                completed_at=comp,
            )
        try:
            insert_task(conn, task)
            count += 1
        except sqlite3.IntegrityError:
            try:
                conn.rollback()
            except Exception:
                pass
    return count
