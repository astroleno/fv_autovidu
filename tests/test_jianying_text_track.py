# -*- coding: utf-8 -*-
"""
剪映字幕轨：subtitle_text_from_shot 与 build_text_track_payload 单测。
"""

from __future__ import annotations

import json
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

    def test_subtitle_prefers_translation_over_dialogue(self) -> None:
        """有译文时剪映字幕与 Vidu/TTS 一致，优先展示译文。"""
        from models.schemas import Shot
        from services.jianying_text_track import subtitle_text_from_shot

        shot = Shot(
            shotId="s1",
            shotNumber=1,
            imagePrompt="",
            videoPrompt="",
            firstFrame="",
            dialogue="原文",
            dialogueTranslation="Translated line",
        )
        self.assertEqual(subtitle_text_from_shot(shot), "Translated line")

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

    def test_build_text_track_payload_align_changes_material(self) -> None:
        """不同 align 应产生不同字幕素材（映射 0/1/2）。"""
        from services.jianying_text_track import build_text_track_payload

        seg = [(0, 1_000_000, "一行")]
        left_m, _, _ = build_text_track_payload(
            1080, 1920, seg, align="left"
        )
        right_m, _, _ = build_text_track_payload(
            1080, 1920, seg, align="right"
        )
        self.assertNotEqual(left_m[0], right_m[0])

    def test_jianying_spec_mode_per_segment_transform(self) -> None:
        """规范版：行数不同则 transform_y 不同（写入 clip_settings）。"""
        from services.jianying_text_track import build_text_track_payload

        mats, segs, _ = build_text_track_payload(
            1080,
            1920,
            [
                (0, 1_000_000, "单行"),
                (1_000_000, 1_000_000, "第一行\n第二行"),
            ],
            position_mode="jianying_spec",
        )
        self.assertEqual(len(segs), 2)
        y0 = segs[0]["clip"]["transform"]["y"]
        y1 = segs[1]["clip"]["transform"]["y"]
        self.assertNotEqual(y0, y1)
        # n=1 → Y=-500 → transform_y = -500/960；n=2 → Y=-600 → -600/960
        self.assertAlmostEqual(y0, -500.0 / 960.0, places=5)
        self.assertAlmostEqual(y1, -600.0 / 960.0, places=5)
        # n=1 → 字号 16；n=2 → 14（material.content 为 JSON 字符串）
        s0 = json.loads(mats[0]["content"])["styles"][0]["size"]
        s1 = json.loads(mats[1]["content"])["styles"][0]["size"]
        self.assertEqual(s0, 16.0)
        self.assertEqual(s1, 14.0)

    def test_manual_mode_same_transform_all_segments(self) -> None:
        from services.jianying_text_track import build_text_track_payload

        _, segs, _ = build_text_track_payload(
            1080,
            1920,
            [
                (0, 1_000_000, "a"),
                (1_000_000, 1_000_000, "b\nc"),
            ],
            transform_y=-0.7,
            position_mode="manual",
        )
        self.assertEqual(segs[0]["clip"]["transform"]["y"], -0.7)
        self.assertEqual(segs[1]["clip"]["transform"]["y"], -0.7)


if __name__ == "__main__":
    unittest.main()
