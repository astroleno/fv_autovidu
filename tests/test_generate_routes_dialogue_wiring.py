# -*- coding: utf-8 -*-
"""
路由层衔接单测：generate._run_video_gen / _run_tail_frame 与台词拼装契约。

目的：
- **验证闭环（实现层）**：视频分支把 Episode 级 locale 传入 ``append_dialogue_for_video_prompt``（通过 Vidu 入参间接断言）；
  尾帧分支向 Yunwu 传入 **未拼接** 的 ``shot.videoPrompt``。
- **不调用真实 Vidu/Yunwu**：外部 API 全部 mock；真实 smoke 仍建议人工或 staging 执行（见 docs/视频提示词语种台词注入/设计说明.md）。

说明：此处不测 ``prompt_compose`` 内部细节（见 ``tests/test_prompt_compose.py``），只测路由 wiring。
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from models.schemas import Episode, Shot  # noqa: E402
from routes import generate as generate_route  # noqa: E402


def _minimal_episode(**kwargs) -> Episode:
    """构造最小 Episode（仅测 locale 字段）。"""
    base = dict(
        projectId="proj",
        episodeId="ep1",
        episodeTitle="t",
        episodeNumber=1,
        pulledAt="2026-01-01T00:00:00Z",
        scenes=[],
        dubTargetLocale="ja-JP",
        sourceLocale="zh-CN",
    )
    base.update(kwargs)
    return Episode(**base)


def _minimal_shot(**kwargs) -> Shot:
    """构造最小 Shot。"""
    base = dict(
        shotId="s1",
        shotNumber=1,
        imagePrompt="img prompt",
        videoPrompt="BASE_VIDEO_PROMPT",
        firstFrame="frames/S001.png",
        assets=[],
        dialogueTranslation="訳文の一行",
        dialogue="原文一行",
    )
    base.update(kwargs)
    return Shot(**base)


class TestGenerateRoutesDialogueWiring(unittest.TestCase):
    """generate 路由内「台词 + locale」与尾帧「原样 videoPrompt」的衔接。"""

    def test_run_video_gen_passes_locale_to_vidu_prompt(self) -> None:
        """
        _run_video_gen（first_frame）应提交带 ``(ja-JP)`` 的译文对白块（Episode.dubTargetLocale）。
        """
        root = Path(tempfile.mkdtemp())
        try:
            ep_dir = root / "ep1"
            frame = ep_dir / "frames" / "S001.png"
            frame.parent.mkdir(parents=True)
            frame.write_bytes(b"\x89PNG\r\n\x1a\n")

            ep = _minimal_episode()
            shot = _minimal_shot()

            store = MagicMock()
            store.get_task_row.return_value = None

            with (
                patch.object(generate_route, "get_task_store", return_value=store),
                patch.object(
                    generate_route.data_service,
                    "get_episode",
                    return_value=ep,
                ),
                patch.object(
                    generate_route.data_service,
                    "get_shot",
                    return_value=shot,
                ),
                patch.object(
                    generate_route.data_service,
                    "get_episode_dir",
                    return_value=ep_dir,
                ),
                patch.object(
                    generate_route.data_service,
                    "add_video_candidate",
                ) as mock_add_cand,
                patch.object(
                    generate_route.data_service,
                    "update_shot_status",
                ),
                patch(
                    "services.vidu_service.submit_img2video",
                    return_value={"task_id": "vidu-task-1", "seed": 0},
                ) as mock_vidu,
            ):
                generate_route._run_video_gen(
                    "video-task-x",
                    "ep1",
                    "s1",
                    "first_frame",
                    None,
                    None,
                    None,
                    None,
                    0,
                    False,
                    None,
                    "",
                    namespace_root=None,
                    task_context_id=None,
                )

            mock_vidu.assert_called_once()
            args, kwargs = mock_vidu.call_args
            composed = args[1]
            self.assertIn("[Dialogue (ja-JP) for performance/lip-sync]", composed)
            self.assertIn("訳文の一行", composed)
            self.assertIn("BASE_VIDEO_PROMPT", composed)
            mock_add_cand.assert_called_once()
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_run_video_gen_skips_dialogue_when_include_flag_false(self) -> None:
        """
        includeDialogueInVideoPrompt=False 时，应直接提交 shot.videoPrompt，不追加对白块。
        """
        root = Path(tempfile.mkdtemp())
        try:
            ep_dir = root / "ep1"
            frame = ep_dir / "frames" / "S001.png"
            frame.parent.mkdir(parents=True)
            frame.write_bytes(b"\x89PNG\r\n\x1a\n")

            ep = _minimal_episode()
            shot = _minimal_shot(includeDialogueInVideoPrompt=False)

            store = MagicMock()
            store.get_task_row.return_value = None

            with (
                patch.object(generate_route, "get_task_store", return_value=store),
                patch.object(
                    generate_route.data_service,
                    "get_episode",
                    return_value=ep,
                ),
                patch.object(
                    generate_route.data_service,
                    "get_shot",
                    return_value=shot,
                ),
                patch.object(
                    generate_route.data_service,
                    "get_episode_dir",
                    return_value=ep_dir,
                ),
                patch.object(
                    generate_route.data_service,
                    "add_video_candidate",
                ),
                patch.object(
                    generate_route.data_service,
                    "update_shot_status",
                ),
                patch(
                    "services.vidu_service.submit_img2video",
                    return_value={"task_id": "vidu-task-2", "seed": 0},
                ) as mock_vidu,
            ):
                generate_route._run_video_gen(
                    "video-task-y",
                    "ep1",
                    "s1",
                    "first_frame",
                    None,
                    None,
                    None,
                    None,
                    0,
                    False,
                    None,
                    "",
                    namespace_root=None,
                    task_context_id=None,
                )

            mock_vidu.assert_called_once()
            composed = mock_vidu.call_args[0][1]
            self.assertEqual(composed, "BASE_VIDEO_PROMPT")
            self.assertNotIn("[Dialogue", composed)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_run_tail_frame_passes_raw_video_prompt_to_yunwu(self) -> None:
        """
        尾帧应把 ``shot.videoPrompt`` 原样交给 Yunwu，不经过 ``append_dialogue_for_video_prompt``。
        （若误拼接，第三参会含 ``[Dialogue`` 块。）
        """
        root = Path(tempfile.mkdtemp())
        try:
            ep_dir = root / "ep1"
            frame = ep_dir / "frames" / "S001.png"
            frame.parent.mkdir(parents=True)
            frame.write_bytes(b"\x89PNG\r\n\x1a\n")

            ep = _minimal_episode()
            shot = _minimal_shot()

            store = MagicMock()
            store.get_task_row.return_value = SimpleNamespace(status="processing")

            def _fake_lock(*_a, **_k):
                class _Ctx:
                    def __enter__(self):
                        return None

                    def __exit__(self, *exc):
                        return False

                return _Ctx()

            with (
                patch.object(generate_route, "get_task_store", return_value=store),
                patch.object(
                    generate_route.data_service,
                    "get_episode",
                    return_value=ep,
                ),
                patch.object(
                    generate_route.data_service,
                    "get_shot",
                    return_value=shot,
                ),
                patch.object(
                    generate_route.data_service,
                    "get_episode_dir",
                    return_value=ep_dir,
                ),
                patch.object(
                    generate_route.data_service,
                    "update_shot",
                ),
                patch.object(
                    generate_route.data_service,
                    "update_shot_status",
                ),
                patch(
                    "services.yunwu_service.generate_tail_frame",
                    return_value=b"\x89PNG\r\n\x1a\n\x00\x00\x00\x00IEND",
                ) as mock_yunwu,
                patch.object(generate_route, "episode_fs_lock", side_effect=_fake_lock),
            ):
                generate_route._run_tail_frame(
                    "endframe-task-x",
                    "ep1",
                    "s1",
                    namespace_root=None,
                    task_context_id=None,
                )

            mock_yunwu.assert_called_once()
            _first, _img, video_prompt_arg, _assets = mock_yunwu.call_args[0]
            self.assertEqual(video_prompt_arg, "BASE_VIDEO_PROMPT")
            self.assertNotIn("[Dialogue", video_prompt_arg)
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
