# -*- coding: utf-8 -*-
"""
yunwu 服务：尾帧生成、单帧重生

封装 src.yunwu.client 和提示词构建，供 generate 路由调用。
"""

from __future__ import annotations

import os
from pathlib import Path

# 确保项目根在 path 中
import sys
_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.yunwu.client import call_yunwu, read_image_as_base64, select_assets, YUNWU_BASE

# 尾帧提示词模板（与 gen_tail.py 默认一致）
DEFAULT_TAIL_TEMPLATE = """请基于提供的首帧参考图，生成同一镜头结束瞬间的静态尾帧。

要求：
- 保持与首帧一致的角色身份、服装、发型、道具、场景和时间氛围
- 输出必须是镜头结束瞬间的单张静态画面，不要表现运动轨迹
- 补足尾帧中应该清晰可见、但首帧中不完整或未出现的关键资产
- 保持构图、镜头语言和光线连续
- 不要生成字幕或额外文字

首帧画面描述：
{image_prompt}

镜头终态信息：
{video_prompt}

需要重点保持：
角色一致性、伤口位置、服装连续性、光线方向、景别稳定
"""


def _load_api_key() -> str:
    key = os.environ.get("YUNWU_API_KEY")
    if not key:
        raise RuntimeError("请在 .env 中配置 YUNWU_API_KEY")
    return key.strip()


def build_tail_prompt(
    image_prompt: str,
    video_prompt: str,
    asset_names: list[str],
) -> str:
    """构建尾帧生成用的文本 prompt。"""
    base = DEFAULT_TAIL_TEMPLATE.format(
        image_prompt=image_prompt,
        video_prompt=video_prompt,
    )
    if asset_names:
        if len(asset_names) == 1:
            base += f"\n\n图一为首帧图，图二为{asset_names[0]}资产。"
        else:
            base += f"\n\n图一为首帧图，图二为{asset_names[0]}资产，图三为{asset_names[1]}资产。"
    else:
        base += "\n\n图一为首帧图。"
    return base


def generate_tail_frame(
    first_frame_path: Path,
    image_prompt: str,
    video_prompt: str,
    asset_paths: list[Path],
    *,
    assets_dir: Path | None = None,
    model: str = "gemini-3.1-flash-image-preview",
    image_size: str = "2K",
) -> bytes:
    """
    生成尾帧图。

    Returns:
        生成的图片二进制
    """
    api_key = _load_api_key()
    first_b64 = read_image_as_base64(first_frame_path)
    asset_b64_list = [read_image_as_base64(p) for p in asset_paths]
    asset_names = [p.stem for p in asset_paths]
    text = build_tail_prompt(image_prompt, video_prompt, asset_names)
    endpoint = f"{YUNWU_BASE}/{model}:generateContent"
    return call_yunwu(
        api_key,
        text,
        first_b64,
        asset_b64_list,
        endpoint=endpoint,
        aspect_ratio="9:16",
        image_size=image_size,
    )


def regenerate_first_frame(
    first_frame_path: Path,
    image_prompt: str,
    asset_paths: list[Path],
    *,
    model: str = "gemini-3.1-flash-image-preview",
    image_size: str = "2K",
) -> bytes:
    """
    单帧重生：基于首帧参考 + 资产 + 新 prompt 生成新首帧。

    Returns:
        生成的图片二进制
    """
    # 使用与尾帧类似的模板，但强调「重新绘制首帧」
    template = """请基于提供的首帧参考图，按照新的描述重新生成该镜头的首帧画面。

要求：
- 严格遵循下面的「新画面描述」
- 保持与参考图一致的角色身份、服装、道具、场景风格
- 若提供了资产图，将其特征融入画面
- 不要生成字幕或额外文字

新画面描述：
{image_prompt}

参考首帧已作为图一提供。
"""
    text = template.format(image_prompt=image_prompt)
    if asset_paths:
        names = [p.stem for p in asset_paths]
        if len(names) == 1:
            text += f"\n\n图一为首帧参考，图二为{names[0]}资产。"
        else:
            text += f"\n\n图一为首帧参考，图二为{names[0]}资产，图三为{names[1]}资产。"
    else:
        text += "\n\n图一为首帧参考。"

    api_key = _load_api_key()
    first_b64 = read_image_as_base64(first_frame_path)
    asset_b64_list = [read_image_as_base64(p) for p in asset_paths]
    endpoint = f"{YUNWU_BASE}/{model}:generateContent"
    return call_yunwu(
        api_key,
        text,
        first_b64,
        asset_b64_list,
        endpoint=endpoint,
        aspect_ratio="9:16",
        image_size=image_size,
    )
