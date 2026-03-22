# -*- coding: utf-8 -*-
"""
应用配置：从 .env 和环境变量读取
"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    # 加载项目根目录的 .env（web/server 上级两级）
    _root = Path(__file__).resolve().parent.parent.parent
    load_dotenv(_root / ".env")
except ImportError:
    pass

# 数据根目录（默认项目根下的 data/）
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_DATA_ENV = os.environ.get("DATA_ROOT", "data")
DATA_ROOT = Path(_DATA_ENV) if Path(_DATA_ENV).is_absolute() else _PROJECT_ROOT / _DATA_ENV

# 后端端口
WEB_PORT = int(os.environ.get("WEB_PORT", "8000"))

# Feeling 平台
FEELING_API_BASE = os.environ.get("FEELING_API_BASE", "")
FEELING_PHONE = os.environ.get("FEELING_PHONE", "")
FEELING_PASSWORD = os.environ.get("FEELING_PASSWORD", "")

# Vidu
VIDU_API_KEY = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY", "")

# Yunwu
YUNWU_API_KEY = os.environ.get("YUNWU_API_KEY", "")

# ElevenLabs（配音；亦可通过环境变量直接读取，见 services/elevenlabs_service）
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY") or os.environ.get(
    "ELEVENLABS_KEY", ""
)
ELEVENLABS_BASE = os.environ.get("ELEVENLABS_BASE", "https://api.elevenlabs.io")
