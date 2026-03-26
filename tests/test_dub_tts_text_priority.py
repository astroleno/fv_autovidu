# -*- coding: utf-8 -*-
"""
单测：routes.dub_route._resolve_tts_text

验证 TTS 朗读文本解析顺序（显式 tts_text → dialogueTranslation → videoPrompt），
以及全空时抛出 ValueError。不调用 ElevenLabs / data_service，仅测模块级纯函数。
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

# models / routes 位于 web/server，与仓库内其他 tests 一致
_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from models.schemas import Shot  # noqa: E402
from routes.dub_route import _resolve_tts_text  # noqa: E402


def _minimal_shot(**kwargs) -> Shot:
    """构造带默认 videoPrompt / dialogueTranslation 的 Shot，便于覆盖各字段。"""
    base = dict(
        shotId="s1",
        shotNumber=1,
        imagePrompt="img",
        videoPrompt="fallback prompt",
        firstFrame="frames/S001.png",
        assets=[],
        dialogueTranslation="",
    )
    base.update(kwargs)
    return Shot(**base)


def test_explicit_tts_text_takes_priority_over_shot_fields() -> None:
    """非空 tts_text 应优先于分镜上的译文与 videoPrompt。"""
    shot = _minimal_shot(
        dialogueTranslation="译文",
        videoPrompt="vp",
    )
    assert _resolve_tts_text(shot, "  override  ") == "override"


def test_whitespace_only_tts_text_falls_through() -> None:
    """仅空白的 tts_text 视为未提供，应继续尝试译文。"""
    shot = _minimal_shot(dialogueTranslation="  你好  ")
    assert _resolve_tts_text(shot, "   ") == "你好"


def test_uses_dialogue_translation_when_tts_text_missing() -> None:
    """tts_text 为 None 时采用 dialogueTranslation。"""
    shot = _minimal_shot(dialogueTranslation="Translated line")
    assert _resolve_tts_text(shot, None) == "Translated line"


def test_falls_back_to_video_prompt() -> None:
    """无显式 tts、无译文时回退到 videoPrompt。"""
    shot = _minimal_shot(dialogueTranslation="", videoPrompt="scene description")
    assert _resolve_tts_text(shot, None) == "scene description"


def test_getattr_shot_without_dialogue_translation_uses_video_prompt() -> None:
    """旧对象无 dialogueTranslation 属性时，应跳过该层并落到 videoPrompt。"""
    legacy = SimpleNamespace(videoPrompt="legacy vp only")
    assert _resolve_tts_text(legacy, None) == "legacy vp only"


def test_raises_value_error_when_all_sources_empty() -> None:
    """三层皆空时抛出 ValueError，且文案提示译文与 videoPrompt。"""
    shot = _minimal_shot(dialogueTranslation="", videoPrompt="")
    with pytest.raises(ValueError, match="译文") as exc_info:
        _resolve_tts_text(shot, None)
    assert "videoPrompt" in str(exc_info.value)


def test_raises_when_shot_lacks_video_prompt_and_no_tts() -> None:
    """极简对象无 videoPrompt、无译文、无 tts 时同样失败。"""
    bare = SimpleNamespace()
    with pytest.raises(ValueError):
        _resolve_tts_text(bare, None)
