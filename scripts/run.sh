#!/usr/bin/env bash
# 一键执行：裁剪分镜 → 批量 i2v 提交
#
# 使用前：
#   1. cp .env.example .env
#   2. 在 .env 中填入 VIDU_API_KEY
#   3. pip install -r requirements.txt（本机 Python，不使用仓库 .venv）

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
# shellcheck source=python_exec.sh
source "${ROOT}/scripts/python_exec.sh"

echo "=== 1. 裁剪 grid 为单格 ==="
"${FV_PYTHON}" scripts/crop/crop_grid.py

echo ""
echo "=== 2. 批量 i2v 提交 ==="
"${FV_PYTHON}" scripts/i2v/batch.py

echo ""
echo "完成。视频生成后可通过轮询脚本获取。"
