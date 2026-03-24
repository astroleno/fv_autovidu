#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# 在项目根目录执行：按 requirements.txt 安装 Python 依赖（--user 安装到用户目录）。
#
# 将依赖安装到当前 python3 的 --user 目录（见脚本内 PEP 668 说明）。
# 也可直接使用: pip install -r requirements.txt
#
# 背景：
# - Homebrew 等环境的 Python 启用了 PEP 668（externally-managed-environment），
#   有时需要 pip 的 --break-system-packages 才能配合 --user 写入。
# - Apple Command Line Tools 自带的 python3 往往附带较旧的 pip，不认识该参数，
#   会报：no such option: --break-system-packages
#
# 策略：仅在当前 pip 的 help 中出现该选项时追加 --break-system-packages，否则省略。
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REQUIREMENTS="${1:-requirements.txt}"

# 若未显式传参，默认使用项目根目录的 requirements.txt
if [[ ! -f "$REQUIREMENTS" ]]; then
  echo "pip_install_requirements: 找不到文件: $REQUIREMENTS" >&2
  exit 1
fi

PIP_USER_FLAGS=(--user)

# 检测 pip 是否支持 --break-system-packages（pip 23+ 才有）
if python3 -m pip install --help 2>/dev/null | grep -q 'break-system-packages'; then
  PIP_USER_FLAGS+=(--break-system-packages)
fi

python3 -m pip install "${PIP_USER_FLAGS[@]}" -r "$REQUIREMENTS"
