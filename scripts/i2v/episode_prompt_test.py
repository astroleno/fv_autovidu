#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Episode 级 prompt.md 测试：首帧图 + prompt1/prompt2

解析 output/frames/{episode}/prompt.md（含 # Shot N、时间戳、prompt1、prompt2），
对每个 shot 用对应首帧 + 两种 prompt 各测一次。
输出到合并文件夹（merged/）。

流程：解析 prompt.md → 建立 shot→帧映射 → 提交 i2v → 记录到 merged/
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

from src.vidu.client import ViduClient


def get_shot_to_frame_mapping(frames_dir: Path) -> list[tuple[str, str]]:
    """
    根据各 group 的帧数，建立 Shot 1,2,3... → (group_xx, S0n) 映射。
    顺序规则：Shot 1–3 → group_01/S01–S03，Shot 4–6 → group_02/S01–S03，依此类推。
    """
    mapping = []
    # 按 group_01, group_02... 字典序遍历，保证 shot 序号与帧一一对应
    for group_dir in sorted(
        (d for d in frames_dir.iterdir() if d.is_dir() and d.name.startswith("group_")),
        key=lambda p: p.name,
    ):
        frames = sorted(group_dir.glob("S*.png"), key=lambda f: f.name)
        for f in frames:
            mapping.append((group_dir.name, f.name))
    return mapping


def parse_episode_prompt_md(md_path: Path) -> list[dict]:
    """
    解析 episode 级 prompt.md。
    每段格式：
      # Shot N
      timestamp（如 0-4s）
      prompt1（画面描述）
      prompt2（纯视频描述，可选，缺则用 prompt1，如 Shot 15）
    """
    text = md_path.read_text(encoding="utf-8")
    # 按 "# Shot \d+\n" 分割，首块为空串
    blocks = re.split(r"# Shot \d+\n", text)
    scenes = []
    for blk in blocks:
        blk = blk.strip()
        if not blk:
            continue
        lines = [ln.strip() for ln in blk.split("\n") if ln.strip()]
        if len(lines) < 2:
            continue
        # 第一行：时间戳（如 0-4s），解析得到 duration
        timestamp = lines[0]
        prompt1 = lines[1]
        prompt2 = lines[2] if len(lines) > 2 else prompt1
        m = re.match(r"(\d+)-(\d+)s?", timestamp)
        duration = int(m.group(2)) - int(m.group(1)) if m else 5
        scenes.append({
            "shot_num": len(scenes) + 1,
            "timestamp": timestamp,
            "duration": duration,
            "prompt1": prompt1,
            "prompt2": prompt2,
        })
    return scenes


def run_test(
    episode: str = "第2集_EP02_分镜包",
    num_shots: int = 3,
    start_shot: int = 1,
    model: str = "viduq3-turbo",
    resolution: str = "540p",
    output_subdir: str = "merged",
) -> None:
    frames_dir = PROJECT_ROOT / "output/frames" / episode
    prompt_path = frames_dir / "prompt.md"
    if not prompt_path.exists():
        print(f"未找到 {prompt_path}")
        sys.exit(1)

    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        print("请在 .env 中设置 VIDU_API_KEY")
        sys.exit(1)

    scenes = parse_episode_prompt_md(prompt_path)
    mapping = get_shot_to_frame_mapping(frames_dir)
    end_shot = min(start_shot + num_shots - 1, len(scenes), len(mapping))
    actual_count = end_shot - start_shot + 1
    if actual_count < 1:
        print(f"无有效镜头：start={start_shot} num={num_shots}")
        sys.exit(1)
    print(f"提交 Shot {start_shot}–{end_shot} 共 {actual_count}×2={actual_count*2} 任务")

    client = ViduClient(api_key=api_key)
    results = []
    out_merged = frames_dir / output_subdir
    out_merged.mkdir(parents=True, exist_ok=True)

    # 若已有记录则合并（避免重复提交）
    record_path = out_merged / "i2v_episode_records.json"
    if record_path.exists():
        existing = json.loads(record_path.read_text(encoding="utf-8"))
        results.extend(existing)

    for i in range(start_shot - 1, end_shot):
        group_name, frame_name = mapping[i]
        scene = scenes[i]
        frame_path = frames_dir / group_name / frame_name
        if not frame_path.exists():
            print(f"[跳过] 无图 {frame_path}")
            continue

        payload_str = json.dumps({
            "timestamp": scene["timestamp"],
            "duration": scene["duration"],
            "audio": True,
            "audio_type": "all",
            "bgm": False,
            "subtitle": False,
        }, ensure_ascii=False)

        shot_label = f"Shot{scene['shot_num']:02d}"
        for p_label, prompt in [("prompt1", scene["prompt1"]), ("prompt2", scene["prompt2"])]:
            task_id = f"{shot_label}_{p_label}"
            # 构建请求 payload（不含 base64 图，便于记录）
                req_payload = {
                    "model": model,
                    "prompt": prompt[:5000],
                    "duration": scene["duration"],
                    "resolution": resolution,
                    "audio": True,
                    "audio_type": "all",
                    "bgm": False,
                    "seed": 0,
                    "payload": payload_str,
                    "aspect_ratio": "9:16",
                    "image_path": str(frame_path.relative_to(PROJECT_ROOT)),
                }
            try:
                resp = client.img2video_from_file(
                    image_path=frame_path,
                    prompt=prompt[:5000],
                    model=model,
                    duration=scene["duration"],
                    resolution=resolution,
                    audio=True,
                    audio_type="all",
                    bgm=False,
                    seed=0,
                    payload=payload_str,
                    aspect_ratio="9:16",  # 竖屏 9:16，与首帧裁剪比例一致
                )
                tid = resp.get("task_id", "?")
                seed = resp.get("seed")
                credits = resp.get("credits")
                # 完整记录：请求 payload + API 返回值（task_id, state, seed, credits 等）
                results.append({
                    "task_id": task_id,
                    "vidu_task_id": tid,
                    "shot_num": scene["shot_num"],
                    "group": group_name,
                    "frame": frame_name,
                    "prompt_type": p_label,
                    "timestamp": scene["timestamp"],
                    "duration": scene["duration"],
                    "seed": seed,
                    "credits": credits,
                    "request_payload": req_payload,
                    "api_response": {k: v for k, v in resp.items() if k != "images"},
                })
                cred_str = f" credits={credits}" if credits is not None else ""
                seed_str = f" seed={seed}" if seed else ""
                print(f"[OK] {task_id} → task_id={tid} | {scene['timestamp']} duration={scene['duration']}s{seed_str}{cred_str}")
            except Exception as e:
                results.append({
                    "task_id": task_id,
                    "vidu_task_id": None,
                    "shot_num": scene["shot_num"],
                    "error": str(e),
                    "request_payload": req_payload,
                })
                print(f"[失败] {task_id}: {e}")

    with open(record_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n记录已保存: {record_path}（共 {len(results)} 条）")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Episode 级 prompt 测试")
    parser.add_argument("--episode", default="第2集_EP02_分镜包")
    parser.add_argument("--num", type=int, default=3, help="镜头数量")
    parser.add_argument("--start", type=int, default=1, help="起始 Shot 序号（1-based）")
    parser.add_argument("--model", default="viduq3-turbo")
    parser.add_argument("--resolution", default="540p")
    parser.add_argument("--output", default="merged", help="合并输出子目录名")
    args = parser.parse_args()
    run_test(
        episode=args.episode,
        num_shots=args.num,
        start_shot=args.start,
        model=args.model,
        resolution=args.resolution,
        output_subdir=args.output,
    )


if __name__ == "__main__":
    main()
