#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -d web/frontend/node_modules ]]; then
  pnpm --prefix web/frontend install
fi

# 仅检查本机 python3 是否已装后端依赖（不创建虚拟环境）
bash "${ROOT}/scripts/ensure_python_deps.sh"
