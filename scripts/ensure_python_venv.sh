#!/usr/bin/env bash
# =============================================================================
# 确保项目根目录存在可用的 .venv，且已安装 requirements（至少能 import uvicorn）。
#
# 调用场景：
# - package.json 的 postinstall（pnpm install 后自动执行）
# - ensure_dev_env.sh（pnpm dev 前）
#
# 无系统 python3 时（如部分 CI）仅打印提示并以 0 退出，不阻断 install。
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ensure_python_venv] 未检测到 python3，跳过虚拟环境。需要后端时请安装 Python 3 后执行: pnpm run setup:python" >&2
  exit 0
fi

VENV_PY="${ROOT}/.venv/bin/python"
if [[ ! -x "${VENV_PY}" ]] || ! "${VENV_PY}" -c "import uvicorn" 2>/dev/null; then
  bash "${ROOT}/scripts/setup_python_venv.sh"
fi
