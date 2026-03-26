# -*- coding: utf-8 -*-
"""
单测：services.prompt_compose.append_dialogue_for_video_prompt

验证无译文时不改提示词、有译文时追加固定对白块、以及已含标记时幂等。
"""

from __future__ import annotations

import sys
from pathlib import Path

# 与 tests/test_episode_shot_dialogue_defaults.py 一致：models 位于 web/server
_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from models.schemas import Shot  # noqa: E402
from services.prompt_compose import append_dialogue_for_video_prompt  # noqa: E402


def _minimal_shot(**kwargs) -> Shot:
    """构造仅含必填字段的 Shot，便于覆盖 dialogueTranslation 等可选字段。"""
    base = dict(
        shotId="s1",
        shotNumber=1,
        imagePrompt="img",
        videoPrompt="vid",
        firstFrame="frames/S001.png",
        assets=[],
    )
    base.update(kwargs)
    return Shot(**base)


def test_no_translation_leaves_prompt_unchanged() -> None:
    """dialogueTranslation 为空或仅空白时，应原样返回 video_prompt。"""
    shot = _minimal_shot(dialogueTranslation="")
    prompt = "A cinematic wide shot.\n"
    assert append_dialogue_for_video_prompt(prompt, shot) == prompt


def test_translation_appended_as_block() -> None:
    """有译文时应在去尾空白后的提示词后追加标题行与译文。"""
    shot = _minimal_shot(dialogueTranslation="Hello, world.")
    prompt = "Camera pushes in.  "
    out = append_dialogue_for_video_prompt(prompt, shot)
    assert out == (
        "Camera pushes in.\n\n[Dialogue for performance/lip-sync]\nHello, world.\n"
    )
    assert "[Dialogue for performance/lip-sync]" in out


def test_second_call_idempotent() -> None:
    """连续两次拼接：第二次不应再追加一段对白块。"""
    shot = _minimal_shot(dialogueTranslation="Line one.")
    prompt = "Visual only."
    once = append_dialogue_for_video_prompt(prompt, shot)
    twice = append_dialogue_for_video_prompt(once, shot)
    assert once == twice
    # 标记只出现一次
    assert twice.count("[Dialogue for performance/lip-sync]") == 1
