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
    aspect_ratio: str = "9:16",
    end_frame_path: Path | None = None,
) -> dict:
    """
    提交图生视频任务。

    Args:
        image_path: 首帧图路径
        prompt: 视频描述
        end_frame_path: 可选，尾帧图（双帧模式请使用 submit_first_last_video）
        aspect_ratio: 画幅，如 9:16、16:9

    Returns:
        API 响应，含 task_id
    """
    client = _get_client()
    _ = end_frame_path  # 兼容旧签名；首尾帧请走 submit_first_last_video
    return client.img2video_from_file(
        image_path=image_path,
        prompt=prompt,
        model=model,
        duration=duration,
        resolution=resolution,
        aspect_ratio=aspect_ratio,
    )


def submit_first_last_video(
    first_frame_path: Path,
    end_frame_path: Path,
    prompt: str,
    *,
    model: str = "viduq3-turbo",
    duration: int = 5,
    resolution: str = "720p",
    aspect_ratio: str = "9:16",
) -> dict:
    """
    首尾帧双图生视频：将首帧、尾帧作为两张参考图调用 reference2video（非主体）。

    Vidu i2v 仅支持单图；首尾约束需走 reference2video_with_images。
    """
    client = _get_client()
    b64_first = client._image_to_base64(first_frame_path)
    b64_end = client._image_to_base64(end_frame_path)
    return client.reference2video_with_images(
        images=[b64_first, b64_end],
        prompt=prompt,
        model=model,
        duration=duration,
        resolution=resolution,
        aspect_ratio=aspect_ratio,
    )


def submit_reference_video(
    reference_images: list[Path],
    prompt: str,
    *,
    model: str = "viduq2-pro",
    duration: int = 5,
    resolution: str = "720p",
    aspect_ratio: str = "9:16",
    with_subjects: bool = False,
    voice_text: str | None = None,
) -> dict:
    """
    多参考图生视频（1~7 张）。

    with_subjects=False：非主体 reference2video，适用面更广。
    with_subjects=True：主体模式，可配合台词（需 voice 等，当前仅透传 dialogue）。
    """
    client = _get_client()
    if not 1 <= len(reference_images) <= 7:
        raise ValueError("参考图数量须在 1~7 张之间")
    if with_subjects:
        return client.reference2video_from_files(
            image_paths=reference_images,
            prompt=prompt,
            use_subjects=True,
            dialogue=voice_text,
            model=model,
            duration=duration,
            resolution=resolution,
            aspect_ratio=aspect_ratio,
        )
    b64_list = [client._image_to_base64(Path(p)) for p in reference_images]
    return client.reference2video_with_images(
        images=b64_list,
        prompt=prompt,
        model=model,
        duration=duration,
        resolution=resolution,
        aspect_ratio=aspect_ratio,
    )
