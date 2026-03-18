#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分镜 raw.txt 解析脚本：将原生提示词模组拆解为 prompt.md 提示词组

功能：
  1. 解析 raw.txt 中每个 block 的 [景别][角度]...[描述]、台词、具体视频提示词
  2. Prompt1：仅 [描述] 后面的纯描述内容（不要景别/角度/运镜/构图/主体/[描述] 标签）
  3. Prompt2：具体的视频提示词（每个 block 最后一行的详细描述）
  4. 台词：有对白时补充「不要生成字幕。台词：XXX」
  5. 支持从 raw 中追加指定数量的 shot

用法：
  python scripts/frames/parse_raw_to_prompt.py [--add N] [--base-dir DIR]

  --add N   从 raw.txt 追加 N 个 shot（默认 3）
  --base-dir 分镜包目录（默认 output/frames/第2集_EP02_分镜包）
"""

import argparse
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# 提取 [描述] 或 [描述][X-Xs] 后面的纯描述内容（不要景别/角度/运镜/构图/主体/[描述]标签）
DESC_EXTRACT_PATTERN = re.compile(r"\[描述\](?:\[\d+-\d+s\])?\s*(.+)")
JINGBIE_LINE = re.compile(r"^\[景别\].+$")


def parse_raw_blocks(raw_path: Path) -> list[dict]:
    """
    解析 raw.txt，按 block 拆分。
    每个 block：参考图 + [景别]行 + 台词行 + 若干元数据行 + prompt2 行。
    """
    text = raw_path.read_text(encoding="utf-8")
    lines = text.splitlines()

    blocks: list[dict] = []
    i = 0

    while i < len(lines):
        line = lines[i]
        # 跳过 "N\t地点"、"参考图"
        if re.match(r"^\d+\t", line) or line.strip() == "参考图":
            i += 1
            continue

        if not JINGBIE_LINE.match(line.strip()):
            i += 1
            continue

        # 提取时间和 prompt1（仅描述部分，不要景别/角度等）
        time_m = re.search(r"\[(\d+-\d+s)\]", line)
        time_range = time_m.group(1) if time_m else ""
        desc_m = DESC_EXTRACT_PATTERN.search(line.strip())
        prompt1 = desc_m.group(1).strip() if desc_m else line.strip()

        # 台词：下一行
        dialogue = None
        if i + 1 < len(lines):
            next_ln = lines[i + 1].strip()
            if next_ln and next_ln != "-" and ("：" in next_ln or ":" in next_ln):
                dialogue = next_ln

        # prompt2：在 台词 后，位于 "Ns" 时长行之后的第一个长句（>40 字）
        # 结构：台词 -> 5 行元数据 -> Ns -> 空行 -> prompt2
        prompt2 = ""
        found_duration = False
        for k in range(i + 2, min(i + 12, len(lines))):
            ln = lines[k].strip()
            if re.match(r"^\d+s\s*$", ln):
                found_duration = True
                continue
            if found_duration and ln and len(ln) > 40 and not ln.startswith("["):
                prompt2 = ln
                break
        if not prompt2:
            for k in range(i + 8, min(i + 12, len(lines))):
                ln = lines[k].strip()
                if ln and len(ln) > 40 and "镜头" in ln:
                    prompt2 = ln
                    break

        blocks.append({
            "time": time_range,
            "prompt1": prompt1,
            "prompt2": prompt2,
            "dialogue": dialogue,
        })
        i += 1

    return blocks


def format_shot(shot_num: int, time_range: str, prompt1: str, prompt2: str, dialogue: str | None) -> str:
    """格式化单个 shot 为 prompt.md 的一节。"""
    suffix = f"。不要生成字幕。台词：{dialogue}" if dialogue else ""
    p1 = prompt1.rstrip("。") + suffix
    p2 = prompt2.rstrip("。") + suffix if dialogue else prompt2
    return f"# Shot {shot_num}\n{time_range}\n{p1}\n{p2}\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="解析 raw.txt 生成 prompt.md")
    parser.add_argument("--add", type=int, default=3, help="从 raw 追加的 shot 数量")
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=PROJECT_ROOT / "output" / "frames" / "第2集_EP02_分镜包",
        help="分镜包目录",
    )
    args = parser.parse_args()

    base = args.base_dir
    raw_path = base / "raw.txt"
    prompt_path = base / "prompt.md"

    if not raw_path.exists():
        print(f"错误：找不到 {raw_path}")
        return 1

    raw_blocks = parse_raw_blocks(raw_path)

    # 读取已有 prompt.md 内容
    existing_content = ""
    if prompt_path.exists():
        existing_content = prompt_path.read_text(encoding="utf-8")

    # 统计已有 shot 数量
    shot_matches = re.findall(r"^# Shot (\d+)\n", existing_content, re.MULTILINE)
    next_shot_num = len(shot_matches) + 1 if shot_matches else 1

    # start_idx：已有 N 个 shot 时，前 7 个来自 group_01+raw 0~5，之后每次 add 3 取自 raw。故从 raw 已取 6~(N-7)+5 = N-1 的前一块，下一块索引 = 6 + max(0, N-7)
    start_idx = 6 + max(0, len(shot_matches) - 7) if shot_matches else 6
    add_blocks = raw_blocks[start_idx : start_idx + args.add]

    out_parts = [existing_content.rstrip()] if existing_content else []
    for blk in add_blocks:
        out_parts.append(
            format_shot(
                next_shot_num,
                blk["time"],
                blk["prompt1"],
                blk["prompt2"],
                blk["dialogue"],
            ).rstrip()
        )
        next_shot_num += 1

    prompt_path.write_text("\n\n".join(out_parts) + "\n", encoding="utf-8")
    print(f"已生成 {prompt_path}，追加 {len(add_blocks)} 个 shot，共 {next_shot_num - 1} 个 shot")
    return 0


if __name__ == "__main__":
    sys.exit(main())
