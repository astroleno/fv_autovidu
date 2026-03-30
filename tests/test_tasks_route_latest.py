# -*- coding: utf-8 -*-
"""
tasks 最新任务查询回归测试。

覆盖：
- 可按 episode_id + shot_id + kind 返回最近一条任务；
- 带 context 时仅暴露当前上下文或旧版 context_id 为空的任务。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from services.task_store import repository  # noqa: E402
from services.task_store.db import get_connection, init_db  # noqa: E402
from services.task_store.models import TaskRow  # noqa: E402
from routes import tasks as tasks_route  # noqa: E402


def _request_with_context(context_id: str | None):
    ctx = None if context_id is None else SimpleNamespace(context_id=context_id)
    return SimpleNamespace(state=SimpleNamespace(feeling_context=ctx))


class TestTasksRouteLatest(unittest.TestCase):
    def setUp(self) -> None:
        init_db()
        conn = get_connection()
        conn.execute("DELETE FROM tasks")
        conn.commit()

    def test_returns_latest_matching_regen_task(self) -> None:
        conn = get_connection()
        repository.insert_task(
            conn,
            TaskRow(
                id="regen-old",
                kind="regen",
                status="failed",
                episode_id="ep-1",
                shot_id="shot-1",
                context_id="ctx-a",
                updated_at=10,
            ),
        )
        repository.insert_task(
            conn,
            TaskRow(
                id="regen-new",
                kind="regen",
                status="success",
                episode_id="ep-1",
                shot_id="shot-1",
                context_id="ctx-a",
                updated_at=20,
                completed_at=20,
            ),
        )

        res = tasks_route.get_latest_task_for_target(
            request=_request_with_context("ctx-a"),
            episode_id="ep-1",
            shot_id="shot-1",
            kind="regen",
        )

        self.assertIsNotNone(res)
        assert res is not None
        self.assertEqual(res.taskId, "regen-new")
        self.assertEqual(res.status, "success")

    def test_hides_other_context_and_falls_back_to_null_context(self) -> None:
        conn = get_connection()
        repository.insert_task(
            conn,
            TaskRow(
                id="regen-other-ctx",
                kind="regen",
                status="processing",
                episode_id="ep-1",
                shot_id="shot-1",
                context_id="ctx-b",
                updated_at=30,
            ),
        )
        repository.insert_task(
            conn,
            TaskRow(
                id="regen-legacy",
                kind="regen",
                status="failed",
                episode_id="ep-1",
                shot_id="shot-1",
                context_id=None,
                error="legacy failure",
                updated_at=20,
            ),
        )

        res = tasks_route.get_latest_task_for_target(
            request=_request_with_context("ctx-a"),
            episode_id="ep-1",
            shot_id="shot-1",
            kind="regen",
        )

        self.assertIsNotNone(res)
        assert res is not None
        self.assertEqual(res.taskId, "regen-legacy")
        self.assertEqual(res.status, "failed")
        self.assertEqual(res.error, "legacy failure")


if __name__ == "__main__":
    unittest.main()
