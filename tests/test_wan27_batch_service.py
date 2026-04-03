# -*- coding: utf-8 -*-
"""万相批量组图服务：提示词长度、返回张数校验。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVER_DIR = _REPO_ROOT / "web" / "server"
for _p in (_REPO_ROOT, _SERVER_DIR):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from models.schemas import Shot  # noqa: E402
from services.wan27_batch_service import (  # noqa: E402
    build_batch_prompt,
    run_wan27_sequential_for_shots,
)


def _shot(n: int, image_prompt: str) -> Shot:
    return Shot(
        shotId=f"shot-{n}",
        shotNumber=n,
        imagePrompt=image_prompt,
        videoPrompt="vp",
        firstFrame=f"frames/S{n:03d}.png",
    )


class TestWan27BatchService(unittest.TestCase):
    def test_prompt_over_5000_raises_value_error(self) -> None:
        """单镜 imagePrompt 过长时总文本应触发 ValueError。"""
        long_text = "x" * 6000
        s = _shot(1, long_text)
        with self.assertRaises(ValueError) as ctx:
            build_batch_prompt([s], panel_count=1, aspect_ratio_hint="9:16")
        self.assertIn("5000", str(ctx.exception))

    def test_image_count_mismatch_raises_runtime_error(self) -> None:
        """API 返回 URL 数与镜头数不一致时不得落盘（服务层抛 RuntimeError）。"""
        shots = [_shot(1, "a"), _shot(2, "b")]
        fake = MagicMock()
        fake.create_async_task.return_value = "tid"
        fake.poll_until_terminal.return_value = {
            "output": {
                "task_status": "SUCCEEDED",
                "choices": [
                    {
                        "message": {
                            "content": [
                                {"type": "image", "image": "https://example.com/1.png"},
                            ]
                        }
                    }
                ],
            }
        }
        with self.assertRaises(RuntimeError) as ctx:
            run_wan27_sequential_for_shots(
                api_key="k",
                base_url="https://dashscope.aliyuncs.com/api/v1",
                model="wan2.7-image-pro",
                size="2K",
                ordered_shots=shots,
                ref_asset_paths=[],
                client=fake,
            )
        self.assertIn("期望 2 张", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
