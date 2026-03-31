# -*- coding: utf-8 -*-
"""
剪映草稿字幕文本轨构建

职责：
- 从 Episode 的 Shot 抽取用于字幕展示的一行字符串：
  优先用户编辑的 **译文** ``dialogueTranslation``，否则 **原文** ``dialogue``，再否则结构化 ``associatedDialogue``
- 使用已安装的 pyJianYingDraft 生成与视频主轨 target_timerange 对齐的 TextSegment 素材与片段 JSON

说明：
- 样式对齐 pyJianYingDraft.script_file.ScriptFile.import_srt 的 subtitle 习惯：居中、自动换行、底部 transform_y；
  字号按产品约定使用 8（import_srt 默认示例为 5，本仓库计划指定为 8）。
- canvas_w / canvas_h 入参保留给后续按分辨率微调 clip 或行宽时使用；当前 TextStyle 使用相对 max_line_width。
"""

from __future__ import annotations

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


def estimate_subtitle_line_count(text: str) -> int:
    """
    统计用于「规范版」纵向公式的行数 n。

    按换行符分段，忽略空行；无有效行时视为 1 行。
    自动换行导致的行数无法在此估算，需在分镜里用真实换行分段。
    """
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return max(1, len(lines))


def jianying_spec_y_pixel(n: int) -> float:
    """
    剪映竖屏字幕经验公式（像素位移 Y，向下为负的惯例与 ClipSettings 一致）。

    公式：Y = -100n - 400，n 为字幕行数（≥1）。
    """
    nn = max(1, int(n))
    return -100.0 * float(nn) - 400.0


def y_pixel_to_clip_transform_y(y_px: float, canvas_height_px: int) -> float:
    """
    将像素位移转换为 pyJianYingDraft ``ClipSettings.transform_y``。

    库定义：垂直位移单位为 **半个画布高**（见 ``segment.ClipSettings`` 文档）。
    transform_y = Y_px / (canvas_height / 2)
    """
    half = float(canvas_height_px) / 2.0
    if half <= 0:
        return -0.8
    return y_px / half


def subtitle_text_from_shot(shot: Shot) -> str:
    """
    从分镜得到单行字幕文案（与 Vidu/TTS 共用「译文」字段时，剪映也优先展示译文）。

    优先级：
    1. 非空 `shot.dialogueTranslation`（strip 后）— 用户在本机填写的目标语字幕
    2. 非空 `shot.dialogue`（strip 后）— 平台拉取的原文台词行
    3. `shot.associatedDialogue`：role 与 content 均非空时格式化为「角色：内容」；否则仅返回非空的 content（仅 role 无 content 时返回空）

    Returns:
        无可用文案时返回空字符串。
    """
    translated = (shot.dialogueTranslation or "").strip()
    if translated:
        return translated

    line = (shot.dialogue or "").strip()
    if line:
        return line

    ad = shot.associatedDialogue
    if ad is None:
        return ""

    role = (ad.role or "").strip()
    content = (ad.content or "").strip()
    if not role and not content:
        return ""
    if role and content:
        return f"{role}：{content}"
    return content


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
        position_mode: ``manual`` 全段同一 transform_y；``jianying_spec`` 按每条字幕行数 n 使用 Y=-100n-400 再换算

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
    subtitle_style = TextStyle(
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
            n = estimate_subtitle_line_count(body)
            y_px = jianying_spec_y_pixel(n)
            ty = y_pixel_to_clip_transform_y(y_px, canvas_h)
        else:
            ty = transform_y
        clip = ClipSettings(transform_y=ty)

        seg = TextSegment(
            body,
            Timerange(int(start_us), int(duration_us)),
            style=subtitle_style,
            clip_settings=clip,
        )
        text_materials.append(seg.export_material())
        segment_jsons.append(seg.export_json())
        speed_materials.append(seg.speed.export_json())

    return (text_materials, segment_jsons, speed_materials)
