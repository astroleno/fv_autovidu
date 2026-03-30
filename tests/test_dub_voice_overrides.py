# -*- coding: utf-8 -*-
"""
单测：一期 STS 工作台音色解析契约

验证：
1. Episode / Shot 模型已持久化 `dubDefaultVoiceId` / `dubVoiceIdOverride`
2. 批量配音不依赖请求体 `voiceOverrides`，而是从 episode.json 的持久化字段解析最终音色

不调用 ElevenLabs、不跑 dub_process 线程，仅测模块级纯函数与 Pydantic 契约。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from models.schemas import DubProcessRequest, Episode, Scene, Shot  # noqa: E402
from routes.dub_route import _voice_id_for_shot  # noqa: E402
from routes.episodes import _ALLOWED_EPISODE_PATCH_KEYS  # noqa: E402


def _episode_with_voice_fields(
    *,
    default_voice: str = "",
    shot_override: str = "",
) -> Episode:
    """构造最小 Episode，便于测试一期持久化字段与解析规则。"""
    shot = Shot(
        shotId="shot-a",
        shotNumber=1,
        imagePrompt="img",
        videoPrompt="vp",
        firstFrame="frames/f1.png",
        dubVoiceIdOverride=shot_override,
    )
    return Episode(
        projectId="proj-1",
        episodeId="ep-1",
        episodeTitle="EP1",
        episodeNumber=1,
        pulledAt="2026-03-30T00:00:00Z",
        dubDefaultVoiceId=default_voice,
        scenes=[Scene(sceneId="scene-1", sceneNumber=1, title="S1", shots=[shot])],
    )


def test_episode_and_shot_models_persist_phase1_voice_fields() -> None:
    """一期契约：Episode / Shot 必须有可持久化音色字段。"""
    ep = _episode_with_voice_fields(
        default_voice="voice-ep",
        shot_override="voice-shot",
    )
    dumped = ep.model_dump(mode="json")
    assert dumped["dubDefaultVoiceId"] == "voice-ep"
    shot_dump = dumped["scenes"][0]["shots"][0]
    assert shot_dump["dubVoiceIdOverride"] == "voice-shot"


def test_shot_override_wins_over_episode_default() -> None:
    """镜头覆盖非空时优先于集默认。"""
    ep = _episode_with_voice_fields(
        default_voice="voice-ep",
        shot_override="voice-shot",
    )
    shot = ep.scenes[0].shots[0]
    assert _voice_id_for_shot(ep, shot) == "voice-shot"


def test_empty_shot_override_falls_back_to_episode_default() -> None:
    """镜头未覆盖时使用 Episode.dubDefaultVoiceId。"""
    ep = _episode_with_voice_fields(
        default_voice="voice-ep",
        shot_override="",
    )
    shot = ep.scenes[0].shots[0]
    assert _voice_id_for_shot(ep, shot) == "voice-ep"


def test_blank_values_are_stripped_before_resolution() -> None:
    """带空白的字段需 strip；空白覆盖视为未覆盖。"""
    ep = _episode_with_voice_fields(
        default_voice="  voice-ep  ",
        shot_override="   ",
    )
    shot = ep.scenes[0].shots[0]
    assert _voice_id_for_shot(ep, shot) == "voice-ep"


@pytest.mark.parametrize(
    "default_voice, shot_override, expected",
    [
        ("voice-ep", "", "voice-ep"),
        ("voice-ep", "\tvoice-shot\n", "voice-shot"),
    ],
)
def test_resolver_uses_only_persisted_episode_and_shot_fields(
    default_voice: str,
    shot_override: str,
    expected: str,
) -> None:
    """解析函数仅依赖持久化 Episode/Shot，不依赖请求体 voiceOverrides。"""
    ep = _episode_with_voice_fields(
        default_voice=default_voice,
        shot_override=shot_override,
    )
    shot = ep.scenes[0].shots[0]
    assert _voice_id_for_shot(ep, shot) == expected


def test_batch_request_no_longer_accepts_voice_override_inputs() -> None:
    """一期批量接口不再要求前端传 voiceId / voiceOverrides。"""
    req = DubProcessRequest(episodeId="ep-1", mode="sts")
    dumped = req.model_dump(mode="json")
    assert dumped["episodeId"] == "ep-1"
    assert "voiceId" not in dumped
    assert "voiceOverrides" not in dumped


def test_episode_patch_whitelist_includes_dub_default_voice_id() -> None:
    """一期需要通过 PATCH /episodes 持久化集默认音色。"""
    assert "dubDefaultVoiceId" in _ALLOWED_EPISODE_PATCH_KEYS
