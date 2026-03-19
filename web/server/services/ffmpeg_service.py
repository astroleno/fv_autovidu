# -*- coding: utf-8 -*-
"""
FFmpeg 服务：视频拼接

将选定的视频按顺序拼接为粗剪输出。
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def concat_videos(
    video_paths: list[Path],
    output_path: Path,
) -> Path:
    """
    使用 FFmpeg concat demuxer 拼接多个视频。

    Args:
        video_paths: 视频文件路径列表（按顺序）
        output_path: 输出路径

    Returns:
        输出文件路径
    """
    if not video_paths:
        raise ValueError("video_paths 不能为空")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # 生成 concat 列表文件
    list_path = output_path.with_suffix(".txt")
    with open(list_path, "w", encoding="utf-8") as f:
        for p in video_paths:
            p = Path(p).resolve()
            f.write(f"file '{p}'\n")
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(list_path),
        "-c", "copy",
        str(output_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    list_path.unlink(missing_ok=True)
    return output_path
