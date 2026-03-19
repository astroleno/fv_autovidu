#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 poll_results.json 或 episode.json 下载视频到本地。

--from-json 模式：
  - 从 episode.json 的 videoCandidates 中读取 taskStatus=success 且 url 存在的候选
  - 下载到 videos/S{nn}/v{n}.mp4（例如 S01/v1.mp4、S01/v2.mp4）
  - 更新 episode.json 中对应候选的 videoPath
"""

import json
import sys
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def download_from_results(results_path: Path, out_dir: Path | None = None) -> list[Path]:
    """从 poll_results.json 下载视频"""
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


def download_from_episode_json(json_path: Path) -> int:
    """
    从 episode.json 下载视频到 videos/S{nn}/v{n}.mp4，并更新 episode.json 中的 videoPath。

    Returns:
        下载成功的视频数量
    """
    episode_dir = json_path.parent
    data = json.loads(json_path.read_text(encoding="utf-8"))
    videos_base = episode_dir / "videos"
    videos_base.mkdir(parents=True, exist_ok=True)
    saved_count = 0

    for scene in data.get("scenes", []):
        for shot in scene.get("shots", []):
            sn = shot.get("shotNumber", 0)
            shot_dir = videos_base / f"S{sn:02d}"
            shot_dir.mkdir(parents=True, exist_ok=True)
            for i, c in enumerate(shot.get("videoCandidates", [])):
                if c.get("taskStatus") != "success" or not c.get("url"):
                    continue
                # 相对 episode 目录的路径，供前端 /api/files/ 使用
                rel_path = f"videos/S{sn:02d}/v{i + 1}.mp4"
                local_path = episode_dir / rel_path
                try:
                    resp = requests.get(c["url"], timeout=60, stream=True)
                    resp.raise_for_status()
                    with open(local_path, "wb") as f:
                        for chunk in resp.iter_content(chunk_size=8192):
                            f.write(chunk)
                    c["videoPath"] = rel_path
                    saved_count += 1
                    print(f"  [OK] S{sn:02d}/v{i + 1}.mp4")
                except Exception as e:
                    print(f"  [失败] S{sn:02d}/v{i + 1}.mp4: {e}")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return saved_count


def main():
    import argparse
    parser = argparse.ArgumentParser(description="下载 poll_results 或 episode.json 中的视频")
    parser.add_argument("--results", default=None, help="poll_results.json 路径")
    parser.add_argument("--from-json", type=Path, default=None, help="episode.json 路径，从 videoCandidates 下载并更新 videoPath")
    parser.add_argument("--out-dir", default=None, help="输出目录（仅 --results 模式）")
    args = parser.parse_args()

    if args.from_json:
        json_path = args.from_json if args.from_json.is_absolute() else Path.cwd() / args.from_json
        if not json_path.exists():
            print(f"未找到 {json_path}")
            sys.exit(1)
        print(f"下载 episode: {json_path}")
        count = download_from_episode_json(json_path)
        print(f"完成: {count} 个视频 → {json_path.parent / 'videos'}")
        return

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
