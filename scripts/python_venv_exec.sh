#!/usr/bin/env bash
# =============================================================================
# 供其它 shell 脚本 source：解析项目根目录与「开发用 Python」路径。
#
# 约定：优先使用 ${ROOT}/.venv/bin/python；若不存在则回退到 python3（兼容未建 venv）。
# 导出变量：
#   FV_ROOT   — 仓库根目录绝对路径
#   FV_PYTHON — 应使用的 python 可执行文件路径
# =============================================================================
FV_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FV_VENV_PY="${FV_ROOT}/.venv/bin/python"

if [[ -x "${FV_VENV_PY}" ]]; then
  FV_PYTHON="${FV_VENV_PY}"
else
  FV_PYTHON="python3"
fi
