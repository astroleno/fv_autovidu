# -*- coding: utf-8 -*-
"""
Vidu 服务：图生视频 (i2v)

封装 src.vidu.client，供 generate 路由调用。
"""

from __future__ import annotations

import os
from pathlib import Path

import sys
_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.vidu.client import ViduClient


def _get_client() -> ViduClient:
    key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not key:
        raise RuntimeError("请在 .env 中配置 VIDU_API_KEY")
    return ViduClient(api_key=key)


def submit_img2video(
    image_path: Path,
    prompt: str,
    *,
    model: str = "viduq2-pro-fast",
    duration: int = 5,
    resolution: str = "720p",
    end_frame_path: Path | None = None,
) -> dict:
    """
    提交图生视频任务。

    Args:
        image_path: 首帧图路径
        prompt: 视频描述
        end_frame_path: 可选，尾帧图（双帧模式需改用 reference2video，此处预留）

    Returns:
        API 响应，含 task_id
    """
    client = _get_client()
    # 当前 Vidu i2v 仅支持 1 张图，双帧模式暂不实现
    return client.img2video_from_file(
        image_path=image_path,
        prompt=prompt,
        model=model,
        duration=duration,
        resolution=resolution,
    )
