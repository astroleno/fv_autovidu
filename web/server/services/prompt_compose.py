# -*- coding: utf-8 -*-
"""
视频提示词拼装：在发往 Vidu 前按需附加「台词」块（译文优先，原文兜底），并标注语种。

设计要点（与 docs/视频提示词语种台词注入/设计说明.md 一致）：
- 与具体 Pydantic 模型解耦：通过 getattr 读取 shot 上的 dialogue / dialogueTranslation。
- 幂等：若提示词中已存在**独立一行**的对白块标题（含可选 ``(locale)``），则不再重复拼接；
  使用正则整行匹配，避免正文子串误判。
- 尾帧（Yunwu）链路不在此函数拼接台词；由路由层直接传 ``shot.videoPrompt`` 原样。
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# 对白块标题行：与幂等检测、拼接输出格式必须一致。
# 兼容旧格式：[Dialogue for performance/lip-sync]
# 新格式：   [Dialogue (ja-JP) for performance/lip-sync]（locale 为 BCP-47 raw code）
# ---------------------------------------------------------------------------
_DIALOGUE_BLOCK_RE = re.compile(
    r"^\[Dialogue(?: \([^)]+\))? for performance/lip-sync\]$",
    re.MULTILINE,
)


def append_dialogue_for_video_prompt(
    video_prompt: str,
    shot,
    target_locale: str = "",
    source_locale: str = "",
) -> str:
    """
    在视频提示词末尾追加「台词」块，供 Vidu 口型同步与表演参考。

    行为说明：
    1. 优先取 ``dialogueTranslation``（strip 后非空视为使用译文）。
    2. 译文为空时回退到 ``dialogue``（原文台词）。
    3. 两者皆空则原样返回 ``video_prompt``。
    4. 若 ``video_prompt`` 中已通过正则匹配到对白块标题行，视为已拼接，原样返回（幂等）。
    5. 否则在去尾空白后追加：空行 + 标题行（可选 ``(locale)``）+ 换行 + 台词正文 + 换行。
       - 使用译文时 locale 取 ``target_locale``（Episode.dubTargetLocale）
       - 使用原文兜底时 locale 取 ``source_locale``（Episode.sourceLocale）
       - locale 为空则标题退化为旧格式 ``[Dialogue for performance/lip-sync]``

    Args:
        video_prompt: 当前镜头视频提示词。
        shot: 任意具有可选属性 ``dialogueTranslation`` / ``dialogue`` 的对象。
        target_locale: 译文字段对应的语种标签（BCP-47，如 ``ja-JP``）。
        source_locale: 原文台词对应的语种标签。

    Returns:
        拼接后的提示词字符串；无需修改时返回与输入等价的字符串。
    """
    # ---------- 1) 解析台词正文：译文优先，否则原文 ----------
    chunk = (getattr(shot, "dialogueTranslation", None) or "").strip()
    used_translation = bool(chunk)

    if not chunk:
        chunk = (getattr(shot, "dialogue", None) or "").strip()

    if not chunk:
        return video_prompt

    # ---------- 2) 幂等：已存在标准标题行则不再追加 ----------
    if _DIALOGUE_BLOCK_RE.search(video_prompt):
        return video_prompt

    # ---------- 3) 语种标签：按实际选用的文本来源选 locale ----------
    locale = target_locale if used_translation else source_locale
    lang_hint = f" ({locale})" if (locale or "").strip() else ""

    block = (
        f"\n\n[Dialogue{lang_hint} for performance/lip-sync]\n{chunk}\n"
    )
    return video_prompt.rstrip() + block
