#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 poll_results.json 下载视频到本地
"""

import json
import sys
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def download_from_results(results_path: Path, out_dir: Path | None = None) -> list[Path]:
    data = json.loads(results_path.read_text(encoding="utf-8"))
    if out_dir is None:
        out_dir = results_path.parent / "videos"
    out_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for r in data:
        if r.get("state") != "success" or not r.get("url"):
            continue
        name = r.get("task_id", "unknown").replace(".png", "").replace(".", "_") + ".mp4"
        path = out_dir / name
        try:
            resp = requests.get(r["url"], timeout=60, stream=True)
            resp.raise_for_status()
            with open(path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            saved.append(path)
            print(f"  [OK] {name}")
        except Exception as e:
            print(f"  [失败] {name}: {e}")
    return saved


def main():
    import argparse
    parser = argparse.ArgumentParser(description="下载 poll_results 中的视频")
    parser.add_argument("--results", default=None, help="poll_results.json 路径")
    parser.add_argument("--out-dir", default=None, help="输出目录")
    args = parser.parse_args()

    if args.results:
        results_path = Path(args.results)
    else:
        results_path = PROJECT_ROOT / "output/frames/第2集_EP02_分镜包/group_01/poll_results.json"

    if not results_path.exists():
        print(f"未找到 {results_path}")
        sys.exit(1)
    out_dir = Path(args.out_dir) if args.out_dir else None
    print(f"下载: {results_path}")
    saved = download_from_results(results_path, out_dir)
    print(f"完成: {len(saved)} 个视频 → {saved[0].parent if saved else '?'}")


if __name__ == "__main__":
    main()
