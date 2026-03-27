# -*- coding: utf-8 -*-
"""
单测：services.prompt_compose.append_dialogue_for_video_prompt

覆盖：
- 无译文且无原文：不改提示词
- 有译文：追加对白块；可选 target_locale 体现在标题行
- 无译文有原文：兜底原文 + source_locale
- 幂等：旧标题行、带语种的新标题行、连续两次调用
- 正则：仅匹配独立标题行，避免正文子串误判（与旧版 ``in`` 行为差异的受控场景）
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
    """构造仅含必填字段的 Shot，便于覆盖 dialogue / dialogueTranslation 等可选字段。"""
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


def test_no_dialogue_leaves_prompt_unchanged() -> None:
    """译文与原文均为空时，应原样返回 video_prompt。"""
    shot = _minimal_shot(dialogueTranslation="", dialogue="")
    prompt = "A cinematic wide shot.\n"
    assert append_dialogue_for_video_prompt(prompt, shot) == prompt


def test_translation_appended_as_block() -> None:
    """有译文时应在去尾空白后的提示词后追加标题行与译文（无语种时兼容旧标题）。"""
    shot = _minimal_shot(dialogueTranslation="Hello, world.")
    prompt = "Camera pushes in.  "
    out = append_dialogue_for_video_prompt(prompt, shot)
    assert out == (
        "Camera pushes in.\n\n[Dialogue for performance/lip-sync]\nHello, world.\n"
    )
    assert "[Dialogue for performance/lip-sync]" in out


def test_translation_with_target_locale() -> None:
    """有译文且传入 target_locale 时，标题行应包含 (locale)。"""
    shot = _minimal_shot(dialogueTranslation="「テスト」")
    prompt = "Wide."
    out = append_dialogue_for_video_prompt(
        prompt, shot, target_locale="ja-JP", source_locale="zh-CN"
    )
    assert (
        out
        == "Wide.\n\n[Dialogue (ja-JP) for performance/lip-sync]\n「テスト」\n"
    )


def test_fallback_to_dialogue_with_source_locale() -> None:
    """无译文时回退到 dialogue，并使用 source_locale。"""
    shot = _minimal_shot(dialogueTranslation="", dialogue="  原文一句  ")
    out = append_dialogue_for_video_prompt(
        "P.", shot, target_locale="ja-JP", source_locale="zh-CN"
    )
    assert (
        out
        == "P.\n\n[Dialogue (zh-CN) for performance/lip-sync]\n原文一句\n"
    )


def test_translation_empty_whitespace_falls_back_to_dialogue() -> None:
    """dialogueTranslation 仅空白时视为空，应走原文兜底。"""
    shot = _minimal_shot(dialogueTranslation="   \n", dialogue="fallback line")
    out = append_dialogue_for_video_prompt(
        "X", shot, target_locale="en-US", source_locale="zh-CN"
    )
    assert "fallback line" in out
    assert "[Dialogue (zh-CN) for performance/lip-sync]" in out


def test_second_call_idempotent() -> None:
    """连续两次拼接：第二次不应再追加一段对白块。"""
    shot = _minimal_shot(dialogueTranslation="Line one.")
    prompt = "Visual only."
    once = append_dialogue_for_video_prompt(prompt, shot)
    twice = append_dialogue_for_video_prompt(once, shot)
    assert once == twice
    # 标题行（旧格式）只出现一次
    assert twice.count("[Dialogue for performance/lip-sync]") == 1


def test_idempotent_when_header_has_locale() -> None:
    """提示词已含带语种的新格式标题行时不重复追加。"""
    shot = _minimal_shot(dialogueTranslation="more")
    existing = (
        "Scene.\n\n[Dialogue (ja-JP) for performance/lip-sync]\n既存台词\n"
    )
    assert append_dialogue_for_video_prompt(existing, shot) == existing


def test_idempotent_old_header_format() -> None:
    """兼容旧格式独立标题行（无语种括号）。"""
    shot = _minimal_shot(dialogueTranslation="try append")
    existing = "Old.\n\n[Dialogue for performance/lip-sync]\nold line\n"
    assert append_dialogue_for_video_prompt(existing, shot) == existing


def test_non_line_header_does_not_trigger_idempotency() -> None:
    """
    同一行内若仅出现子串而非「整行标题」，正则不应判为已拼接；
    设计上有意比旧 ``in`` 更严格，避免误跳过；此处会再追加一块（符合整行匹配策略）。
    """
    shot = _minimal_shot(dialogueTranslation="new line")
    # 行首不是 [Dialogue，而是句中夹杂标记
    prompt = 'Say "[Dialogue for performance/lip-sync]" as a phrase.'
    out = append_dialogue_for_video_prompt(prompt, shot)
    assert out.endswith("[Dialogue for performance/lip-sync]\nnew line\n")
    assert prompt in out or prompt.rstrip() in out
