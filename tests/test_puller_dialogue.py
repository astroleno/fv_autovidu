# -*- coding: utf-8 -*-
"""
puller._get_dialogue_fields 单元测试。

覆盖：顶层 dialogue / associatedDialogue、metadata 嵌套与 shot_list 内 snake_case associated_dialogue，
以及无数据、null 等边界情况。（写入 shots_out 的集成行为见后续 Task。）
"""

from __future__ import annotations

from src.feeling import puller


def test_get_dialogue_fields_full_string() -> None:
    """顶层同时给出台词行与结构化对白时，原样规范化返回。"""
    sh = {
        "dialogue": "卡尔：格雷·金斯顿。",
        "associatedDialogue": {"role": "卡尔", "content": "格雷·金斯顿。"},
    }
    d, ad = puller._get_dialogue_fields(sh)
    assert d == "卡尔：格雷·金斯顿。"
    assert ad == {"role": "卡尔", "content": "格雷·金斯顿。"}


def test_get_dialogue_fields_nested_metadata() -> None:
    """台词在 metadata.dialogue；结构化对白在 shot_list[0].associated_dialogue（snake_case）。"""
    sh = {
        "metadata": {
            "dialogue": "格雷：怎么了？",
            "shotMaster": {
                "raw": {
                    "shot_list": [
                        {"associated_dialogue": {"role": "格雷", "content": "怎么了？"}},
                    ],
                },
            },
        },
    }
    d, ad = puller._get_dialogue_fields(sh)
    assert "怎么了" in d
    assert ad is not None
    assert ad.get("role") == "格雷"


def test_get_dialogue_fields_empty_shot() -> None:
    """空 dict：无任何台词信息时固定为 ("", None)。"""
    d, ad = puller._get_dialogue_fields({})
    assert d == ""
    assert ad is None


def test_get_dialogue_fields_null_dialogue() -> None:
    """顶层 dialogue 为 JSON null（Python None）时视为缺失，且无其它来源则整体无台词信息。"""
    sh = {"dialogue": None}
    d, ad = puller._get_dialogue_fields(sh)
    assert d == ""
    assert ad is None


def test_get_dialogue_fields_shot_list_scans_non_first_item() -> None:
    """
    shot_list 中首条无 associated_dialogue 时，继续向后扫描；
    且支持项内 snake_case ``associated_dialogue``。
    仅有结构化对白时，会拼成一行写入 dialogue 供分镜表展示。
    """
    sh = {
        "metadata": {
            "shotMaster": {
                "raw": {
                    "shot_list": [
                        {},
                        {"associated_dialogue": {"role": "B", "content": "第二镜"}},
                    ],
                },
            },
        },
    }
    d, ad = puller._get_dialogue_fields(sh)
    assert d == "B：第二镜"
    assert ad == {"role": "B", "content": "第二镜"}


def test_get_dialogue_fields_shot_list_plain_dialogue_string() -> None:
    """部分镜头台词仅在 shot_list[].dialogue 纯文本，无顶层 dialogue。"""
    sh = {
        "metadata": {
            "shotMaster": {
                "raw": {
                    "shot_list": [
                        {"dialogue": "物业这边登记一下。"},
                    ],
                },
            },
        },
    }
    d, ad = puller._get_dialogue_fields(sh)
    assert d == "物业这边登记一下。"
    assert ad is None
