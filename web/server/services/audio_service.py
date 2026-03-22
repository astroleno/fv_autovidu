# -*- coding: utf-8 -*-
"""
音频与媒体探测服务（FFmpeg / ffprobe）

用于：
- 从视频提取 WAV（ElevenLabs STS 前置）
- 探测容器时长（剪映时间轴与粗剪拼接避免仅用 shot.duration 漂移）
- 检测是否存在音轨（STS 前置校验）

说明：依赖系统已安装的 ffmpeg/ffprobe，与现有 ffmpeg_service 一致。
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path


def probe_duration_sec(file_path: Path) -> float | None:
    """
    使用 ffprobe 读取媒体文件时长（秒）。

    Args:
        file_path: 视频或音频文件绝对路径

    Returns:
        时长秒数；失败时返回 None
    """
    if not file_path or not file_path.is_file():
        return None
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(file_path.resolve()),
    ]
    try:
        proc = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
        data = json.loads(proc.stdout or "{}")
        dur = data.get("format", {}).get("duration")
        if dur is None:
            return None
        return float(dur)
    except (subprocess.CalledProcessError, json.JSONDecodeError, ValueError, OSError):
        return None


def has_audio_stream(file_path: Path) -> bool:
    """
    检测文件是否包含至少一条音频流。

    Args:
        file_path: 媒体文件路径

    Returns:
        存在音轨为 True；无法判断或失败时返回 False
    """
    if not file_path or not file_path.is_file():
        return False
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        str(file_path.resolve()),
    ]
    try:
        proc = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
        return bool((proc.stdout or "").strip())
    except subprocess.CalledProcessError:
        return False


def extract_audio_from_video(
    video_path: Path,
    output_wav: Path,
) -> Path:
    """
    从视频提取单声道 44.1kHz 16-bit PCM WAV（供 ElevenLabs 上传）。

    Args:
        video_path: 输入视频
        output_wav: 输出 WAV 路径

    Returns:
        输出文件路径

    Raises:
        subprocess.CalledProcessError: ffmpeg 执行失败
    """
    output_wav.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path.resolve()),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "44100",
        "-ac",
        "1",
        str(output_wav.resolve()),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return output_wav
