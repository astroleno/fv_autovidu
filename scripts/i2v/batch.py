#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量 i2v（图生视频）脚本

读取裁剪后的单格图 + prompt.txt，批量调用 Vidu img2video API。
"""

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

import yaml

from src.vidu.client import ViduClient
from scripts.crop import get_scene_descriptions


def load_config() -> dict:
    cfg_path = PROJECT_ROOT / "config" / "default.yaml"
    if not cfg_path.exists():
        return {}
    with open(cfg_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def run_batch(episode: str = "第2集_EP02_分镜包", dry_run: bool = False) -> None:
    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not api_key and not dry_run:
        print("请在 .env 中设置 VIDU_API_KEY")
        sys.exit(1)
    cfg = load_config()
    vidu_cfg = cfg.get("vidu", {})
    paths_cfg = cfg.get("paths", {})
    frames_base = PROJECT_ROOT / paths_cfg.get("output_frames", "output/frames")
    shot_base = PROJECT_ROOT / paths_cfg.get("shot_base", "public/img/shot")
    ep_frames = frames_base / episode
    ep_shot = shot_base / episode
    if not ep_frames.is_dir():
        print(f"未找到裁剪输出: {ep_frames}")
        sys.exit(1)
    client = ViduClient(api_key=api_key or "dummy") if not dry_run else None
    tasks = []
    for group_dir in sorted(ep_frames.iterdir()):
        if not group_dir.is_dir() or not group_dir.name.startswith("group_"):
            continue
        prompt_path = ep_shot / group_dir.name / "prompt.txt"
        if not prompt_path.exists():
            continue
        descriptions = get_scene_descriptions(prompt_path)
        if not descriptions:
            continue
        for i, desc in enumerate(descriptions):
            frame_name = f"S{i + 1:02d}.png"
            frame_path = group_dir / frame_name
            if not frame_path.exists():
                continue
            tasks.append({"group": group_dir.name, "scene": i + 1, "frame_path": frame_path, "prompt": desc[:5000]})
    print(f"共 {len(tasks)} 个任务待提交")
    if dry_run:
        for t in tasks[:3]:
            print(f"  - {t['group']}/S{t['scene']:02d}: {t['prompt'][:60]}...")
        if len(tasks) > 3:
            print(f"  ... 及 {len(tasks) - 3} 个")
        return
    success = 0
    for t in tasks:
        try:
            resp = client.img2video_from_file(
                image_path=t["frame_path"],
                prompt=t["prompt"],
                model=vidu_cfg.get("model", "viduq2-pro-fast"),
                duration=vidu_cfg.get("duration", 5),
                resolution=vidu_cfg.get("resolution", "720p"),
                audio=vidu_cfg.get("audio", False),
                off_peak=vidu_cfg.get("off_peak", False),
            )
            print(f"[OK] {t['group']}/S{t['scene']:02d} → task_id={resp.get('task_id', '?')}")
            success += 1
        except Exception as e:
            print(f"[失败] {t['group']}/S{t['scene']:02d}: {e}")
    print(f"完成: {success}/{len(tasks)} 任务已提交")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="批量 i2v 生成")
    parser.add_argument("--episode", default="第2集_EP02_分镜包", help="分镜包名称")
    parser.add_argument("--dry-run", action="store_true", help="仅预览")
    args = parser.parse_args()
    run_batch(episode=args.episode, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
