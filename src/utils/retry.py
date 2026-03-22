# -*- coding: utf-8 -*-
"""
HTTP 调用统一重试（指数退避）

适用于 Vidu / Yunwu 等基于 requests 的同步调用：
- 对 429（限流）与 5xx 重试
- 对连接错误、超时等 requests.RequestException 重试

不适用于已消费流式 body 的请求；调用方应保证 `fn` 幂等或可安全重试。
"""

from __future__ import annotations

import time
from typing import Callable, TypeVar

import requests

T = TypeVar("T")


def run_with_http_retry(
    fn: Callable[[], T],
    *,
    max_attempts: int = 5,
    base_delay_sec: float = 1.0,
    max_delay_sec: float = 60.0,
) -> T:
    """
    执行 `fn` 并在可恢复错误时指数退避重试。

    Args:
        fn: 无参可调用，通常内部为 requests.post/get + raise_for_status()
        max_attempts: 最大尝试次数（含首次）
        base_delay_sec: 首次退避等待秒数
        max_delay_sec: 单次等待上限

    Returns:
        fn 的返回值

    Raises:
        最后一次尝试仍失败时抛出原异常
    """
    if max_attempts < 1:
        raise ValueError("max_attempts 必须 >= 1")

    delay = base_delay_sec

    for attempt in range(max_attempts):
        try:
            return fn()
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else 0
            if code == 429 or (500 <= code <= 599):
                if attempt + 1 >= max_attempts:
                    raise
                time.sleep(min(max_delay_sec, delay))
                delay = min(max_delay_sec, delay * 2)
                continue
            raise
        except requests.RequestException as e:
            if attempt + 1 >= max_attempts:
                raise
            time.sleep(min(max_delay_sec, delay))
            delay = min(max_delay_sec, delay * 2)
            continue
