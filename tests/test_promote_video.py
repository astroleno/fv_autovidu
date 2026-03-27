# -*- coding: utf-8 -*-
"""
``POST /generate/video/promote``（``promote_video``）校验与入队单测。

覆盖设计 §2：``first_frame`` 可不依赖尾帧；``first_last_frame`` 须尾帧文件；
``reference`` 等 mode 返回 400。不调用真实 Vidu：仅断言校验结果与 ``VideoJobSpec`` 中的 mode。
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from models.schemas import PromoteVideoRequest, Shot, VideoCandidate  # noqa: E402
from routes import generate as generate_route  # noqa: E402


def _preview_candidate(
    *,
    mode: str = "first_frame",
    candidate_id: str = "c-prev-1",
    seed: int = 42,
    **kwargs: object,
) -> VideoCandidate:
    """构造可精出的预览成功候选（taskStatus / isPreview / seed 满足路由前置条件）。"""
    base: dict = {
        "id": candidate_id,
        "videoPath": "videos/preview.mp4",
        "thumbnailPath": "",
        "seed": seed,
        "model": "viduq2-pro-fast",
        "mode": mode,
        "taskStatus": "success",
        "isPreview": True,
    }
    base.update(kwargs)
    return VideoCandidate(**base)


def _shot_with_candidates(
    *candidates: VideoCandidate,
    shot_id: str = "s1",
    first_frame: str = "frames/S001.png",
    end_frame: str | None = None,
) -> Shot:
    """最小 Shot：仅含精出校验所需字段。"""
    return Shot(
        shotId=shot_id,
        shotNumber=1,
        imagePrompt="img",
        videoPrompt="vid",
        firstFrame=first_frame,
        endFrame=end_frame,
        videoCandidates=list(candidates),
    )


class TestPromoteVideo(unittest.TestCase):
    """promote_video：mode 分流与 VideoJobSpec.mode。"""

    def setUp(self) -> None:
        # 临时剧集目录：写入首帧（及首尾帧用例中的尾帧）
        self._root = Path(tempfile.mkdtemp())
        self.episode_id = "ep-promote-test"
        self.ep_dir = self._root / self.episode_id
        self.ep_dir.mkdir(parents=True)
        self._first = self.ep_dir / "frames" / "S001.png"
        self._first.parent.mkdir(parents=True)
        self._first.write_bytes(b"\x89PNG\r\n\x1a\n")

    def tearDown(self) -> None:
        shutil.rmtree(self._root, ignore_errors=True)

    def _http_request(self) -> MagicMock:
        """无 Feeling 上下文：命名空间根为 None，与旧数据根行为一致。"""
        req = MagicMock()
        req.state = SimpleNamespace(feeling_context=None)
        return req

    def test_first_frame_without_end_frame_passes_and_queues_first_frame_mode(self) -> None:
        """
        first_frame 预览候选：无 endFrame、无尾帧文件时仍通过校验；
        入队任务的 mode 为 first_frame（VideoJobSpec 索引 3）。
        """
        cand = _preview_candidate(mode="first_frame")
        shot = _shot_with_candidates(cand, end_frame=None)
        body = PromoteVideoRequest(
            episodeId=self.episode_id,
            items=[{"shotId": shot.shotId, "candidateId": cand.id}],
        )
        bg = MagicMock()
        store = MagicMock()

        with (
            patch.object(generate_route, "get_namespace_data_root_optional", return_value=None),
            patch.object(generate_route, "get_context_task_id", return_value=None),
            patch.object(generate_route, "get_task_store", return_value=store),
            patch.object(
                generate_route.data_service,
                "get_episode_dir",
                return_value=self.ep_dir,
            ),
            patch.object(
                generate_route.data_service,
                "get_shot",
                return_value=shot,
            ),
            patch.object(generate_route.data_service, "update_shot_status"),
        ):
            out = generate_route.promote_video(body, bg, self._http_request())

        self.assertEqual(len(out.tasks), 1)
        bg.add_task.assert_called_once()
        fn, jobs = bg.add_task.call_args[0][0], bg.add_task.call_args[0][1]
        self.assertIs(fn, generate_route._run_video_batch_parallel)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0][3], "first_frame")

    def test_first_last_frame_missing_end_file_returns_400(self) -> None:
        """first_last_frame：尾帧路径已设但文件不存在 → 400。"""
        cand = _preview_candidate(mode="first_last_frame")
        shot = _shot_with_candidates(cand, end_frame="frames/NONE.png")
        body = PromoteVideoRequest(
            episodeId=self.episode_id,
            items=[{"shotId": shot.shotId, "candidateId": cand.id}],
        )
        bg = MagicMock()
        store = MagicMock()

        with (
            patch.object(generate_route, "get_namespace_data_root_optional", return_value=None),
            patch.object(generate_route, "get_context_task_id", return_value=None),
            patch.object(generate_route, "get_task_store", return_value=store),
            patch.object(
                generate_route.data_service,
                "get_episode_dir",
                return_value=self.ep_dir,
            ),
            patch.object(
                generate_route.data_service,
                "get_shot",
                return_value=shot,
            ),
        ):
            with self.assertRaises(HTTPException) as ctx:
                generate_route.promote_video(body, bg, self._http_request())

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("尾帧文件不存在", str(ctx.exception.detail))
        bg.add_task.assert_not_called()

    def test_reference_mode_returns_400(self) -> None:
        """reference 等不支持的 mode：400，且说明仅支持 first_frame / first_last_frame。"""
        cand = _preview_candidate(mode="reference")
        shot = _shot_with_candidates(cand)
        body = PromoteVideoRequest(
            episodeId=self.episode_id,
            items=[{"shotId": shot.shotId, "candidateId": cand.id}],
        )
        bg = MagicMock()
        store = MagicMock()

        with (
            patch.object(generate_route, "get_namespace_data_root_optional", return_value=None),
            patch.object(generate_route, "get_context_task_id", return_value=None),
            patch.object(generate_route, "get_task_store", return_value=store),
            patch.object(
                generate_route.data_service,
                "get_episode_dir",
                return_value=self.ep_dir,
            ),
            patch.object(
                generate_route.data_service,
                "get_shot",
                return_value=shot,
            ),
        ):
            with self.assertRaises(HTTPException) as ctx:
                generate_route.promote_video(body, bg, self._http_request())

        self.assertEqual(ctx.exception.status_code, 400)
        detail = str(ctx.exception.detail)
        self.assertIn("first_frame", detail)
        self.assertIn("first_last_frame", detail)
        self.assertIn("reference", detail)
        bg.add_task.assert_not_called()

    def test_first_last_frame_with_end_file_queues_first_last_frame_mode(self) -> None:
        """首尾帧文件齐全时入队 mode 为 first_last_frame（回归现网路径）。"""
        end_path = self.ep_dir / "frames" / "E001.png"
        end_path.write_bytes(b"\x89PNG\r\n\x1a\n")
        cand = _preview_candidate(mode="first_last_frame")
        shot = _shot_with_candidates(cand, end_frame="frames/E001.png")
        body = PromoteVideoRequest(
            episodeId=self.episode_id,
            items=[{"shotId": shot.shotId, "candidateId": cand.id}],
        )
        bg = MagicMock()
        store = MagicMock()

        with (
            patch.object(generate_route, "get_namespace_data_root_optional", return_value=None),
            patch.object(generate_route, "get_context_task_id", return_value=None),
            patch.object(generate_route, "get_task_store", return_value=store),
            patch.object(
                generate_route.data_service,
                "get_episode_dir",
                return_value=self.ep_dir,
            ),
            patch.object(
                generate_route.data_service,
                "get_shot",
                return_value=shot,
            ),
            patch.object(generate_route.data_service, "update_shot_status"),
        ):
            generate_route.promote_video(body, bg, self._http_request())

        bg.add_task.assert_called_once()
        jobs = bg.add_task.call_args[0][1]
        self.assertEqual(jobs[0][3], "first_last_frame")


if __name__ == "__main__":
    unittest.main()
