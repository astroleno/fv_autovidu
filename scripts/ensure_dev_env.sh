#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -d web/frontend/node_modules ]]; then
  pnpm --prefix web/frontend install
fi
if ! python3 -c "import uvicorn" 2>/dev/null; then
  # Homebrew Python 启用 PEP 668，仅 --user 仍会拒绝；需显式允许写入用户 site-packages
  python3 -m pip install --user --break-system-packages -r requirements.txt
fi
