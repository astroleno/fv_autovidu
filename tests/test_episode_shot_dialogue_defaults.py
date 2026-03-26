# -*- coding: utf-8 -*-
"""
回归：旧版 episode.json 或未显式写入的台词/语言字段在 Pydantic 反序列化后应有稳定缺省。

验证 Shot 仅填必填键时 dialogue / dialogueTranslation / associatedDialogue 的默认值；
验证 Episode 仅填必填键时 dubTargetLocale / sourceLocale 的默认值。
"""

from __future__ import annotations

import sys
from pathlib import Path

# 与 tests/test_data_service_legacy_namespace_compat.py 一致：models 包位于 web/server 下
_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from models.schemas import Episode, Scene, Shot  # noqa: E402


def test_shot_missing_dialogue_fields_defaults() -> None:
    """
    仅提供 Shot 构造必填字段时，台词相关字段应为空串或 None，
    与缺省 episode.json 片段或旧数据兼容。
    """
    s = Shot(
        shotId="shot-a",
        shotNumber=1,
        imagePrompt="img",
        videoPrompt="vid",
        firstFrame="frames/S001.png",
        assets=[],
    )
    assert s.dialogue == ""
    assert s.dialogueTranslation == ""
    assert s.associatedDialogue is None


def test_episode_missing_locale_defaults() -> None:
    """
    最小 Episode（必填 + 空场景列表）在未写 dubTargetLocale / sourceLocale 时，
    应得到空串缺省，表示「未设置目标语 / 未标注源语言」。
    """
    e = Episode(
        projectId="proj-1",
        episodeId="ep-1",
        episodeTitle="最小剧集",
        episodeNumber=1,
        pulledAt="2025-03-26T00:00:00Z",
        scenes=[
            Scene(
                sceneId="sc-1",
                sceneNumber=1,
                title="",
                shots=[],
            )
        ],
    )
    assert e.dubTargetLocale == ""
    assert e.sourceLocale == ""
