#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=python_exec.sh
source "${ROOT}/scripts/python_exec.sh"

# 依赖需已安装：pip install -r requirements.txt（见 scripts/ensure_python_deps.sh）
if ! "${FV_PYTHON}" -c "import uvicorn" 2>/dev/null; then
  echo "当前 Python（${FV_PYTHON}）未安装后端依赖。请执行: pip install -r requirements.txt" >&2
  echo "若使用 conda/pyenv，请先激活环境，或 export FV_PYTHON=该环境的 python 路径" >&2
  exit 1
fi

exec "${FV_PYTHON}" -m uvicorn web.server.main:app --reload --port 8000
