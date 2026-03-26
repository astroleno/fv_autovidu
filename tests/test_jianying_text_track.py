# -*- coding: utf-8 -*-
"""
剪映原文字幕轨：subtitle_text_from_shot 与 build_text_track_payload 单测。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
_SERVER = _REPO / "web" / "server"
if str(_SERVER) not in sys.path:
    sys.path.insert(0, str(_SERVER))


class TestSubtitleTextFromShot(unittest.TestCase):
    """验证从 Shot 抽取单行字幕文案的规则。"""

    def test_subtitle_text_from_shot_dialogue_only(self) -> None:
        from models.schemas import Shot
        from services.jianying_text_track import subtitle_text_from_shot

        shot = Shot(
            shotId="s1",
            shotNumber=1,
            imagePrompt="",
            videoPrompt="",
            firstFrame="",
            dialogue="  你好  ",
        )
        self.assertEqual(subtitle_text_from_shot(shot), "你好")

    def test_subtitle_text_from_associated_dialogue(self) -> None:
        from models.schemas import AssociatedDialogue, Shot
        from services.jianying_text_track import subtitle_text_from_shot

        shot = Shot(
            shotId="s2",
            shotNumber=2,
            imagePrompt="",
            videoPrompt="",
            firstFrame="",
            dialogue="",
            associatedDialogue=AssociatedDialogue(role="卡尔", content="格雷·金斯顿。"),
        )
        self.assertEqual(subtitle_text_from_shot(shot), "卡尔：格雷·金斯顿。")

        content_only = Shot(
            shotId="s3",
            shotNumber=3,
            imagePrompt="",
            videoPrompt="",
            firstFrame="",
            associatedDialogue=AssociatedDialogue(role="", content="仅正文"),
        )
        self.assertEqual(subtitle_text_from_shot(content_only), "仅正文")

        role_only = Shot(
            shotId="s4",
            shotNumber=4,
            imagePrompt="",
            videoPrompt="",
            firstFrame="",
            associatedDialogue=AssociatedDialogue(role="无名", content=""),
        )
        self.assertEqual(subtitle_text_from_shot(role_only), "")


class TestBuildTextTrackPayload(unittest.TestCase):
    """验证 pyJianYingDraft 生成的素材与片段数量。"""

    def test_build_text_track_payload_materials_match_segments(self) -> None:
        from services.jianying_text_track import build_text_track_payload

        mats, segs, spds = build_text_track_payload(
            1080,
            1920,
            [
                (0, 1_000_000, "第一镜"),
                (1_000_000, 2_000_000, "第二镜"),
            ],
        )
        self.assertEqual(len(mats), 2)
        self.assertEqual(len(segs), 2)
        self.assertEqual(len(spds), 2)
        self.assertTrue(all(isinstance(m, dict) and m.get("type") == "subtitle" for m in mats))

    def test_build_text_track_payload_skips_empty(self) -> None:
        from services.jianying_text_track import build_text_track_payload

        mats, segs, spds = build_text_track_payload(
            1080,
            1920,
            [(0, 1_000_000, "   "), (0, 1_000_000, "")],
        )
        self.assertEqual(len(mats), 0)
        self.assertEqual(len(segs), 0)
        self.assertEqual(len(spds), 0)


if __name__ == "__main__":
    unittest.main()
