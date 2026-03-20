# -*- coding: utf-8 -*-
"""
yunwu 服务：尾帧生成、单帧重生

封装 src.yunwu.client 和提示词构建，供 generate 路由调用。

提示词策略（唯一）：
- Gemini 标准「systemInstruction + user contents」：固定规则写入 systemInstruction，
  每镜头变量（画面描述、终态、图序说明）写入 user 文本，与首帧/资产图同一条 user 消息的 parts。
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

# ---------------------------------------------------------------------------
# 尾帧：system 侧（全剧通用、不随镜头变的规则）
# ---------------------------------------------------------------------------
TAIL_SYSTEM_INSTRUCTION = """你是影视分镜与静帧生成助手。用户将在每条请求中提供「本镜头的首帧画面描述、镜头终态信息」以及参考图（首帧 + 可选资产图）。

你的任务：基于用户给出的首帧参考图，生成同一镜头结束瞬间的静态尾帧。

要求：
- 保持与首帧一致的角色身份、服装、发型、道具、场景和时间氛围
- 输出必须是镜头结束瞬间的单张静态画面，不要表现运动轨迹
- 补足尾帧中应该清晰可见、但首帧中不完整或未出现的关键资产
- 保持构图、镜头语言和光线连续
- 不要生成字幕或额外文字

需要重点保持：
角色一致性、伤口位置、服装连续性、光线方向、景别稳定
"""


def _append_tail_asset_figure_lines(base: str, asset_names: list[str]) -> str:
    """在尾帧 user 文本末尾追加图一/图二/图三说明。"""
    if asset_names:
        if len(asset_names) == 1:
            return base + f"\n\n图一为首帧图，图二为{asset_names[0]}资产。"
        return base + f"\n\n图一为首帧图，图二为{asset_names[0]}资产，图三为{asset_names[1]}资产。"
    return base + "\n\n图一为首帧图。"


def build_tail_user_text(
    image_prompt: str,
    video_prompt: str,
    asset_names: list[str],
) -> str:
    """
    尾帧：user 侧纯文本（不含 system 中的全局规则）。

    与首帧图、资产图一起作为同一条 user 消息的 parts（先 text 后 inline_data）。
    """
    body = f"""本镜头信息：

首帧画面描述：
{image_prompt}

镜头终态信息：
{video_prompt}
"""
    return _append_tail_asset_figure_lines(body.strip(), asset_names)


# ---------------------------------------------------------------------------
# 单帧重生：system + user
# ---------------------------------------------------------------------------
REGEN_FIRST_SYSTEM_INSTRUCTION = """你是影视分镜助手。用户会提供首帧参考图、可选资产图，以及一段「新画面描述」。

你的任务：按照用户的新描述重新生成该镜头的首帧画面。

要求：
- 严格遵循用户给出的新画面描述
- 保持与参考图一致的角色身份、服装、道具、场景风格
- 若用户提供了资产图，将其特征融入画面
- 不要生成字幕或额外文字

参考首帧将始终作为图一提供。
"""


def build_regen_user_text(image_prompt: str, asset_names: list[str]) -> str:
    """单帧重生：user 侧文本。"""
    body = f"""新画面描述：
{image_prompt}
"""
    if asset_names:
        if len(asset_names) == 1:
            body = body.rstrip() + f"\n\n图一为首帧参考，图二为{asset_names[0]}资产。"
        else:
            body = (
                body.rstrip()
                + f"\n\n图一为首帧参考，图二为{asset_names[0]}资产，图三为{asset_names[1]}资产。"
            )
    else:
        body = body.rstrip() + "\n\n图一为首帧参考。"
    return body


def _load_api_key() -> str:
    key = os.environ.get("YUNWU_API_KEY")
    if not key:
        raise RuntimeError("请在 .env 中配置 YUNWU_API_KEY")
    return key.strip()


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
    生成尾帧图（固定使用 systemInstruction + user 文本 + 参考图）。

    Returns:
        生成的图片二进制
    """
    api_key = _load_api_key()
    first_b64 = read_image_as_base64(first_frame_path)
    asset_b64_list = [read_image_as_base64(p) for p in asset_paths]
    asset_names = [p.stem for p in asset_paths]

    text = build_tail_user_text(image_prompt, video_prompt, asset_names)

    endpoint = f"{YUNWU_BASE}/{model}:generateContent"
    return call_yunwu(
        api_key,
        text,
        first_b64,
        asset_b64_list,
        endpoint=endpoint,
        aspect_ratio="9:16",
        image_size=image_size,
        system_instruction=TAIL_SYSTEM_INSTRUCTION,
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
    单帧重生：基于首帧参考 + 资产 + 新 prompt 生成新首帧（system + user）。

    Returns:
        生成的图片二进制
    """
    text = build_regen_user_text(image_prompt, [p.stem for p in asset_paths])

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
        system_instruction=REGEN_FIRST_SYSTEM_INSTRUCTION,
    )
