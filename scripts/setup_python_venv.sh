#!/usr/bin/env bash
# =============================================================================
# 在项目根目录创建 Python 虚拟环境（.venv/）并安装 requirements.txt。
#
# 用途：
# - 与系统 Python（含 Xcode CLT 旧 pip）解耦，无需 --user / --break-system-packages
# - 开发机统一用 .venv/bin/python 跑 FastAPI / 脚本
#
# 用法：
#   bash scripts/setup_python_venv.sh
#   或 pnpm run setup:python
#
# 说明：若你修改了 requirements.txt，请再执行本脚本一次以同步依赖。
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VENV_DIR="${ROOT}/.venv"
VENV_PY="${VENV_DIR}/bin/python"
VENV_PIP="${VENV_DIR}/bin/pip"

# ---------------------------------------------------------------------------
# 1) 若无虚拟环境或解释器不可用，则用当前 PATH 中的 python3 创建 venv
# ---------------------------------------------------------------------------
if [[ ! -x "${VENV_PY}" ]]; then
  echo "[setup_python_venv] 创建虚拟环境: ${VENV_DIR}"
  python3 -m venv "${VENV_DIR}"
fi

# ---------------------------------------------------------------------------
# 2) 在 venv 内安装依赖（隔离环境，pip 可写 site-packages，无 PEP668 困扰）
# ---------------------------------------------------------------------------
echo "[setup_python_venv] 安装依赖: requirements.txt"
"${VENV_PIP}" install -r "${ROOT}/requirements.txt"

echo "[setup_python_venv] 完成。解释器: ${VENV_PY}"
