# -*- coding: utf-8 -*-
"""
多上下文引导：/api/contexts 须在陈旧或非法 X-FV-Context-Id 下仍可访问，
以便前端拿到 configured: false 并恢复全局 .env 模式。
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from services.context_service import (  # noqa: E402
    feeling_context_middleware_applies_to_path,
)


class TestFeelingContextMiddlewarePath(unittest.TestCase):
    def test_contexts_routes_skip_validation(self) -> None:
        self.assertFalse(feeling_context_middleware_applies_to_path("/api/contexts"))
        self.assertFalse(
            feeling_context_middleware_applies_to_path("/api/contexts?foo=1")
        )
        self.assertFalse(
            feeling_context_middleware_applies_to_path("/api/contexts/validate")
        )

    def test_other_routes_still_validated(self) -> None:
        self.assertTrue(feeling_context_middleware_applies_to_path("/api/episodes"))
        self.assertTrue(feeling_context_middleware_applies_to_path("/api/projects"))


if __name__ == "__main__":
    unittest.main()
