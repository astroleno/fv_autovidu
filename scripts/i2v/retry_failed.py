#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
重试失败的 i2v 任务

从 poll_results.json 读取 state=failed 的任务，从 i2v_episode_records 获取 payload，重新提交。
"""

import json
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

from src.vidu.client import ViduClient


def main():
    merged_dir = PROJECT_ROOT / "output/frames/第2集_EP02_分镜包/merged"
    poll_path = merged_dir / "poll_results.json"
    records_path = merged_dir / "i2v_episode_records.json"

    if not poll_path.exists() or not records_path.exists():
        print("未找到 poll_results 或 records")
        sys.exit(1)

    poll_data = json.loads(poll_path.read_text(encoding="utf-8"))
    failed = [r for r in poll_data if r.get("state") == "failed"]
    if not failed:
        print("无失败任务")
        return

    records = {r["task_id"]: r for r in json.loads(records_path.read_text(encoding="utf-8"))}
    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        print("请设置 VIDU_API_KEY")
        sys.exit(1)

    client = ViduClient(api_key=api_key)
    new_records = []
    for r in failed:
        tid = r["task_id"]
        rec = records.get(tid)
        if not rec or "request_payload" not in rec:
            print(f"[跳过] {tid}: 无 request_payload")
            continue
        payload = rec["request_payload"]
        frame_path = PROJECT_ROOT / payload["image_path"]
        if not frame_path.exists():
            print(f"[跳过] {tid}: 无图 {frame_path}")
            continue

        try:
            resp = client.img2video_from_file(
                image_path=frame_path,
                prompt=payload["prompt"],
                model=payload.get("model", "viduq3-turbo"),
                duration=payload["duration"],
                resolution=payload.get("resolution", "540p"),
                audio=payload.get("audio", True),
                audio_type=payload.get("audio_type", "all"),
                bgm=payload.get("bgm", False),
                seed=0,
                payload=payload.get("payload", "{}"),
                aspect_ratio="9:16",  # 竖屏
            )
            vid = resp.get("task_id")
            new_records.append({
                "task_id": tid,
                "vidu_task_id": vid,
                "shot_num": rec.get("shot_num"),
                "group": rec.get("group"),
                "frame": rec.get("frame"),
                "prompt_type": rec.get("prompt_type"),
                "timestamp": rec.get("timestamp"),
                "duration": rec.get("duration"),
                "seed": resp.get("seed"),
                "credits": resp.get("credits"),
                "request_payload": {**payload, "aspect_ratio": "9:16"},
                "api_response": {k: v for k, v in resp.items() if k != "images"},
            })
            print(f"[OK] {tid} → task_id={vid} seed={resp.get('seed')} credits={resp.get('credits')}")
        except Exception as e:
            print(f"[失败] {tid}: {e}")

    if new_records:
        all_records = json.loads(records_path.read_text(encoding="utf-8"))
        by_tid = {r["task_id"]: r for r in all_records}
        for nr in new_records:
            by_tid[nr["task_id"]] = nr
        # 保持原顺序，仅替换失败的 3 条
        ordered = [by_tid[r["task_id"]] for r in all_records]
        with open(records_path, "w", encoding="utf-8") as f:
            json.dump(ordered, f, ensure_ascii=False, indent=2)
        print(f"\n重试 {len(new_records)} 个，已更新 records。轮询: python scripts/task/poll.py --records {records_path}")


if __name__ == "__main__":
    main()
