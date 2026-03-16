#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完整 i2v 测试流程：提交 3×2 任务 → 轮询 → 下载
"""

import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = PROJECT_ROOT / "scripts"


def main():
    print("=" * 50)
    print("完整 i2v 测试：提交 → 轮询 → 下载")
    print("=" * 50)

    print("\n[1/3] 提交 3×2 i2v 任务...")
    r1 = subprocess.run(
        [sys.executable, str(SCRIPTS / "i2v" / "prompt_test.py"), "--group", "group_01", "--num", "3"],
        cwd=PROJECT_ROOT,
    )
    if r1.returncode != 0:
        sys.exit(r1.returncode)

    print("\n[2/3] 轮询任务直到完成...")
    records = PROJECT_ROOT / "output/frames/第2集_EP02_分镜包/group_01/i2v_test_records.json"
    r2 = subprocess.run(
        [sys.executable, str(SCRIPTS / "task" / "poll.py"), "--records", str(records), "--interval", "15"],
        cwd=PROJECT_ROOT,
    )
    if r2.returncode != 0:
        sys.exit(r2.returncode)

    print("\n[3/3] 下载视频到本地...")
    poll_results = PROJECT_ROOT / "output/frames/第2集_EP02_分镜包/group_01/poll_results.json"
    r3 = subprocess.run(
        [sys.executable, str(SCRIPTS / "task" / "download.py"), "--results", str(poll_results)],
        cwd=PROJECT_ROOT,
    )
    sys.exit(r3.returncode)


if __name__ == "__main__":
    main()
