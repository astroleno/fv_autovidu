# -*- coding: utf-8 -*-
"""
SQLite 连接与建表（任务状态库）

- 数据库文件位于 DATA_ROOT/tasks.db（与 episode 数据同根目录，便于备份）
- 使用 WAL（Write-Ahead Logging）降低读写锁冲突
- 每个线程独立连接：sqlite3 连接不可跨线程共享
- 启动时 init_db() 幂等建表

详见 docs/SQLite任务队列方案/最小可落地版.md
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Final

from .runtime_config import DATA_ROOT

# ---------------------------------------------------------------------------
# 路径与线程本地存储
# ---------------------------------------------------------------------------

DB_PATH: Final[Path] = DATA_ROOT / "tasks.db"

_thread_local = threading.local()

# 与「最小可落地版」文档一致的 DDL；首版单表、无归档表
_SCHEMA_SQL: Final[str] = """
CREATE TABLE IF NOT EXISTS tasks (
    id               TEXT PRIMARY KEY,
    kind             TEXT NOT NULL,
    status           TEXT NOT NULL,

    episode_id       TEXT,
    shot_id          TEXT,
    candidate_id     TEXT,

    external_task_id TEXT,

    payload          TEXT NOT NULL DEFAULT '{}',
    result           TEXT NOT NULL DEFAULT '{}',
    error            TEXT,

    progress         INTEGER,

    created_at       REAL NOT NULL,
    updated_at       REAL NOT NULL,
    started_at       REAL,
    completed_at     REAL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_kind_status ON tasks(kind, status);
CREATE INDEX IF NOT EXISTS idx_tasks_episode ON tasks(episode_id);
CREATE INDEX IF NOT EXISTS idx_tasks_external ON tasks(external_task_id);
"""


def get_connection() -> sqlite3.Connection:
    """
    获取当前线程的 SQLite 连接（懒初始化）。

    Returns:
        已配置 WAL、busy_timeout、Row 工厂的连接。
    """
    conn = getattr(_thread_local, "conn", None)
    if conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.row_factory = sqlite3.Row
        _thread_local.conn = conn
    return conn


def init_db() -> None:
    """
    建表与索引（幂等）。服务启动时调用一次。

    若历史版本表缺少 progress 列，则 ALTER TABLE 补齐（向前兼容）。
    """
    conn = get_connection()
    conn.executescript(_SCHEMA_SQL)
    conn.commit()
    _ensure_progress_column(conn)
    _ensure_context_id_column(conn)


def _ensure_progress_column(conn: sqlite3.Connection) -> None:
    """旧库可能没有 progress 列，运行期补列。"""
    cur = conn.execute("PRAGMA table_info(tasks)")
    cols = {row[1] for row in cur.fetchall()}
    if "progress" not in cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN progress INTEGER")
        conn.commit()


def _ensure_context_id_column(conn: sqlite3.Connection) -> None:
    """
    多 Feeling Profile：任务归属 context_id（与 X-FV-Context-Id 一致），旧行默认为 NULL。
    """
    cur = conn.execute("PRAGMA table_info(tasks)")
    cols = {row[1] for row in cur.fetchall()}
    if "context_id" not in cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN context_id TEXT")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_context ON tasks(context_id)"
        )
        conn.commit()
