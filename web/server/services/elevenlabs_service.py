# -*- coding: utf-8 -*-
"""
ElevenLabs REST API 封装（STS / TTS / 音色列表）

环境变量：
- ELEVENLABS_API_KEY 或 ELEVENLABS_KEY（与参考包一致）
- ELEVENLABS_BASE（可选，默认官方端点）
"""

from __future__ import annotations

import os
from typing import Any

import requests


def _api_key() -> str:
    return (
        os.environ.get("ELEVENLABS_API_KEY")
        or os.environ.get("ELEVENLABS_KEY")
        or ""
    ).strip()


def _base_url() -> str:
    return (os.environ.get("ELEVENLABS_BASE") or "https://api.elevenlabs.io").rstrip("/")


def is_configured() -> bool:
    """是否已配置 API Key。"""
    return bool(_api_key())


def speech_to_speech(
    voice_id: str,
    audio_data: bytes,
    *,
    model_id: str = "eleven_multilingual_sts_v2",
    remove_background_noise: bool = True,
    timeout: int = 180,
) -> tuple[bytes, str]:
    """
    Speech-to-Speech：上传源音频，返回目标音色音频字节。

    Returns:
        (audio_bytes, content_type)
    """
    key = _api_key()
    if not key:
        raise ValueError("未配置 ELEVENLABS_API_KEY")
    url = f"{_base_url()}/v1/speech-to-speech/{voice_id}"
    # multipart：字段需与官方 API 一致
    data = {
        "model_id": model_id,
        "remove_background_noise": str(remove_background_noise).lower(),
    }
    files = {"audio": ("source.wav", audio_data, "audio/wav")}
    resp = requests.post(
        url,
        headers={"xi-api-key": key},
        data=data,
        files=files,
        timeout=timeout,
    )
    resp.raise_for_status()
    ct = resp.headers.get("content-type", "audio/mpeg")
    return resp.content, ct


def text_to_speech(
    voice_id: str,
    text: str,
    *,
    model_id: str = "eleven_multilingual_v2",
    timeout: int = 120,
) -> tuple[bytes, str]:
    """文本转语音。"""
    key = _api_key()
    if not key:
        raise ValueError("未配置 ELEVENLABS_API_KEY")
    url = f"{_base_url()}/v1/text-to-speech/{voice_id}"
    resp = requests.post(
        url,
        headers={
            "xi-api-key": key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        json={
            "text": text,
            "model_id": model_id,
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    ct = resp.headers.get("content-type", "audio/mpeg")
    return resp.content, ct


def list_voices() -> list[dict[str, Any]]:
    """列出账号下可用音色（原始 API 结构）。"""
    key = _api_key()
    if not key:
        raise ValueError("未配置 ELEVENLABS_API_KEY")
    url = f"{_base_url()}/v1/voices"
    resp = requests.get(url, headers={"xi-api-key": key}, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    return list(data.get("voices") or [])
