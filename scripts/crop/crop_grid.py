#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分镜网格裁剪脚本

功能：将分镜包内各 group 的 grid.png 按网格裁剪成单格图片，
      便于后续以首帧 i2v 形式生成视频。

输入：public/img/shot/{episode}/group_xx/grid.png + prompt.txt
输出：output/frames/{episode}/group_xx/S{nn}.png
"""

import re
import sys
from pathlib import Path

# 项目根（scripts/crop/ 上两级）
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from PIL import Image
except ImportError:
    print("请安装 Pillow: pip install Pillow")
    sys.exit(1)


def parse_prompt_scenes(prompt_path: Path) -> list[str]:
    """
    解析 prompt.txt，提取 S1:, S2: ... 后的描述文本。

    Returns:
        场景描述列表（含 S1: 前缀），如 ["S1:xxx", "S2:xxx"]
    """
    text = prompt_path.read_text(encoding="utf-8")
    pattern = re.compile(r"(S\d+:[^\n]+)")
    matches = pattern.findall(text)
    return [m.strip() for m in matches]


def get_scene_descriptions(prompt_path: Path) -> list[str]:
    """
    解析 prompt.txt，返回纯描述文本（去掉 S1: 等前缀），供 i2v prompt 使用。

    Returns:
        描述列表，如 ["格雷·金斯顿双手...", "卡尔双唇..."]
    """
    raw = parse_prompt_scenes(prompt_path)
    out = []
    for s in raw:
        idx = s.find(":")
        if idx >= 0:
            out.append(s[idx + 1 :].strip())
        else:
            out.append(s)
    return out


def infer_layout_from_prompt(prompt_path: Path, img_width: int, img_height: int) -> tuple[int, int]:
    """
    根据 prompt 场景数和图片尺寸推断最佳 rows×cols。
    3 个场景时使用 2×2 网格、仅取前 3 格（左上、右上、左下）。
    """
    scenes = parse_prompt_scenes(prompt_path)
    n = len(scenes)
    if n == 0:
        raise ValueError(f"未在 {prompt_path} 中找到 S1:, S2: 等场景")
    if n == 3:
        return (2, 2)
    if n == 4:
        return (2, 2)
    if n == 5:
        return (2, 3)
    if n == 6:
        return (2, 3)
    r = int(n**0.5)
    c = (n + r - 1) // r
    return (r, c)


OUTPUT_ASPECT_RATIO = 9 / 16
CENTER_CROP_RATIO = 0.95


def _crop_center_and_resize(cell_img: "Image.Image", target_w: int, target_h: int) -> "Image.Image":
    """中心 95% 裁剪并缩放至 9:16。"""
    cw, ch = cell_img.size
    crop_w = int(cw * CENTER_CROP_RATIO)
    crop_h = int(ch * CENTER_CROP_RATIO)
    x0 = (cw - crop_w) // 2
    y0 = (ch - crop_h) // 2
    center = cell_img.crop((x0, y0, x0 + crop_w, y0 + crop_h))
    return center.resize((target_w, target_h), Image.Resampling.LANCZOS)


def crop_grid(
    grid_path: Path,
    output_dir: Path,
    prompt_path: Path,
    *,
    max_output: int | None = None,
) -> list[Path]:
    """将 grid.png 按网格裁剪成单格，9:16 中心 95%。"""
    img = Image.open(grid_path).convert("RGBA")
    w, h = img.size
    scenes = parse_prompt_scenes(prompt_path)
    n = len(scenes)
    if n == 0:
        raise ValueError(f"未找到场景: {prompt_path}")
    rows, cols = infer_layout_from_prompt(prompt_path, w, h)
    cell_w = w // cols
    cell_h = h // rows
    crop_w = int(cell_w * CENTER_CROP_RATIO)
    crop_h = int(cell_h * CENTER_CROP_RATIO)
    if crop_w / crop_h > OUTPUT_ASPECT_RATIO:
        out_h = crop_h
        out_w = round(crop_h * OUTPUT_ASPECT_RATIO)
    else:
        out_w = crop_w
        out_h = round(crop_w / OUTPUT_ASPECT_RATIO)
    limit = n if max_output is None else min(n, max_output)
    output_dir.mkdir(parents=True, exist_ok=True)
    out_paths = []
    idx = 0
    for row in range(rows):
        for col in range(cols):
            if idx >= limit:
                break
            x, y = col * cell_w, row * cell_h
            cell = img.crop((x, y, x + cell_w, y + cell_h))
            out_cell = _crop_center_and_resize(cell, out_w, out_h)
            out_path = output_dir / f"S{idx + 1:02d}.png"
            out_cell.save(out_path, "PNG")
            out_paths.append(out_path)
            idx += 1
    return out_paths


def process_episode(
    shot_base: Path,
    output_base: Path,
    episode: str,
    *,
    group_filter: str | None = None,
    max_output_per_group: int | None = None,
) -> dict[str, list[Path]]:
    """处理单个分镜包。"""
    ep_dir = shot_base / episode
    if not ep_dir.is_dir():
        raise FileNotFoundError(f"分镜包不存在: {ep_dir}")
    out_ep = output_base / episode
    result = {}
    for group_dir in sorted(ep_dir.iterdir()):
        if not group_dir.is_dir() or not group_dir.name.startswith("group_"):
            continue
        if group_filter and group_dir.name != group_filter:
            continue
        grid_path = group_dir / "grid.png"
        prompt_path = group_dir / "prompt.txt"
        if not grid_path.exists() or not prompt_path.exists():
            continue
        out_group = out_ep / group_dir.name
        try:
            paths = crop_grid(grid_path, out_group, prompt_path, max_output=max_output_per_group)
            result[group_dir.name] = paths
            print(f"[OK] {episode}/{group_dir.name} → {len(paths)} 帧 (9:16 中心95%)")
        except Exception as e:
            print(f"[错误] {group_dir}: {e}")
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(description="分镜 grid 裁剪为单格（9:16 中心95%）")
    parser.add_argument("--episode", default="第2集_EP02_分镜包", help="分镜包名")
    parser.add_argument("--group", default=None, help="只处理指定 group")
    parser.add_argument("--max", type=int, default=None, help="每 group 最多输出帧数")
    args = parser.parse_args()
    shot_base = PROJECT_ROOT / "public/img/shot"
    output_base = PROJECT_ROOT / "output/frames"
    print(f"裁剪分镜: {shot_base / args.episode} | 9:16 中心95%")
    result = process_episode(
        shot_base, output_base, args.episode,
        group_filter=args.group,
        max_output_per_group=args.max,
    )
    total = sum(len(v) for v in result.values())
    print(f"完成: {len(result)} 个 group，共 {total} 帧")


if __name__ == "__main__":
    main()
