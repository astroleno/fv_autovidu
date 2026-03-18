#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 prompt.md 提取所有 shot 的提示词（第一段：画面描述；第二段：视频提示词）

用法：
    python scripts/endframe/extract_prompts.py
    python scripts/endframe/extract_prompts.py --output output/frames/第2集_EP02_分镜包/prompts_extracted.json
"""

import argparse
import json
import re
import sys
from pathlib import Path

# 项目根
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def parse_episode_prompt_md(prompt_path: Path) -> list[dict]:
    """
    解析 episode 级 prompt.md（含 # Shot N）。
    每段：时间戳 / image_prompt（第一段）/ video_prompt（第二段）
    返回列表：[
        {"shot": 1, "time": "0-4s", "image_prompt": "...", "video_prompt": "..."},
        ...
    ]
    """
    text = prompt_path.read_text(encoding="utf-8")
    result: list[dict] = []
    parts = re.split(r"# Shot (\d+)\s*\n", text)
    # parts[0] 可能为空，之后是 [shot_num, content, shot_num, content, ...]
    i = 1
    while i + 1 < len(parts):
        shot_num = int(parts[i])
        content = parts[i + 1]
        i += 2
        lines = [ln.strip() for ln in content.split("\n") if ln.strip()]
        if len(lines) >= 2:
            time_line = lines[0]
            image_prompt = lines[1]
            video_prompt = lines[2] if len(lines) > 2 else lines[1]
        elif len(lines) == 1:
            time_line = lines[0] if re.match(r"^\d", lines[0]) else ""
            image_prompt = lines[0] if not re.match(r"^\d", lines[0]) else ""
            video_prompt = image_prompt
        else:
            continue
        result.append({
            "shot": shot_num,
            "time": time_line,
            "image_prompt": image_prompt,
            "video_prompt": video_prompt,
        })
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="从 prompt.md 提取所有 shot 的提示词")
    parser.add_argument(
        "--prompt-path",
        type=Path,
        default=PROJECT_ROOT / "output/frames/第2集_EP02_分镜包/prompt.md",
        help="prompt.md 路径",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="输出路径（.json 或 .md），不指定则输出到同目录 prompts_extracted.json",
    )
    args = parser.parse_args()

    prompt_path = args.prompt_path if args.prompt_path.is_absolute() else PROJECT_ROOT / args.prompt_path
    if not prompt_path.exists():
        print(f"错误：找不到 {prompt_path}", file=sys.stderr)
        return 1

    blocks = parse_episode_prompt_md(prompt_path)
    out_dir = prompt_path.parent

    # 输出 JSON
    out_json = args.output or (out_dir / "prompts_extracted.json")
    if not out_json.is_absolute():
        out_json = PROJECT_ROOT / out_json
    out_json.parent.mkdir(parents=True, exist_ok=True)
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(blocks, f, ensure_ascii=False, indent=2)
    print(f"已写入 {out_json}，共 {len(blocks)} 个 shot")

    # 输出可读 Markdown
    out_md = out_json.with_suffix(".md")
    with open(out_md, "w", encoding="utf-8") as f:
        f.write("# 已提取的 Shot 提示词\n\n")
        for b in blocks:
            f.write(f"## Shot {b['shot']} ({b['time']})\n\n")
            f.write(f"**画面描述（第一段）**：{b['image_prompt']}\n\n")
            f.write(f"**视频提示词（第二段）**：{b['video_prompt']}\n\n")
    print(f"已写入 {out_md}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
