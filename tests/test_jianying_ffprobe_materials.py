# -*- coding: utf-8 -*-
"""
jianying_ffprobe_materials：对 ffprobe 解析逻辑的单元测试（打桩 _ffprobe_json，无需真实媒体文件）。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

_REPO = Path(__file__).resolve().parent.parent
_SERVER = _REPO / "web" / "server"
if str(_SERVER) not in sys.path:
    sys.path.insert(0, str(_SERVER))


class TestProbeVideoMaterialFields(unittest.TestCase):
    """验证 ``probe_video_material_fields`` 在常见 ffprobe JSON 下的分支。"""

    def test_h264_mp4_returns_video_and_microseconds(self) -> None:
        from services.jianying_ffprobe_materials import probe_video_material_fields

        fake = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1080,
                    "height": 1920,
                    "duration": "3.0",
                }
            ],
            "format": {},
        }
        with patch("services.jianying_ffprobe_materials._ffprobe_json", return_value=fake):
            w, h, dur_us, mtype = probe_video_material_fields(Path("/fake/x.mp4"))
        self.assertEqual((w, h, mtype), (1080, 1920, "video"))
        self.assertEqual(dur_us, 3_000_000)

    def test_static_png_uses_photo_placeholder(self) -> None:
        from services.jianying_ffprobe_materials import probe_video_material_fields

        fake = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "png",
                    "width": 512,
                    "height": 512,
                }
            ],
            "format": {},
        }
        with patch("services.jianying_ffprobe_materials._ffprobe_json", return_value=fake):
            w, h, dur_us, mtype = probe_video_material_fields(Path("/fake/x.png"))
        self.assertEqual(mtype, "photo")
        self.assertEqual((w, h), (512, 512))
        self.assertGreater(dur_us, 1_000_000_000)


if __name__ == "__main__":
    unittest.main()
