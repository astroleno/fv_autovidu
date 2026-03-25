# -*- coding: utf-8 -*-
"""
应用配置：从 .env 和环境变量读取

路径解析策略：
- **PyInstaller 冻结模式**：用户可编辑文件（.env、data/）位于 exe 所在目录，
  通过 launcher.py 设置的 FV_STUDIO_EXE_DIR 环境变量获取。
- **开发模式**：根据 __file__ 向上回溯到项目根目录。
"""

import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# 项目根目录：区分冻结模式与开发模式
# ---------------------------------------------------------------------------
if getattr(sys, "frozen", False):
    # 冻结模式：.env / data/ 应放在 exe 同级目录下，由用户自行维护
    _PROJECT_ROOT = Path(
        os.environ.get("FV_STUDIO_EXE_DIR", str(Path(sys.executable).parent))
    )
else:
    # 开发模式：config.py 位于 web/server/，向上两级即项目根
    _PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# ---------------------------------------------------------------------------
# 加载 .env（python-dotenv 可选依赖）
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv

    _env_file = _PROJECT_ROOT / ".env"
    load_dotenv(_env_file)
except ImportError:
    pass

# ---------------------------------------------------------------------------
# 数据根目录（默认项目根下的 data/）
# ---------------------------------------------------------------------------
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
