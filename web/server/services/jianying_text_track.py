# -*- coding: utf-8 -*-
"""
剪映草稿字幕文本轨构建

职责：
- 从 Episode 的 Shot 抽取字幕正文（**不含** ``visualDescription``）：
  优先 **译文** ``dialogueTranslation``，否则 **原文** ``dialogue``，再否则结构化 ``associatedDialogue``
- 使用已安装的 pyJianYingDraft 生成与视频主轨 target_timerange 对齐的 TextSegment 素材与片段 JSON

说明：
- 样式对齐 pyJianYingDraft.script_file.ScriptFile.import_srt 的 subtitle 习惯：居中、自动换行、底部 transform_y；
  字号按产品约定使用 8（import_srt 默认示例为 5，本仓库计划指定为 8）。
- 纵向位置：``manual`` 为全段统一 ``transform_y``；``jianying_spec`` 为剪映经验公式 ``Y=-100n-400``，再写入
  ``ClipSettings.transform_y``。换算与剪映**属性面板里与「整幅画布高度」相乘后得到的读数**对齐（见
  ``y_pixel_to_clip_transform_y`` 与 ``docs/剪映字幕竖屏位置规范.md``）；**不是** ``Y/(H/2)``，否则界面会显示约 ``2Y``。
- 规范模式字号固定为 ``JIANYING_SPEC_FONT_SIZE``（13），不随行数变化。
- canvas_h 在规范版下参与公式像素 Y → transform_y 换算；canvas_w 仍保留供后续行宽相关扩展。
"""

from __future__ import annotations

import math
import re
from typing import Any, Literal

from pyJianYingDraft.segment import ClipSettings
from pyJianYingDraft.text_segment import TextSegment, TextStyle
from pyJianYingDraft.time_util import Timerange

from models.schemas import Shot

# 与 pyJianYingDraft.text_segment.TextStyle 文档一致：0 左 1 中 2 右
_SUBTITLE_ALIGN_TO_INT: dict[Literal["left", "center", "right"], int] = {
    "left": 0,
    "center": 1,
    "right": 2,
}

SubtitlePositionMode = Literal["manual", "jianying_spec"]

# 剪映规范：参与 Y=-100n-400 的行数 n 上限（超过则按 3 代入公式）
JIANYING_SPEC_MAX_LINES: int = 3

# 无显式换行时：竖屏字幕约 6～8 英文词/行（取 7）；中文约 12～16 字/行，用「字≈半词宽」与 7 词/行对齐
_JIANYING_SPEC_WORDS_PER_LINE: float = 7.0
_LATIN_WORD_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def _wrap_lines_estimate_single_block(text: str) -> int:
    """
    单行正文在剪映内自动折行时的**估算行数**（无 ``\\n`` 时）。

    英文按拉丁词计数除以 7；中日韩统一表意文字按「每字约半词宽」累加后再除以 7；
    其余符号/数字等仅在无词无字时按字符长度粗算。
    """
    t = text.strip()
    if not t:
        return 1
    words = len(_LATIN_WORD_RE.findall(t))
    cjk = len(_CJK_RE.findall(t))
    equiv = float(words) + 0.5 * float(cjk)
    if equiv <= 0:
        return max(1, math.ceil(len(t) / 40.0))
    return max(1, int(math.ceil(equiv / _JIANYING_SPEC_WORDS_PER_LINE)))


def estimate_subtitle_line_count(text: str) -> int:
    """
    规范用「行数」估算（**不**含 3 行上限，供预览表「换行分段数」列）。

    - 若有多条**显式**非空换行：行数 = 非空行条数。
    - 若整段无换行或仅一行：按 `_wrap_lines_estimate_single_block` 估算自动折行后的行数。

    参与公式时再取 ``min(本值, JIANYING_SPEC_MAX_LINES)``，见 `jianying_spec_line_count`。
    """
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) > 1:
        return max(1, len(lines))
    block = lines[0] if lines else text.strip()
    return _wrap_lines_estimate_single_block(block)


def jianying_spec_line_count(text: str) -> int:
    """
    规范版用于纵轴公式的行数 n（1～``JIANYING_SPEC_MAX_LINES``）。

    **如何确定**：
    1. 先求 `estimate_subtitle_line_count`（显式换行优先，否则按词/字宽估算折行行数）；
    2. **n = min(上值, JIANYING_SPEC_MAX_LINES)**。

    画面描述等非台词字段不参与字幕正文，见 `subtitle_text_from_shot`。
    """
    n = estimate_subtitle_line_count(text)
    return min(n, JIANYING_SPEC_MAX_LINES)


def jianying_spec_y_pixel(n: int) -> float:
    """
    剪映竖屏字幕经验公式（像素位移 Y，向下为负的惯例与 ClipSettings 一致）。

    公式：Y = -100n - 400，n 为规范行数（1～3，见 `jianying_spec_line_count`）。
    """
    nn = max(1, min(int(n), JIANYING_SPEC_MAX_LINES))
    return -100.0 * float(nn) - 400.0


# 剪映规范模式：字号固定（与产品约定一致），仅纵坐标随行数 n 变化。
JIANYING_SPEC_FONT_SIZE: float = 13.0


def y_pixel_to_clip_transform_y(y_px: float, canvas_height_px: int) -> float:
    """
    将规范公式中的像素 Y 写入 pyJianYingDraft ``ClipSettings.transform_y``。

    pyJianYingDraft 文档称 ``transform_y`` 以「半画布高」为单位；若按 ``Y / (H/2)`` 写入，剪映侧
    **与整幅高度相乘** 的读数会变成 ``2Y``（例如一行出现 **-1000** 而非公式 **-500**）。

    产品约定：使剪映里与 **整画布高度 H** 相乘后的数值与经验公式 ``Y=-100n-400`` **一致**，故：

        transform_y = Y_px / H

    若未来剪映版本读数与草稿不一致，以实测为准。
    """
    h = float(canvas_height_px)
    if h <= 0:
        return -0.8
    return y_px / h


def subtitle_text_from_shot(shot: Shot) -> str:
    """
    从分镜得到剪映字幕用正文（与 Vidu/TTS 一致：优先译文）。

    优先级：
    1. 非空 `shot.dialogueTranslation`（strip 后）
    2. 非空 `shot.dialogue`（strip 后）
    3. `shot.associatedDialogue`：role 与 content 均非空时「角色：内容」；否则仅非空 content

    **不包含** `visualDescription`：画面描述不是台词，不得写入字幕轨或用于行数预览。

    Returns:
        无可用台词时返回空字符串。
    """
    translated = (shot.dialogueTranslation or "").strip()
    if translated:
        return translated

    line = (shot.dialogue or "").strip()
    if line:
        return line

    ad = shot.associatedDialogue
    if ad is not None:
        role = (ad.role or "").strip()
        content = (ad.content or "").strip()
        if role and content:
            return f"{role}：{content}"
        if content:
            return content

    return ""


def build_text_track_payload(
    canvas_w: int,
    canvas_h: int,
    segments: list[tuple[int, int, str]],
    *,
    font_size: float = 8.0,
    align: Literal["left", "center", "right"] = "center",
    auto_wrapping: bool = True,
    transform_y: float = -0.8,
    position_mode: SubtitlePositionMode = "manual",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """
    根据 (起始微秒, 持续微秒, 文本) 列表构建剪映 materials.texts、text 轨 segments 及 speeds 条目。

    仅处理 strip 后非空的文本，与视频轨缺口镜对齐时可跳过空串不产生片段。

    Args:
        canvas_w: 画布宽（像素）
        canvas_h: 画布高（像素）；规范版下用于像素 Y → transform_y 换算
        segments: (start_us, duration_us, text) 与主视频各镜 target_timerange 一致
        font_size: 字幕字号，映射 ``TextStyle.size``
        align: 水平对齐，映射 ``TextStyle.align``（0/1/2）
        auto_wrapping: 是否自动换行
        transform_y: **manual** 模式下统一使用的 ``ClipSettings.transform_y``
        font_size: **manual** 模式下统一字号；**jianying_spec** 下忽略请求体字号，固定为 `JIANYING_SPEC_FONT_SIZE`（13）
        position_mode: ``manual`` 全段同一 transform_y 与字号；``jianying_spec`` 纵坐标按 ``jianying_spec_line_count``（n≤3），字号固定

    Returns:
        (text_material_dicts, segment_dicts, speed_dicts)。
        speed_dicts 必须与 segment.extra_material_refs 中的 speed id 一并写入 draft materials.speeds，
        否则客户端可能无法解析引用。
    """
    _ = canvas_w

    text_materials: list[dict[str, Any]] = []
    segment_jsons: list[dict[str, Any]] = []
    speed_materials: list[dict[str, Any]] = []

    align_int = _SUBTITLE_ALIGN_TO_INT[align]
    manual_style = TextStyle(
        size=font_size,
        align=align_int,
        auto_wrapping=auto_wrapping,
    )

    for start_us, duration_us, text in segments:
        body = (text or "").strip()
        if not body:
            continue
        if duration_us <= 0:
            continue

        if position_mode == "jianying_spec":
            n = jianying_spec_line_count(body)
            y_px = jianying_spec_y_pixel(n)
            ty = y_pixel_to_clip_transform_y(y_px, canvas_h)
            style = TextStyle(
                size=JIANYING_SPEC_FONT_SIZE,
                align=align_int,
                auto_wrapping=auto_wrapping,
            )
        else:
            ty = transform_y
            style = manual_style
        clip = ClipSettings(transform_y=ty)

        seg = TextSegment(
            body,
            Timerange(int(start_us), int(duration_us)),
            style=style,
            clip_settings=clip,
        )
        text_materials.append(seg.export_material())
        segment_jsons.append(seg.export_json())
        speed_materials.append(seg.speed.export_json())

    return (text_materials, segment_jsons, speed_materials)
