#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Episode 级测试一键流程：提交 → 轮询 → 下载

基于 output/frames/{episode}/prompt.md，对前 N 个 shot 做首帧+prompt1/prompt2 测试，
使用 viduq3-turbo + 540p 配置，输出到 merged/ 文件夹。
"""

import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = PROJECT_ROOT / "scripts"


def main():
    episode = "第2集_EP02_分镜包"
    num_shots = 40
    merged_dir = PROJECT_ROOT / "output/frames" / episode / "merged"

    print("=" * 60)
    print("Episode 级 首帧+双 prompt 测试（turbo 540p）")
    print(f"Episode: {episode} | 镜头数: {num_shots} | 输出: {merged_dir}")
    print("=" * 60)

    print("\n[1/3] 提交 i2v 任务（viduq3-turbo, 540p）...")
    r1 = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "i2v" / "episode_prompt_test.py"),
            "--episode", episode,
            "--num", str(num_shots),
            "--model", "viduq3-turbo",
            "--resolution", "540p",
            "--output", "merged",
        ],
        cwd=PROJECT_ROOT,
    )
    if r1.returncode != 0:
        sys.exit(r1.returncode)

    records_path = merged_dir / "i2v_episode_records.json"
    if not records_path.exists():
        print(f"未生成记录文件 {records_path}")
        sys.exit(1)

    print("\n[2/3] 轮询任务直到完成...")
    r2 = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "task" / "poll.py"),
            "--records", str(records_path),
            "--interval", "15",
        ],
        cwd=PROJECT_ROOT,
    )
    if r2.returncode != 0:
        sys.exit(r2.returncode)

    poll_results = merged_dir / "poll_results.json"
    print("\n[3/3] 下载视频到 merged/videos ...")
    r3 = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "task" / "download.py"),
            "--results", str(poll_results),
            "--out-dir", str(merged_dir / "videos"),
        ],
        cwd=PROJECT_ROOT,
    )
    sys.exit(r3.returncode)


if __name__ == "__main__":
    main()
