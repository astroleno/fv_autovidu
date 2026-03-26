# -*- coding: utf-8 -*-
"""
视频 / 尾帧提示词拼装：在发往 Vidu、云雾等下游前，按需附加「译文台词」块。

设计要点：
- 与具体 Pydantic 模型解耦：通过 getattr 读取 shot.dialogueTranslation，便于单测传入简易对象。
- 幂等：若提示词中已含固定标记 `[Dialogue for performance/lip-sync]`，则不再重复拼接，
  避免同一流程多次调用时堆叠多段对白块。
"""

from __future__ import annotations

# Vidu 口型/表演用对白块的固定标题行，需与 idempotency 检测字符串完全一致
_DIALOGUE_BLOCK_HEADER = "[Dialogue for performance/lip-sync]"


def append_dialogue_for_video_prompt(video_prompt: str, shot) -> str:
    """
    在视频提示词末尾追加「译文台词」块，供 Vidu 口型同步与表演参考。

    行为说明：
    1. 从 ``shot`` 读取 ``dialogueTranslation``（缺失或非字符串时视为空）。
    2. 去掉首尾空白后若为空，原样返回 ``video_prompt``。
    3. 若 ``video_prompt`` 中已包含标记 ``[Dialogue for performance/lip-sync]``，
       视为已拼接过，原样返回（幂等）。
    4. 否则在 ``video_prompt`` 右侧去空白后，追加固定格式的块：
       两个换行 + 标题行 + 换行 + 译文 + 换行。

    Args:
        video_prompt: 当前镜头视频提示词（可能已含其它结构化段落）。
        shot: 任意具有可选属性 ``dialogueTranslation`` 的对象（如 ``models.schemas.Shot``）。

    Returns:
        拼接后的提示词字符串，或在无需修改时返回原 ``video_prompt`` 引用等价内容。
    """
    # 与计划一致：从 shot 取译文并 strip；空则整条提示词不改动
    chunk = (getattr(shot, "dialogueTranslation", None) or "").strip()
    if not chunk:
        return video_prompt

    # 已含对白块标记时不重复追加，保证多次调用安全
    if _DIALOGUE_BLOCK_HEADER in video_prompt:
        return video_prompt

    block = f"\n\n{_DIALOGUE_BLOCK_HEADER}\n{chunk}\n"
    return video_prompt.rstrip() + block
