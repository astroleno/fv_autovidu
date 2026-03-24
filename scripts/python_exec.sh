#!/usr/bin/env bash
# =============================================================================
# 供其它 shell 脚本 source：解析项目根目录与「当前 Python」可执行路径。
#
# 仓库不依赖项目内 .venv；依赖见项目根 requirements.txt。
#
# 优先级（避免 macOS 上「已 conda activate 但 python3 仍指向 /usr/bin」的常见问题）：
#   1) 环境变量 FV_PYTHON（若已设置且可执行）
#   2) 若已激活 conda：CONDA_PREFIX/bin/python
#   3) 若已激活 venv/virtualenv：VIRTUAL_ENV/bin/python
#   4) PATH 上的 python3
# 导出：FV_ROOT、FV_PYTHON
# =============================================================================
FV_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -n "${FV_PYTHON:-}" ]] && [[ -x "${FV_PYTHON}" ]]; then
  :
elif [[ -n "${CONDA_PREFIX:-}" ]] && [[ -x "${CONDA_PREFIX}/bin/python" ]]; then
  # conda activate 后应优先用当前环境里的 Python（含已 pip install 的包）
  FV_PYTHON="${CONDA_PREFIX}/bin/python"
elif [[ -n "${VIRTUAL_ENV:-}" ]] && [[ -x "${VIRTUAL_ENV}/bin/python" ]]; then
  FV_PYTHON="${VIRTUAL_ENV}/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  FV_PYTHON="$(command -v python3)"
else
  FV_PYTHON="python3"
fi
