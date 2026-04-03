# -*- coding: utf-8 -*-
"""
万相 2.7 分镜批量组图：拼装 ``messages.content``、可选参考图 data URL、
异步创建任务、轮询、按 URL 下载 PNG 字节。

与 ``generate.py`` 解耦，便于单测 Mock ``Wan27DashScopeClient``。
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import requests

_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from models.schemas import Shot  # noqa: E402
from src.utils.retry import run_with_http_retry  # noqa: E402
from src.wan27.client import (  # noqa: E402
    Wan27DashScopeClient,
    extract_image_urls_from_task_payload,
)

# DashScope 文档：单条 text 不超过 5000 字符（我们整段 user 文本视为一条 text）
_MAX_TEXT_CHARS = 5000

# 每条镜头附带的画面描述过长时截断，避免挤爆总预算
_MAX_VISUAL_SNIPPET = 280


def _mime_for_suffix(suffix: str) -> str:
    s = suffix.lower()
    if s in (".jpg", ".jpeg"):
        return "image/jpeg"
    if s == ".png":
        return "image/png"
    if s == ".webp":
        return "image/webp"
    if s == ".bmp":
        return "image/bmp"
    return "image/png"


def image_file_to_data_url(path: Path) -> str:
    """
    读取本地图像为 ``data:{mime};base64,...``，供 ``content`` 中 ``image`` 字段使用。

    MIME 由后缀推断（jpeg/png/webp/bmp），与官方示例及 ``wan27-cli.mjs`` 一致。
    """
    raw = path.read_bytes()
    import base64

    b64 = base64.standard_b64encode(raw).decode("ascii")
    mime = _mime_for_suffix(path.suffix)
    return f"data:{mime};base64,{b64}"


def build_batch_prompt(
    ordered_shots: list[Shot],
    *,
    panel_count: int,
    aspect_ratio_hint: str,
    ref_path_stems: list[str] | None = None,
) -> str:
    """
    生成组图用长文本：张数、画幅、风格约束 + 按叙事顺序逐镜 ``imagePrompt`` / ``visualDescription``。

    Raises:
        ValueError: 总长度超过 5000（避免依赖服务端静默截断导致指令丢失）。
    """
    lines: list[str] = [
        f"本任务为电影感连续分镜组图，共 {panel_count} 张，画幅参考 {aspect_ratio_hint}。",
        "保持角色、场景、光线在同一叙事中连贯；不要生成画面内字幕或额外文字。",
        "按下列顺序逐张对应生成（第 1 张对应 Shot 1，以此类推）。",
    ]
    if ref_path_stems:
        ref_line = "参考图（与上传顺序一致）：" + "，".join(
            f"image{i + 1}={name}" for i, name in enumerate(ref_path_stems)
        )
        lines.append(ref_line)
    for s in ordered_shots:
        vis = (s.visualDescription or "").strip()
        if len(vis) > _MAX_VISUAL_SNIPPET:
            vis = vis[: _MAX_VISUAL_SNIPPET] + "…"
        block = f"Shot {s.shotNumber}：{s.imagePrompt.strip()}"
        if vis:
            block += f"\n画面补充：{vis}"
        lines.append(block)
    text = "\n\n".join(lines)
    if len(text) > _MAX_TEXT_CHARS:
        raise ValueError(
            f"万相组图提示词超过 {_MAX_TEXT_CHARS} 字符（当前 {len(text)}），请缩短各镜画面描述"
        )
    return text


def run_wan27_sequential_for_shots(
    *,
    api_key: str,
    base_url: str,
    model: str,
    size: str,
    ordered_shots: list[Shot],
    ref_asset_paths: list[Path],
    client: Wan27DashScopeClient | None = None,
    download_session: requests.Session | None = None,
) -> list[bytes]:
    """
    调用 DashScope 异步组图，按顺序返回与 ``ordered_shots`` 等长的 PNG 字节列表。

    ``content`` 顺序：**多图 data URL 在前**，**text 在最后**（与 CLI edit /  walkingdead 脚本一致）。

    Raises:
        RuntimeError: 任务非 SUCCEEDED、或返回图片张数与镜头数不一致。
        ValueError: 提示词超长（``build_batch_prompt``）。
    """
    if not ordered_shots:
        raise ValueError("ordered_shots 不能为空")

    c = client or Wan27DashScopeClient(api_key=api_key, base_url=base_url)
    ref_stems = [p.stem for p in ref_asset_paths] if ref_asset_paths else None
    prompt = build_batch_prompt(
        ordered_shots,
        panel_count=len(ordered_shots),
        aspect_ratio_hint=ordered_shots[0].aspectRatio or "9:16",
        ref_path_stems=ref_stems,
    )

    content: list[dict[str, Any]] = []
    for p in ref_asset_paths:
        content.append({"image": image_file_to_data_url(p)})
    content.append({"text": prompt})

    body: dict[str, Any] = {
        "model": model,
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": content,
                }
            ]
        },
        "parameters": {
            "enable_sequential": True,
            "n": len(ordered_shots),
            "watermark": False,
            "size": size,
        },
    }

    task_id = c.create_async_task(body)
    data = c.poll_until_terminal(task_id)
    output = data.get("output")
    if not isinstance(output, dict):
        raise RuntimeError("Wan27 响应缺少 output")
    st = str(output.get("task_status") or "").upper()
    if st != "SUCCEEDED":
        msg = data.get("message") or output.get("message") or st or "unknown"
        raise RuntimeError(f"万相任务未成功：{msg}")

    urls = extract_image_urls_from_task_payload(data)
    n = len(ordered_shots)
    if len(urls) != n:
        raise RuntimeError(f"期望 {n} 张，实际 {len(urls)} 张")

    sess = download_session if download_session is not None else requests.Session()
    out_bytes: list[bytes] = []

    for u in urls:

        def _download() -> bytes:
            r = sess.get(u, timeout=120)
            r.raise_for_status()
            return r.content

        out_bytes.append(run_with_http_retry(_download))

    return out_bytes
