#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 开发约定：API 使用仓库 .venv 中的 Python（由 ensure_dev_env / setup_python_venv 创建）
VENV_PY="${ROOT}/.venv/bin/python"
if [[ ! -x "${VENV_PY}" ]]; then
  echo "未找到 ${VENV_PY}。请先执行: pnpm run setup:python 或 bash scripts/setup_python_venv.sh" >&2
  exit 1
fi

exec "${VENV_PY}" -m uvicorn web.server.main:app --reload --port 8000
