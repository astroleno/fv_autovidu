#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证 yunwu「systemInstruction + user」与生产代码 `yunwu_service` 一致。

- 从项目根加载 .env 中的 YUNWU_API_KEY（不在终端打印密钥）。
- 使用与 generate_tail_frame 相同的 TAIL_SYSTEM_INSTRUCTION + build_tail_user_text + call_yunwu。
- 使用 1x1 最小 PNG 作为首帧，降低流量。

用法：
  python scripts/test_yunwu_system_user.py

退出码：0 成功；2 未配置 Key；1 API 失败。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent

from dotenv import load_dotenv

load_dotenv(_PROJECT_ROOT / ".env")

# 确保可 import web.server 与 src
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.yunwu.client import call_yunwu
from web.server.services.yunwu_service import (
    TAIL_SYSTEM_INSTRUCTION,
    build_tail_user_text,
)

# 1x1 透明 PNG（与历史连通性测试一致）
_MIN_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def main() -> int:
    key = os.environ.get("YUNWU_API_KEY", "").strip()
    if not key:
        print("未配置 YUNWU_API_KEY，请在项目根 .env 中设置。", file=sys.stderr)
        return 2

    user_text = build_tail_user_text(
        image_prompt="测试：室内一角，柔和光线。",
        video_prompt="测试：镜头结束时人物视线落向画外。",
        asset_names=[],
    )

    print("调用参数：systemInstruction（TAIL_SYSTEM_INSTRUCTION）+ user 文本 + 首帧图")
    print("user 文本预览（前 200 字）：")
    print(user_text[:200].replace("\n", " ") + ("…" if len(user_text) > 200 else ""))

    try:
        raw = call_yunwu(
            key,
            user_text,
            ("image/png", _MIN_PNG_B64),
            [],
            system_instruction=TAIL_SYSTEM_INSTRUCTION,
            aspect_ratio="9:16",
            image_size="2K",
        )
    except Exception as e:
        resp = getattr(e, "response", None)
        snippet = ""
        if resp is not None:
            try:
                snippet = resp.text[:600]
            except Exception:
                snippet = ""
        print(f"失败: {type(e).__name__}: {e}", file=sys.stderr)
        if snippet:
            print(f"响应片段: {snippet}", file=sys.stderr)
        return 1

    print(f"成功: 返回图片字节数 = {len(raw)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
