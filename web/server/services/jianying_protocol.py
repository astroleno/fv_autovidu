# -*- coding: utf-8 -*-
"""
剪映（CapCut 国内版）草稿协议常量与画布规格

说明：
- 剪映草稿格式未公开，本模块仅维护「最小可迭代」版本号与画布映射，
  便于实机验证失败后快速调整模板（见 docs/剪映与配音接入方案）。
- 时间轴统一使用微秒（与接入方案文档一致）。
"""

from __future__ import annotations

from typing import Literal

# 与 jianying_service 生成物对齐；升级破坏性变更时递增
PROTOCOL_TEMPLATE_VERSION = "1.0.0-minimal"

# 微秒换算
USEC_PER_SEC = 1_000_000

CanvasSizeLiteral = Literal["720p", "1080p"]


def canvas_wh(canvas_size: CanvasSizeLiteral) -> tuple[int, int]:
    """
    将业务画布档位映射为像素宽高（横屏 16:9，历史兼容）。

    剪映导出主流程已改用 :func:`canvas_wh_vertical_9_16` + ``draft_content.json``。
    """
    if canvas_size == "1080p":
        return (1920, 1080)
    return (1280, 720)


def canvas_wh_vertical_9_16(canvas_size: CanvasSizeLiteral) -> tuple[int, int]:
    """
    竖屏 9:16 画布（短视频常见），与 pyJianYingDraft.ScriptFile 创建参数一致。

    Args:
        canvas_size: 720p → 720×1280；1080p → 1080×1920

    Returns:
        (width, height)
    """
    if canvas_size == "1080p":
        return (1080, 1920)
    return (720, 1280)
