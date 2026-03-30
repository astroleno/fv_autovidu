# -*- coding: utf-8 -*-
"""
generate 路由入口回归测试。

覆盖：
- /generate/endframe 提交时不应因日志解包异常而 500；
- /generate/regen-frame 应立即返回 taskId，并注册后台任务。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import BackgroundTasks

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from models.schemas import GenerateEndframeRequest, RegenFrameRequest, Shot  # noqa: E402
from routes import generate as generate_route  # noqa: E402


def _request_without_context():
    return SimpleNamespace(state=SimpleNamespace(feeling_context=None))


def _minimal_shot(**kwargs) -> Shot:
    base = dict(
        shotId="shot-1",
        shotNumber=1,
        imagePrompt="img prompt",
        videoPrompt="video prompt",
        firstFrame="frames/S001.png",
        assets=[],
    )
    base.update(kwargs)
    return Shot(**base)


class TestGenerateRouteEntrypoints(unittest.TestCase):
    def test_generate_endframe_returns_tasks_and_adds_one_background_job(self) -> None:
        req = GenerateEndframeRequest(episodeId="ep-1", shotIds=["shot-1", "shot-2"])
        background_tasks = BackgroundTasks()
        store = MagicMock()

        with (
            patch.object(generate_route, "get_task_store", return_value=store),
            patch.object(generate_route.data_service, "update_shot_status") as mock_update_status,
        ):
            res = generate_route.generate_endframe(
                req,
                background_tasks,
                _request_without_context(),
            )

        self.assertEqual(len(res.tasks), 2)
        self.assertTrue(all(t.taskId.startswith("endframe-") for t in res.tasks))
        self.assertEqual([t.shotId for t in res.tasks], ["shot-1", "shot-2"])
        self.assertEqual(len(background_tasks.tasks), 1)
        self.assertEqual(mock_update_status.call_count, 2)

    def test_regen_frame_returns_task_and_adds_background_job(self) -> None:
        req = RegenFrameRequest(
            episodeId="ep-1",
            shotId="shot-1",
            imagePrompt="new prompt",
            assetIds=[],
        )
        background_tasks = BackgroundTasks()
        store = MagicMock()
        shot = _minimal_shot()

        with (
            patch.object(generate_route, "get_task_store", return_value=store),
            patch.object(generate_route.data_service, "get_shot", return_value=shot),
        ):
            res = generate_route.regen_frame(
                req,
                background_tasks,
                _request_without_context(),
            )

        self.assertTrue(res.taskId.startswith("regen-"))
        self.assertEqual(res.shotId, "shot-1")
        self.assertEqual(res.newFramePath, "frames/S001.png")
        self.assertEqual(len(background_tasks.tasks), 1)


if __name__ == "__main__":
    unittest.main()
