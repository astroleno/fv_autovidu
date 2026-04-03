# -*- coding: utf-8 -*-
"""万相 DashScope 异步客户端单元测试（Mock HTTP）。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.wan27.client import (  # noqa: E402
    Wan27DashScopeClient,
    extract_image_urls_from_task_payload,
)


class TestWan27Client(unittest.TestCase):
    def test_poll_success_extracts_two_image_urls(self) -> None:
        create_resp = MagicMock()
        create_resp.raise_for_status = MagicMock()
        create_resp.json.return_value = {
            "output": {"task_id": "t1", "task_status": "PENDING"}
        }
        done_resp = MagicMock()
        done_resp.raise_for_status = MagicMock()
        done_resp.json.return_value = {
            "output": {
                "task_status": "SUCCEEDED",
                "choices": [
                    {
                        "message": {
                            "content": [
                                {"type": "image", "image": "https://a/1.png"},
                                {"type": "image", "image": "https://b/2.png"},
                            ]
                        }
                    }
                ],
            }
        }
        session = MagicMock()
        session.post.return_value = create_resp
        session.get.return_value = done_resp

        c = Wan27DashScopeClient(
            api_key="sk-test",
            base_url="https://dashscope.aliyuncs.com/api/v1",
            session=session,
        )
        body = {"model": "wan2.7-image-pro", "input": {"messages": []}, "parameters": {}}
        tid = c.create_async_task(body)
        self.assertEqual(tid, "t1")
        payload = c.poll_until_terminal("t1", interval_sec=0, timeout_sec=1)
        urls = extract_image_urls_from_task_payload(payload)
        self.assertEqual(urls, ["https://a/1.png", "https://b/2.png"])


if __name__ == "__main__":
    unittest.main()
