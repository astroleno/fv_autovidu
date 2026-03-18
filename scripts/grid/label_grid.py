#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
在 5×5 宫格图上叠加资产名称：红色粗体，居中显示。

用法:
    python scripts/grid/label_grid.py
    python scripts/grid/label_grid.py --input output/frames/第2集_EP02_分镜包/grid_25.png
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# shot 1-25 的主资产名称（用于每格居中标注）
SHOT_TO_ASSET: dict[int, str] = {
    1: "汽车/达里尔/格雷/卡尔",
    2: "格雷",
    3: "卡尔",
    4: "卡尔",
    5: "卡尔",
    6: "监狱外围",
    7: "格雷",
    8: "瑞克",
    9: "达里尔",
    10: "达里尔",
    11: "瑞克/卡尔",
    12: "瑞克",
    13: "卡尔",
    14: "卡尔/达里尔/格雷",
    15: "达里尔/格雷/瑞克",
    16: "瑞克",
    17: "瑞克",
    18: "瑞克/格雷",
    19: "瑞克",
    20: "格雷",
    21: "瑞克/格雷",
    22: "格雷",
    23: "达里尔",
    24: "格雷/达里尔",
    25: "达里尔",
}


def add_labels(
    img_path: Path,
    out_path: Path,
    labels: dict[int, str],
    *,
    font_size_ratio: float = 0.06,
    color: tuple[int, int, int] = (255, 0, 0),
    stroke_width: int = 4,
) -> None:
    """
    在 5×5 网格图上为每格居中叠加文字标签。
    font_size_ratio: 字号相对于单格短边的比例。
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        raise SystemExit("请安装 Pillow: pip install Pillow")

    img = Image.open(img_path).convert("RGBA")
    w, h = img.size
    rows, cols = 5, 5
    cell_w = w // cols
    cell_h = h // rows

    # 尝试加载中文字体，回退到默认
    font_size = max(14, int(min(cell_w, cell_h) * font_size_ratio))
    font_paths = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
    ]
    font = None
    for fp in font_paths:
        if Path(fp).exists():
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for idx in range(1, 26):
        if idx not in labels:
            continue
        text = labels[idx]
        row = (idx - 1) // cols
        col = (idx - 1) % cols
        x0 = col * cell_w
        y0 = row * cell_h
        cx = x0 + cell_w // 2
        cy = y0 + cell_h // 2

        # 获取文字边界框，用于居中
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = cx - tw // 2
        ty = cy - th // 2

        # 红色描边（粗体效果）
        for dx in range(-stroke_width, stroke_width + 1):
            for dy in range(-stroke_width, stroke_width + 1):
                if dx == 0 and dy == 0:
                    continue
                draw.text((tx + dx, ty + dy), text, font=font, fill=(0, 0, 0, 200))
        draw.text((tx, ty), text, font=font, fill=(*color, 255))

    img = Image.alpha_composite(img, overlay)
    img = img.convert("RGB")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG")
    print(f"已保存: {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="在 5×5 宫格图上叠加红色粗体资产名称")
    parser.add_argument(
        "--input",
        type=Path,
        default=PROJECT_ROOT / "output/frames/第2集_EP02_分镜包/grid_25.png",
        help="输入宫格图路径",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="输出路径，默认输入文件同目录 grid_25_labeled.png",
    )
    parser.add_argument(
        "--labels-json",
        type=Path,
        default=None,
        help="自定义标签 JSON：{\"1\": \"xxx\", \"2\": \"yyy\"}，不指定则用内置 SHOT_TO_ASSET",
    )
    args = parser.parse_args()

    in_path = args.input if args.input.is_absolute() else PROJECT_ROOT / args.input
    if not in_path.exists():
        raise SystemExit(f"输入文件不存在: {in_path}")

    if args.labels_json:
        j = json.loads((args.labels_json if args.labels_json.is_absolute() else PROJECT_ROOT / args.labels_json).read_text(encoding="utf-8"))
        labels = {int(k): v for k, v in j.items()}
    else:
        labels = SHOT_TO_ASSET

    out_path = args.output or in_path.parent / "grid_25_labeled.png"
    if not out_path.is_absolute():
        out_path = PROJECT_ROOT / out_path

    add_labels(in_path, out_path, labels)
    print("完成。")


if __name__ == "__main__":
    main()
