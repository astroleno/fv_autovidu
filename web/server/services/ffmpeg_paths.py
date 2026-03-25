# -*- coding: utf-8 -*-
"""
FFmpeg / ffprobe 可执行文件路径解析（模块化、单点维护）

设计目标
--------
- **开发环境**：与现有行为一致，优先使用系统 PATH 中的 ``ffmpeg`` / ``ffprobe``，
  便于 macOS/Linux/Windows 本机调试。
- **PyInstaller 冻结（Windows 分发）**：使用随 exe 一并打入 ``_internal/ffmpeg/bin/``
  的官方构建（由 CI 下载 BtbN win64 GPL 构建并复制到 ``vendor/ffmpeg-windows`` 再打包），
  测试同学**无需**单独安装 FFmpeg。

目录约定（打包后）
-----------------
``sys._MEIPASS/ffmpeg/bin/ffmpeg.exe``、``ffprobe.exe``

若冻结模式下该路径不存在，说明打包流程遗漏，应报错而非静默退回 PATH，
避免「以为自带 ffmpeg、实际未带上」的隐性故障。
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path
from typing import Optional


def _internal_ffmpeg_bin() -> Optional[Path]:
    """
    返回冻结模式下捆绑的 ``bin`` 目录；非冻结返回 None。

    PyInstaller --onedir：资源位于 ``sys._MEIPASS`` 下，
    与 ``fv_studio.spec`` 中 ``datas`` 目标目录 ``ffmpeg`` 对齐。
    """
    if not getattr(sys, "frozen", False):
        return None
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return None
    return Path(meipass) / "ffmpeg" / "bin"


def get_ffmpeg_exe() -> str:
    """
    返回用于 ``subprocess`` 的 ffmpeg 可执行文件路径字符串。

    Returns:
        绝对路径（捆绑或 which）或退化为 ``"ffmpeg"``（开发机未装时仍与旧行为一致）。

    Raises:
        RuntimeError: 冻结模式下捆绑目录存在但缺少 ``ffmpeg.exe``。
    """
    b = _internal_ffmpeg_bin()
    if b is not None:
        exe = b / "ffmpeg.exe"
        if exe.is_file():
            return str(exe)
        raise RuntimeError(
            "FV Studio 内置 FFmpeg 缺失（ffmpeg.exe）。请重新下载官方构建包或联系开发者。"
        )
    w = shutil.which("ffmpeg")
    return w if w else "ffmpeg"


def get_ffprobe_exe() -> str:
    """
    返回用于 ``subprocess`` 的 ffprobe 可执行文件路径字符串。

    Raises:
        RuntimeError: 冻结模式下捆绑目录存在但缺少 ``ffprobe.exe``。
    """
    b = _internal_ffmpeg_bin()
    if b is not None:
        exe = b / "ffprobe.exe"
        if exe.is_file():
            return str(exe)
        raise RuntimeError(
            "FV Studio 内置 ffprobe 缺失（ffprobe.exe）。请重新下载官方构建包或联系开发者。"
        )
    w = shutil.which("ffprobe")
    return w if w else "ffprobe"


def describe_ffmpeg_source() -> str:
    """
    简短说明当前 ffmpeg 来源，便于日志或排障（不含敏感路径细节）。
    """
    if _internal_ffmpeg_bin() is not None:
        return "bundled(_internal/ffmpeg/bin)"
    return "PATH"
