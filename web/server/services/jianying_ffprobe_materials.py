# -*- coding: utf-8 -*-
"""
剪映草稿：用 ffprobe 构造 pyJianYingDraft 的 VideoMaterial / AudioMaterial

背景：
- pyJianYingDraft 默认 ``VideoSegment(路径)`` / ``AudioSegment(路径)`` 会在内部调用
  ``VideoMaterial(path)`` / ``AudioMaterial(path)``，二者依赖 **pymediainfo + 系统 libmediainfo**。
- 本仓库已与粗剪、时长探测共用 **ffmpeg/ffprobe**，无需再要求用户安装 MediaInfo 动态库。

做法：
- 使用 **ffprobe -show_streams -show_format** 解析首条视频轨的宽高与时长；
- 使用 **services.audio_service.probe_duration_sec** 作为时长回退（与分镜导出逻辑一致）；
- 通过 ``VideoMaterial.__new__`` 手工填充字段，**不调用** 会触发 MediaInfo 的 ``__init__``。

与 pyJianYingDraft.local_materials 行为对齐：
- 视频素材 ``duration`` 为 **微秒**（与 ``time_util.SEC``、轨道 ``Timerange`` 一致）；
- 静态图（png / mjpeg / webp / bmp 等且无有效时长）使用与官方库相同的 **photo** 占位时长（约 3 小时，微秒）。
"""

from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path
from typing import Any, Literal

from services.audio_service import probe_duration_sec
from services.ffmpeg_paths import get_ffprobe_exe

# 与 pyJianYingDraft.local_materials.VideoMaterial 中单帧图片占位一致（微秒）
_PHOTO_PLACEHOLDER_DURATION_US = 10800000000


def _ffprobe_json(path: Path) -> dict[str, Any]:
    """
    对单个文件执行 ffprobe，返回解析后的 JSON 对象。

    Raises:
        FileNotFoundError: 路径不是文件
        ValueError: ffprobe 不可用或解析失败
    """
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(str(path))
    cmd = [
        get_ffprobe_exe(),
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(path),
    ]
    try:
        proc = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except FileNotFoundError as exc:
        raise ValueError(
            "未找到 ffprobe。若为本机开发请安装 FFmpeg；若为官方 Windows 包请反馈开发者检查打包。"
        ) from exc
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or exc.stdout or "").strip()
        raise ValueError(f"ffprobe 无法分析文件：{path}\n{err}") from exc
    try:
        return json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"ffprobe 输出非合法 JSON：{path}") from exc


def _parse_positive_float(raw: object) -> float | None:
    """从 ffprobe 字段解析正浮点数时长（秒）。"""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s.upper() == "N/A":
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v > 0 else None


def probe_video_material_fields(
    path: Path,
) -> tuple[int, int, int, Literal["video", "photo"]]:
    """
    用 ffprobe 得到与剪映 ``VideoMaterial`` 对齐的字段，避免 pymediainfo。

    Args:
        path: 本地视频或带视频轨的媒体文件（与 materials 目录下复制结果一致）

    Returns:
        (width, height, duration_microseconds, material_type)

    Raises:
        FileNotFoundError / ValueError: 无视频轨、无法解析宽高或时长等
    """
    data = _ffprobe_json(path)
    streams: list[dict[str, Any]] = list(data.get("streams") or [])
    fmt: dict[str, Any] = dict(data.get("format") or {})

    v_stream: dict[str, Any] | None = None
    for s in streams:
        if s.get("codec_type") == "video":
            v_stream = s
            break
    if not v_stream:
        raise ValueError(f"文件不包含视频轨，无法写入剪映视频轨：{path}")

    w = int(v_stream.get("width") or 0)
    h = int(v_stream.get("height") or 0)
    if w <= 0 or h <= 0:
        raise ValueError(f"ffprobe 未返回有效宽高：{path}")

    codec = (v_stream.get("codec_name") or "").lower()

    # 优先 stream 再 format，与常见 mp4/mov 行为一致
    duration_sec = _parse_positive_float(v_stream.get("duration"))
    if duration_sec is None:
        duration_sec = _parse_positive_float(fmt.get("duration"))
    if duration_sec is None:
        duration_sec = probe_duration_sec(path)

    # 静态图封装：无有效时长时用 photo + 官方占位时长（与 pyJianYingDraft 一致）
    static_codecs = ("png", "mjpeg", "webp", "bmp", "png_pipe")
    if codec in static_codecs and (duration_sec is None or duration_sec <= 0):
        return w, h, _PHOTO_PLACEHOLDER_DURATION_US, "photo"

    if duration_sec is None or duration_sec <= 0:
        raise ValueError(
            f"无法确定视频时长（请确认 ffprobe 与文件有效）：{path}"
        )

    duration_us = max(1, int(duration_sec * 1_000_000))
    return w, h, duration_us, "video"


def build_video_material_no_mediainfo(path: Path) -> Any:
    """
    构造 ``VideoMaterial`` 实例，不调用其 ``__init__``（从而不依赖 libmediainfo）。

    Args:
        path: materials 目录下的最终文件路径（已 copy2 后的绝对路径）

    Returns:
        pyJianYingDraft.local_materials.VideoMaterial 实例
    """
    from pyJianYingDraft.local_materials import CropSettings, VideoMaterial

    w, h, dur_us, mtype = probe_video_material_fields(path)
    vm = VideoMaterial.__new__(VideoMaterial)
    vm.crop_settings = CropSettings()
    vm.local_material_id = ""
    vm.material_id = uuid.uuid4().hex
    vm.material_name = path.name
    vm.path = str(path.resolve())
    vm.width = w
    vm.height = h
    vm.duration = dur_us
    vm.material_type = mtype
    return vm


def build_audio_material_no_mediainfo(path: Path) -> Any:
    """
    构造 ``AudioMaterial`` 实例，不调用其 ``__init__``（从而不依赖 libmediainfo）。

    Args:
        path: 配音音频文件（仅音频轨；与 pyJianYingDraft 要求一致）

    Returns:
        pyJianYingDraft.local_materials.AudioMaterial 实例
    """
    from pyJianYingDraft.local_materials import AudioMaterial

    dsec = probe_duration_sec(path)
    if dsec is None or dsec <= 0:
        raise ValueError(f"无法读取配音音频时长（ffprobe）：{path}")
    dur_us = max(1, int(dsec * 1_000_000))

    am = AudioMaterial.__new__(AudioMaterial)
    am.material_id = uuid.uuid4().hex
    am.material_name = path.name
    am.path = str(path.resolve())
    am.duration = dur_us
    return am
