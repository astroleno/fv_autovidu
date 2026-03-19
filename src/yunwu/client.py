# -*- coding: utf-8 -*-
"""
yunwu API 客户端

封装 yunwu Gemini generateContent 图生图能力，供 gen_tail（尾帧生成）和 regen_frame（单帧重生）复用。

主要函数：
- call_yunwu: 调用 API 生成图片，返回二进制数据
- read_image_as_base64: 读取本地图片为 (mime_type, base64_str)
- resolve_asset_path: 按资产名解析图片路径
- select_assets: 从资产名列表选取最多 max_count 个已存在的图片
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import requests

# yunwu Gemini 端点基础 URL
YUNWU_BASE = "https://yunwu.ai/v1beta/models"
# 默认模型与端点
DEFAULT_MODEL = "gemini-3.1-flash-image-preview"
DEFAULT_ENDPOINT = f"{YUNWU_BASE}/{DEFAULT_MODEL}:generateContent"


def read_image_as_base64(path: Path) -> tuple[str, str]:
    """
    读取本地图片为 base64 编码，供 API 上传使用。

    Args:
        path: 图片文件路径

    Returns:
        (mime_type, base64_str) 元组，如 ("image/png", "iVBORw0KGgo...")
    """
    data = path.read_bytes()
    b64 = base64.standard_b64encode(data).decode("ascii")
    ext = path.suffix.lower()
    mime = "image/png" if ext in (".png",) else "image/jpeg"
    return mime, b64


def resolve_asset_path(assets_dir: Path, name: str) -> Path | None:
    """
    根据资产名称解析图片路径，支持 .png、.jpg、.jpeg 扩展名。

    Args:
        assets_dir: 资产目录
        name: 资产名称（不含扩展名）

    Returns:
        存在则返回 Path，否则返回 None
    """
    for ext in (".png", ".jpg", ".jpeg"):
        p = assets_dir / f"{name}{ext}"
        if p.exists():
            return p
    return None


def select_assets(
    asset_names: list[str],
    assets_dir: Path,
    max_count: int = 2,
) -> list[Path]:
    """
    从资产名列表中选取最多 max_count 个已存在的图片路径。

    按传入顺序遍历，优先选择角色类资产（人名等）。

    Args:
        asset_names: 资产名称列表（如 ["达里尔", "废弃仓库"]）
        assets_dir: 资产目录
        max_count: 最多选取数量，默认 2（yunwu 首帧 + 资产图限制）

    Returns:
        已存在图片的 Path 列表
    """
    chosen: list[Path] = []
    for name in asset_names:
        if len(chosen) >= max_count:
            break
        p = resolve_asset_path(assets_dir, name)
        if p and p not in chosen:
            chosen.append(p)
    return chosen


def call_yunwu(
    api_key: str,
    text: str,
    first_frame_b64: tuple[str, str],
    asset_images: list[tuple[str, str]],
    *,
    endpoint: str | None = None,
    aspect_ratio: str = "9:16",
    image_size: str = "2K",
) -> bytes:
    """
    调用 yunwu Gemini generateContent，生成图片。

    请求格式：文本 prompt + 首帧图（inline_data）+ 资产图（可选 0-2 张）。
    响应解析：从 candidates[0].content.parts 中提取 inlineData.data。

    Args:
        api_key: yunwu API Key（Bearer 认证）
        text: 文本提示词
        first_frame_b64: 首帧图 (mime_type, base64_str)
        asset_images: 资产图列表 [(mime, b64), ...]，最多 2 张
        endpoint: 可覆盖默认端点，用于切换模型
        aspect_ratio: 输出图片比例，如 "9:16"
        image_size: 输出尺寸，1K | 2K | 4K

    Returns:
        生成的图片二进制数据

    Raises:
        RuntimeError: API 未返回候选或未找到图片数据
    """
    parts: list[dict] = [{"text": text}]
    parts.append({
        "inline_data": {
            "mime_type": first_frame_b64[0],
            "data": first_frame_b64[1],
        },
    })
    for mime, b64 in asset_images:
        parts.append({
            "inline_data": {
                "mime_type": mime,
                "data": b64,
            },
        })

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
                "imageSize": image_size,
            },
        },
    }

    url = endpoint or DEFAULT_ENDPOINT
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=480,
    )
    resp.raise_for_status()
    data = resp.json()

    # 解析返回的图片：candidates[0].content.parts 中找 inline_data
    cands = data.get("candidates", [])
    if not cands:
        raise RuntimeError(
            f"API 未返回候选: {json.dumps(data, ensure_ascii=False)[:500]}"
        )

    for part in cands[0].get("content", {}).get("parts", []):
        if "inlineData" in part:
            inline = part["inlineData"]
            b64_str = inline.get("data")
            if b64_str:
                return base64.standard_b64decode(b64_str)

    raise RuntimeError("API 返回中未找到图片数据")
