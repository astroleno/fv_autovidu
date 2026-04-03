# -*- coding: utf-8 -*-
"""
万相 Wan 2.7（DashScope）HTTP 客户端包。

与 FastAPI / 业务层解耦：仅负责地域 Base URL、异步任务创建与轮询、
从任务结果 JSON 中抽取图片 URL。供 `web/server/services/wan27_batch_service` 调用。
"""

from __future__ import annotations

from src.wan27.client import (
    Wan27DashScopeClient,
    extract_image_urls_from_task_payload,
    resolve_base_url,
)

__all__ = [
    "Wan27DashScopeClient",
    "extract_image_urls_from_task_payload",
    "resolve_base_url",
]
