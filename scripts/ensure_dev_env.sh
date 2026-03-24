#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -d web/frontend/node_modules ]]; then
  pnpm --prefix web/frontend install
fi

# 与 postinstall 共用：无 .venv 或依赖不全时创建/安装（见 scripts/ensure_python_venv.sh）
bash "${ROOT}/scripts/ensure_python_venv.sh"
