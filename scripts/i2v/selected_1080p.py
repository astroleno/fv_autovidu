#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
选定任务（固定种子）生成 1080p pro 版本
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

SELECTED = [
    {"frame": "S01", "prompt_type": "prompt2", "seed": 480216763, "duration": 4},
    {"frame": "S02", "prompt_type": "prompt2", "seed": 124900752, "duration": 2},
    {"frame": "S03", "prompt_type": "prompt1", "seed": 1729922650, "duration": 2},
]


def parse_prompt_md(md_path: Path) -> list[dict]:
    text = md_path.read_text(encoding="utf-8")
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    scenes = []
    i = 0
    while i + 2 < len(lines):
        ts = lines[i]
        m = re.match(r"(\d+)-(\d+)s?", ts)
        dur = int(m.group(2)) - int(m.group(1)) if m else 4
        scenes.append({"timestamp": ts, "duration": dur, "prompt1": lines[i + 1], "prompt2": lines[i + 2]})
        i += 3
    return scenes


def main():
    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        print("请在 .env 中设置 VIDU_API_KEY")
        sys.exit(1)
    frames_dir = PROJECT_ROOT / "output/frames/第2集_EP02_分镜包"
    group = "group_01"
    prompt_path = frames_dir / group / "prompt.md"
    scenes = parse_prompt_md(prompt_path)
    client = ViduClient(api_key=api_key)
    results = []
    for sel in SELECTED:
        idx = int(sel["frame"][1:]) - 1
        scene = scenes[idx]
        prompt = scene[sel["prompt_type"]]
        frame_path = frames_dir / group / f"{sel['frame']}.png"
        if not frame_path.exists():
            print(f"[跳过] 无图 {frame_path}")
            continue
        payload_str = json.dumps({
            "timestamp": scene["timestamp"],
            "duration": sel["duration"],
            "audio": True,
            "audio_type": "speech_only",
            "bgm": False,
            "subtitle": False,
        }, ensure_ascii=False)
        try:
            resp = client.img2video_from_file(
                image_path=frame_path,
                prompt=prompt[:5000],
                model="viduq3-pro",
                duration=sel["duration"],
                resolution="1080p",
                audio=True,
                audio_type="speech_only",
                bgm=False,
                seed=sel["seed"],
                payload=payload_str,
            )
            task_id = f"{sel['frame']}_{sel['prompt_type']}"
            results.append({
                "task_id": task_id,
                "vidu_task_id": resp.get("task_id"),
                "frame": sel["frame"],
                "prompt_type": sel["prompt_type"],
                "seed": sel["seed"],
                "duration": sel["duration"],
                "timestamp": scene["timestamp"],
            })
            print(f"[OK] {task_id} → seed={sel['seed']} duration={sel['duration']}s 1080p pro")
        except Exception as e:
            print(f"[失败] {sel['frame']}_{sel['prompt_type']}: {e}")
    out_path = frames_dir / group / "i2v_1080p_records.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n记录已保存: {out_path}")


if __name__ == "__main__":
    main()
