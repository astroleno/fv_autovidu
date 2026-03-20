#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 episode.json 中每个 shot 的 shotNumber 与首帧文件名对齐（全局 1…N）。

背景：
- 旧版 puller 曾把平台按「场」重复的 shotNumber（如每场 1-5）写入 JSON，
  与本地 frames/S001.png… 的全局序号不一致。
- 新版 puller 已改为写入 global shot_counter；本脚本用于**不重新拉取**时修复存量数据。

用法：
  python scripts/migrate_shot_numbers_from_firstframe.py path/to/episode.json

说明：
- 从 firstFrame 字段解析 `frames/S001.png` → shotNumber=1
- 若无法解析则跳过该条并打印警告
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

# 与 puller 首帧命名一致：frames/S001.png
_FRAME_STEM = re.compile(r"frames/S(\d+)\.png$", re.IGNORECASE)


def _parse_shot_number_from_first_frame(first_frame: str | None) -> int | None:
    if not first_frame or not isinstance(first_frame, str):
        return None
    m = _FRAME_STEM.search(first_frame.strip())
    if not m:
        return None
    return int(m.group(1), 10)


def migrate_episode(path: Path) -> tuple[int, int]:
    """
    就地修改 episode.json。

    Returns:
        (已更新条数, 跳过条数)
    """
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    scenes = data.get("scenes") or []
    updated = 0
    skipped = 0

    for sc in scenes:
        shots = sc.get("shots") or []
        for sh in shots:
            ff = sh.get("firstFrame")
            num = _parse_shot_number_from_first_frame(ff)
            if num is None:
                skipped += 1
                print(f"[Warn] 无法从 firstFrame 解析编号: shotId={sh.get('shotId')} firstFrame={ff!r}")
                continue
            old = sh.get("shotNumber")
            if old != num:
                sh["shotNumber"] = num
                updated += 1

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return updated, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="从 firstFrame 修正 episode.json 的 shotNumber")
    parser.add_argument("episode_json", type=Path, help="episode.json 路径")
    args = parser.parse_args()
    episode_path = args.episode_json.resolve()
    if not episode_path.is_file():
        raise SystemExit(f"文件不存在: {episode_path}")
    u, s = migrate_episode(episode_path)
    print(f"[Done] 已更新 {u} 条，跳过 {s} 条，写入 {episode_path}")


if __name__ == "__main__":
    main()
