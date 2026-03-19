# -*- coding: utf-8 -*-
"""
yunwu API 公共模块

提供 yunwu Gemini 图生图能力：
- call_yunwu: 调用 generateContent 生成图片
- read_image_as_base64: 读取本地图片为 base64
- select_assets: 从资产名列表选取已存在的图片路径
"""

from src.yunwu.client import (
    call_yunwu,
    read_image_as_base64,
    resolve_asset_path,
    select_assets,
    YUNWU_BASE,
)

__all__ = [
    "call_yunwu",
    "read_image_as_base64",
    "resolve_asset_path",
    "select_assets",
    "YUNWU_BASE",
]
