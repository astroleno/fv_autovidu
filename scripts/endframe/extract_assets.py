#!/usr/bin/env python3
"""
从 raw.txt 提取每个 shot 的资产列表。

资产定义：台词行和时长行（如 5s）之间的多行文本，每行一个资产名。
用于尾帧生成时附加参考图，补足首帧中不完整的关键资产。

用法:
    python scripts/endframe/extract_assets.py
    python scripts/endframe/extract_assets.py --output assets_by_shot.json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def parse_raw(raw_path: Path) -> list[dict]:
    """
    解析 raw.txt，按 block 提取 (time_range, assets)。

    结构约定：
    - 每个 block： [景别][描述]含[时间] → 台词行 → 资产行（多行）→ 时长行（如 5s\t）→ 视频提示词
    - 资产 = 台词行与时长行之间的非空行，每行一个资产名

    Returns:
        [{"time_range": "10-15s", "assets": ["格雷·金斯顿", ...]}, ...]
    """
    text = raw_path.read_text(encoding="utf-8")
    blocks: list[dict] = []
    # 时长行格式: 5s\t 或 4s（strip 后可能去掉尾部 \t）
    duration_re = re.compile(r"^(\d+)s(?:\t|\s*)$", re.MULTILINE)
    time_in_desc = re.compile(r"\[(\d+(?:-\d+)?s?)\]")

    parts = re.split(r"\n\s*\n", text)

    for part in parts:
        part = part.strip()
        if not part:
            continue
        lines = part.split("\n")

        desc_idx = -1
        for i, line in enumerate(lines):
            if "[景别]" in line or "描述" in line and "[" in line:
                desc_idx = i
                break

        if desc_idx < 0:
            continue

        desc_line = lines[desc_idx]
        m = time_in_desc.search(desc_line)
        time_range = m.group(1) if m else ""

        duration_idx = -1
        for i, line in enumerate(lines):
            if duration_re.match(line.strip()):
                duration_idx = i
                break

        if duration_idx < 0:
            continue

        dialogue_idx = desc_idx + 1
        if dialogue_idx >= duration_idx:
            continue

        assets: list[str] = []
        for i in range(dialogue_idx + 1, duration_idx):
            line = lines[i].strip()
            if not line or line == "-":
                continue
            if re.match(r"^[\d\s\-]+$", line):
                continue
            assets.append(line)

        blocks.append({
            "time_range": time_range,
            "assets": assets,
        })

    return blocks


def build_shot_to_assets(
    blocks: list[dict],
    prompt_path: Path,
) -> dict[int, list[str]]:
    """
    将 raw 的 block 按时间范围对齐到 prompt.md 的 shot 序号。
    raw 与 prompt 的 shot 顺序可能不一致；优先匹配时间，同一时间取首个未使用的 block。
    """
    prompt_text = prompt_path.read_text(encoding="utf-8")
    shot_info: list[tuple[int, str]] = []
    for m in re.finditer(r"# Shot (\d+)\s*\n([^\n]+)", prompt_text):
        shot_num = int(m.group(1))
        time_line = m.group(2).strip()
        mt = re.match(r"(\d+(?:-\d+)?s?)", time_line)
        if mt:
            shot_info.append((shot_num, mt.group(1).lower()))

    def normalize(t: str) -> str:
        return t.lower().replace("s", "").strip()

    result: dict[int, list[str]] = {s[0]: [] for s in shot_info}
    used_blocks = set()

    for shot_num, pt in sorted(shot_info, key=lambda x: x[0]):
        pt_norm = normalize(pt)
        for idx, block in enumerate(blocks):
            if idx in used_blocks:
                continue
            rt = block["time_range"]
            rt_norm = normalize(rt)
            if rt_norm == pt_norm:
                result[shot_num] = block["assets"]
                used_blocks.add(idx)
                break

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="从 raw.txt 提取 shot 资产列表")
    parser.add_argument(
        "--raw",
        type=Path,
        default=Path("output/frames/第2集_EP02_分镜包/raw.txt"),
        help="raw.txt 路径",
    )
    parser.add_argument(
        "--prompt",
        type=Path,
        default=Path("output/frames/第2集_EP02_分镜包/prompt.md"),
        help="prompt.md 路径（用于对齐 shot 序号）",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="输出 JSON 路径，默认打印到 stdout",
    )
    parser.add_argument(
        "--by-time",
        action="store_true",
        help="按时间范围输出，不做 shot 对齐",
    )
    parser.add_argument(
        "--list-unique",
        action="store_true",
        help="仅输出去重后的资产名列表（供准备 public/assets/ 图片用）",
    )
    args = parser.parse_args()

    raw_path = args.raw if args.raw.is_absolute() else Path.cwd() / args.raw
    if not raw_path.exists():
        raise SystemExit(f"raw 文件不存在: {raw_path}")

    blocks = parse_raw(raw_path)

    if args.list_unique:
        seen: set[str] = set()
        for b in blocks:
            for a in b["assets"]:
                seen.add(a)
        out = sorted(seen)
    elif args.by_time:
        out = {b["time_range"]: b["assets"] for b in blocks}
    else:
        prompt_path = args.prompt if args.prompt.is_absolute() else Path.cwd() / args.prompt
        shot_assets = build_shot_to_assets(blocks, prompt_path)
        out = {str(k): v for k, v in sorted(shot_assets.items(), key=lambda x: x[0])}

    json_str = json.dumps(out, ensure_ascii=False, indent=2)
    if args.output:
        out_path = args.output if args.output.is_absolute() else Path.cwd() / args.output
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json_str, encoding="utf-8")
        print(f"已写入: {out_path}")
    else:
        print(json_str)


if __name__ == "__main__":
    main()
