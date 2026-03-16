#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
i2v 提示词对比测试：3×2 任务（prompt.md 格式）
"""

import json
import os
import re
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


def parse_timestamp_to_duration(timestamp: str) -> int:
    m = re.match(r"(\d+)-(\d+)s?", timestamp)
    return int(m.group(2)) - int(m.group(1)) if m else 5


def parse_prompt_md(md_path: Path) -> list[dict]:
    text = md_path.read_text(encoding="utf-8")
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    scenes = []
    i = 0
    while i + 2 < len(lines):
        timestamp = lines[i]
        scenes.append({
            "timestamp": timestamp,
            "duration": parse_timestamp_to_duration(timestamp),
            "prompt1": lines[i + 1],
            "prompt2": lines[i + 2],
        })
        i += 3
    return scenes


def run_test(
    frames_dir: Path,
    group: str = "group_01",
    num_images: int = 3,
    *,
    model: str | None = None,
    resolution: str | None = None,
    records_name: str = "i2v_test_records.json",
) -> None:
    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        print("请在 .env 中设置 VIDU_API_KEY")
        sys.exit(1)
    prompt_path = frames_dir / group / "prompt.md"
    if not prompt_path.exists():
        print(f"未找到 {prompt_path}")
        sys.exit(1)
    scenes = parse_prompt_md(prompt_path)
    if len(scenes) < num_images:
        print(f"prompt.md 仅 {len(scenes)} 个场景")
        sys.exit(1)
    cfg = {}
    if (PROJECT_ROOT / "config/default.yaml").exists():
        with open(PROJECT_ROOT / "config/default.yaml", "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
    vidu_cfg = cfg.get("vidu", {})
    client = ViduClient(api_key=api_key)
    results = []
    for i in range(num_images):
        scene = scenes[i]
        frame_name = f"S{i + 1:02d}.png"
        frame_path = frames_dir / group / frame_name
        if not frame_path.exists():
            continue
        duration = scene.get("duration") or 5
        payload_str = json.dumps({
            "timestamp": scene["timestamp"],
            "duration": duration,
            "audio": True,
            "audio_type": "all",
            "bgm": False,
            "subtitle": False,
        }, ensure_ascii=False)
        for p_label, prompt in [("prompt1", scene["prompt1"]), ("prompt2", scene["prompt2"])]:
            task_id = f"{frame_name}_{p_label}"
            try:
                resp = client.img2video_from_file(
                    image_path=frame_path,
                    prompt=prompt[:5000],
                    model=model or vidu_cfg.get("model", "viduq2-pro-fast"),
                    duration=scene.get("duration") or vidu_cfg.get("duration", 5),
                    resolution=resolution or vidu_cfg.get("resolution", "720p"),
                    audio=vidu_cfg.get("audio", True),
                    audio_type=vidu_cfg.get("audio_type", "all"),
                    bgm=vidu_cfg.get("bgm", False),
                    seed=0,
                    payload=payload_str,
                )
                tid = resp.get("task_id", "?")
                seed = resp.get("seed")
                results.append({
                    "task_id": task_id,
                    "vidu_task_id": tid,
                    "frame": frame_name,
                    "prompt_type": p_label,
                    "timestamp": scene["timestamp"],
                    "duration": scene.get("duration", 5),
                    "seed": seed,
                })
                seed_str = f" seed={seed}" if seed is not None else ""
                print(f"[OK] {task_id} → task_id={tid} | {scene['timestamp']} duration={duration}s{seed_str}")
            except Exception as e:
                print(f"[失败] {task_id}: {e}")
    out_dir = frames_dir / group
    record_path = out_dir / records_name
    record_path.parent.mkdir(parents=True, exist_ok=True)
    with open(record_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n任务记录已保存: {record_path}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="i2v 提示词对比测试 (3×2)")
    parser.add_argument("--frames-dir", default=None)
    parser.add_argument("--group", default="group_01")
    parser.add_argument("--num", type=int, default=3)
    parser.add_argument("--model", default=None)
    parser.add_argument("--resolution", default=None)
    parser.add_argument("--records", default="i2v_test_records.json", help="记录文件名，可含子目录如 s7/xxx.json")
    args = parser.parse_args()
    frames_dir = Path(args.frames_dir) if args.frames_dir else PROJECT_ROOT / "output/frames/第2集_EP02_分镜包"
    run_test(frames_dir, args.group, args.num, model=args.model, resolution=args.resolution, records_name=args.records)


if __name__ == "__main__":
    main()
