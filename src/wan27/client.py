# -*- coding: utf-8 -*-
"""
DashScope 万相 2.7 **异步**图像生成 HTTP 客户端（requests）。

异步接口路径（与官方文档一致）：
  POST {base}/services/aigc/image-generation/generation
  Header: X-DashScope-Async: enable
查询：
  GET {base}/tasks/{task_id}

同步多模态路径为 multimodal-generation，与本模块无关；组图批量走 image-generation 异步。
"""

from __future__ import annotations

import os
import time
from typing import Any

import requests

from src.utils.retry import run_with_http_retry

# 异步创建任务相对路径（北京 / 新加坡仅 base 不同）
_ASYNC_GENERATION_PATH = "/services/aigc/image-generation/generation"


def resolve_base_url() -> str:
    """
    解析 DashScope OpenAPI Base（不含尾斜杠）。

    优先级：
    1. 环境变量 ``DASHSCOPE_BASE_URL``：完整前缀，如 ``https://dashscope.aliyuncs.com/api/v1``
    2. ``DASHSCOPE_REGION``：含 ``intl`` / ``sg`` / ``singapore``（大小写不敏感）→ 新加坡
    3. 默认北京 ``https://dashscope.aliyuncs.com/api/v1``
    """
    explicit = (os.environ.get("DASHSCOPE_BASE_URL") or "").strip().rstrip("/")
    if explicit:
        return explicit
    region = (os.environ.get("DASHSCOPE_REGION") or "").strip().lower()
    if region and any(
        x in region for x in ("intl", "singapore", "sg")
    ):
        return "https://dashscope-intl.aliyuncs.com/api/v1"
    return "https://dashscope.aliyuncs.com/api/v1"


def extract_image_urls_from_task_payload(data: dict[str, Any]) -> list[str]:
    """
    从任务查询或同步响应 JSON 中抽取生成图 URL 列表。

    结构：``output.choices[0].message.content`` 内 ``type == "image"`` 的项取其 ``image`` 字段。
    """
    out: list[str] = []
    output = data.get("output")
    if not isinstance(output, dict):
        return out
    choices = output.get("choices")
    if not choices or not isinstance(choices, list):
        return out
    first = choices[0]
    if not isinstance(first, dict):
        return out
    msg = first.get("message")
    if not isinstance(msg, dict):
        return out
    content = msg.get("content")
    if not isinstance(content, list):
        return out
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "image":
            continue
        url = item.get("image")
        if isinstance(url, str) and url.strip():
            out.append(url.strip())
    return out


class Wan27DashScopeClient:
    """
    可注入 ``requests.Session`` 的轻量客户端，便于单元测试 Mock。

    Args:
        api_key: DashScope API Key（Bearer）。
        base_url: OpenAPI v1 根路径，默认 ``resolve_base_url()``。
        session: 可选共享 Session；默认新建。
    """

    def __init__(
        self,
        api_key: str,
        base_url: str | None = None,
        session: requests.Session | None = None,
    ) -> None:
        self._api_key = api_key
        self._base = (base_url or resolve_base_url()).rstrip("/")
        self._session = session if session is not None else requests.Session()

    @property
    def base_url(self) -> str:
        return self._base

    def _headers_async_post(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }

    def _headers_get(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
        }

    def create_async_task(self, body: dict[str, Any]) -> str:
        """
        创建异步任务，返回 ``task_id``。

        Raises:
            RuntimeError: 顶层 ``code``/``message`` 或缺少 ``output.task_id``。
        """
        url = f"{self._base}{_ASYNC_GENERATION_PATH}"
        resp = self._session.post(
            url,
            headers=self._headers_async_post(),
            json=body,
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data.get("code"), str) and data.get("code"):
            raise RuntimeError(
                data.get("message") or data.get("code") or "DashScope create task error"
            )
        output = data.get("output")
        if not isinstance(output, dict):
            raise RuntimeError("Invalid create response: missing output")
        tid = output.get("task_id")
        if not isinstance(tid, str) or not tid.strip():
            raise RuntimeError("Invalid create response: missing output.task_id")
        return tid.strip()

    def fetch_task(self, task_id: str) -> dict[str, Any]:
        """
        GET 任务状态；HTTP 层使用 ``run_with_http_retry``（429 / 5xx / RequestException）。
        """
        url = f"{self._base}/tasks/{task_id}"

        def _do() -> dict[str, Any]:
            r = self._session.get(
                url,
                headers=self._headers_get(),
                timeout=120,
            )
            r.raise_for_status()
            return r.json()

        return run_with_http_retry(_do)

    def poll_until_terminal(
        self,
        task_id: str,
        *,
        interval_sec: float = 3.0,
        timeout_sec: float = 1200.0,
    ) -> dict[str, Any]:
        """
        轮询直至 ``output.task_status`` 为终态。

        终态：SUCCEEDED、FAILED、CANCELED、UNKNOWN — 返回**整段** JSON（与测试、下游解析一致）。

        Raises:
            TimeoutError: 超出 ``timeout_sec``。
        """
        deadline = time.monotonic() + float(timeout_sec)
        while True:
            data = self.fetch_task(task_id)
            output = data.get("output")
            status = ""
            if isinstance(output, dict):
                raw = output.get("task_status")
                if isinstance(raw, str):
                    status = raw.upper()
            if status in ("SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"):
                return data
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Wan27 task {task_id!r} not terminal within {timeout_sec}s"
                )
            time.sleep(max(0.0, float(interval_sec)))
