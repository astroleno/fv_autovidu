#!/usr/bin/env bash
# =============================================================================
# 检查「与 dev_api 相同的 Python」是否已安装后端依赖（至少能 import uvicorn）。
# 不创建虚拟环境；缺依赖时仅打印提示。
#
# 调用：package.json postinstall、ensure_dev_env.sh（pnpm dev 前）
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

# shellcheck source=python_exec.sh
source "${ROOT}/scripts/python_exec.sh"

if ! "${FV_PYTHON}" -c "import sys" 2>/dev/null; then
  echo "[ensure_python_deps] 无法执行 Python: ${FV_PYTHON}" >&2
  exit 0
fi

if "${FV_PYTHON}" -c "import uvicorn" 2>/dev/null; then
  echo "[ensure_python_deps] 当前 Python（${FV_PYTHON}）已具备后端依赖（uvicorn）。"
  exit 0
fi

echo "[ensure_python_deps] 当前 Python（${FV_PYTHON}）尚未安装后端依赖。" >&2
echo "  请在该解释器下执行: pip install -r requirements.txt" >&2
echo "  若使用 conda：先 conda activate 你的环境，再执行上述 pip（或 conda install -c conda-forge uvicorn 等）" >&2
exit 0
