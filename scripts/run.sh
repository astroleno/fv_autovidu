#!/usr/bin/env bash
# 一键执行：裁剪分镜 → 批量 i2v 提交
#
# 使用前：
#   1. cp .env.example .env
#   2. 在 .env 中填入 VIDU_API_KEY
#   3. pnpm run setup:python（或 bash scripts/setup_python_venv.sh）

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
# 与后端一致：存在 .venv 时优先用虚拟环境里的 Python
# shellcheck source=python_venv_exec.sh
source "${ROOT}/scripts/python_venv_exec.sh"

echo "=== 1. 裁剪 grid 为单格 ==="
"${FV_PYTHON}" scripts/crop/crop_grid.py

echo ""
echo "=== 2. 批量 i2v 提交 ==="
"${FV_PYTHON}" scripts/i2v/batch.py

echo ""
echo "完成。视频生成后可通过轮询脚本获取。"
