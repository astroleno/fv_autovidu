#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
视频复刻流程：提交任务 → 保存所有返回 → 轮询 → 下载到 output

用法示例：
    python scripts/replicate/run_replicate.py \
        --video public/product/鞋品/模板/0211-1.mp4 \
        --image public/product/鞋品/产品/02_Hoka.png \
        --prompt "【针对后庭园艺家...】" \
        --resolution 720p \
        --out-dir output/replicate/鞋品_Hoka
"""

import json
import os
import sys
import time
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

from src.vidu.client import ViduClient


def run_replicate(
    video_path: Path,
    image_path: Path,
    prompt: str,
    out_dir: Path,
    *,
    resolution: str = "720p",
    aspect_ratio: str = "16:9",
    interval: int = 15,
    verbose: bool = True,
) -> dict:
    """
    执行完整复刻流程：提交 → 保存返回 → 轮询 → 下载。

    Returns:
        汇总结果，含 task_id, state, url, saved_path, create_response, poll_history 等
    """
    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        raise RuntimeError("请在 .env 中设置 VIDU_API_KEY")

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    client = ViduClient(api_key=api_key)

    # ---- 1. 提交任务 ----
    if verbose:
        print(f"[1/4] 提交复刻任务: 视频={video_path.name} 图片={image_path.name} 分辨率={resolution}")
    create_resp = client.trending_replicate_from_files(
        video_path=video_path,
        image_paths=[image_path],
        prompt=prompt,
        resolution=resolution,
        aspect_ratio=aspect_ratio,
    )
    task_id = create_resp.get("task_id")
    if not task_id:
        raise RuntimeError(f"提交失败，无 task_id: {create_resp}")

    # 保存创建返回
    create_path = out_dir / "create_response.json"
    with open(create_path, "w", encoding="utf-8") as f:
        json.dump(create_resp, f, ensure_ascii=False, indent=2)
    if verbose:
        print(f"      已保存: {create_path}")
        print(f"      task_id={task_id} state={create_resp.get('state')}")

    # ---- 2. 轮询并保存每次返回 ----
    poll_history: list[dict] = []
    while True:
        time.sleep(interval)
        resp = client.query_creations(task_id)
        poll_history.append(resp)
        state = resp.get("state", "")
        if verbose:
            progress = resp.get("progress", 0)
            print(f"[2/4] 轮询 #{len(poll_history)} state={state} progress={progress}%")
        if state in ("success", "failed"):
            break
        if verbose:
            print(f"       {interval}s 后重试...")

    # 保存轮询历史
    poll_path = out_dir / "poll_history.json"
    with open(poll_path, "w", encoding="utf-8") as f:
        json.dump(poll_history, f, ensure_ascii=False, indent=2)
    if verbose:
        print(f"      已保存轮询历史: {poll_path}")

    # 保存最新一次完整返回（与 create 结构不同，方便查看）
    latest_path = out_dir / "query_creations_latest.json"
    with open(latest_path, "w", encoding="utf-8") as f:
        json.dump(poll_history[-1], f, ensure_ascii=False, indent=2)
    if verbose:
        print(f"      已保存最新返回: {latest_path}")

    result = {
        "task_id": task_id,
        "state": state,
        "create_response": create_resp,
        "poll_history": poll_history,
        "url": None,
        "cover_url": None,
        "watermarked_url": None,
        "saved_path": None,
    }

    creations = (poll_history[-1] or {}).get("creations", [])
    if state == "success" and creations:
        first = creations[0]
        result["url"] = first.get("url")
        result["cover_url"] = first.get("cover_url")
        result["watermarked_url"] = first.get("watermarked_url")

        # ---- 3. 下载视频 ----
        if result["url"]:
            download_path = out_dir / "replicate_result.mp4"
            if verbose:
                print(f"[3/4] 下载视频: {result['url'][:60]}...")
            try:
                r = requests.get(result["url"], timeout=120, stream=True)
                r.raise_for_status()
                with open(download_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
                result["saved_path"] = str(download_path)
                if verbose:
                    print(f"      [OK] {download_path}")
            except Exception as e:
                if verbose:
                    print(f"      [失败] {e}")
                result["download_error"] = str(e)

    # ---- 4. 保存汇总结果 ----
    summary_path = out_dir / "summary.json"
    summary = {
        "task_id": result["task_id"],
        "state": result["state"],
        "url": result["url"],
        "saved_path": result["saved_path"],
        "credits": (poll_history[-1] or {}).get("credits"),
    }
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    if verbose:
        print(f"[4/4] 汇总已保存: {summary_path}")
        print(f"      最终状态: {result['state']} | 视频: {result['saved_path'] or 'N/A'}")

    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(description="视频复刻：提交 → 轮询 → 下载")
    parser.add_argument("--video", required=True, help="复刻模板视频路径")
    parser.add_argument("--image", required=True, help="产品图路径")
    parser.add_argument("--prompt", required=True, help="提示词")
    parser.add_argument("--resolution", default="720p", help="分辨率 540p|720p|1080p")
    parser.add_argument("--aspect-ratio", default="16:9", dest="aspect_ratio")
    parser.add_argument("--out-dir", default=None, dest="out_dir", help="输出目录")
    parser.add_argument("--interval", type=int, default=15, help="轮询间隔(秒)")
    args = parser.parse_args()

    project = PROJECT_ROOT
    video_path = project / args.video
    image_path = project / args.image
    if not video_path.exists():
        print(f"视频不存在: {video_path}")
        sys.exit(1)
    if not image_path.exists():
        print(f"图片不存在: {image_path}")
        sys.exit(1)

    # 默认输出目录：output/replicate/鞋品_Hoka 或根据输入自动命名
    if args.out_dir:
        out_dir = Path(args.out_dir)
        if not out_dir.is_absolute():
            out_dir = project / out_dir
    else:
        # 用视频名_产品名 作为子目录
        vid_name = video_path.stem
        img_name = image_path.stem
        out_dir = project / "output" / "replicate" / f"{vid_name}_{img_name}"

    run_replicate(
        video_path=video_path,
        image_path=image_path,
        prompt=args.prompt,
        out_dir=out_dir,
        resolution=args.resolution,
        aspect_ratio=args.aspect_ratio,
        interval=args.interval,
    )


if __name__ == "__main__":
    main()
