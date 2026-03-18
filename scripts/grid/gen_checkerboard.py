#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
棋盘格占位图生成脚本

功能：生成 1080×1920 的黑白交替棋盘格图片，
      每个格子中心用反色文字显示 shot_01 ~ shot_xx。

用途：分镜占位、网格布局预览、视频 shot 序号示意等。

用法:
    python scripts/grid/gen_checkerboard.py                    # 默认 4×4
    python scripts/grid/gen_checkerboard.py --rows 5 --cols 5 # 5×5 宫格
    python scripts/grid/gen_checkerboard.py -o output/checkerboard.png
"""

from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    raise SystemExit("请安装 Pillow: pip install Pillow")

# 项目根（scripts/grid/ 上两级）
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# 默认输出尺寸（竖屏 9:16）
OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920

# 默认网格行列数
ROWS = 4
COLS = 4

# 颜色定义 (R, G, B)
COLOR_WHITE = (255, 255, 255)
COLOR_BLACK = (0, 0, 0)


def _get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """
    加载字体，优先使用系统自带无衬线字体。
    支持 macOS、Linux、Windows 常见路径。
    """
    font_paths = [
        # macOS
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        # Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        # Windows (示例)
        "C:/Windows/Fonts/arial.ttf",
    ]
    for fp in font_paths:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size)
            except OSError:
                continue
    return ImageFont.load_default()


def gen_checkerboard(
    width: int = OUTPUT_WIDTH,
    height: int = OUTPUT_HEIGHT,
    rows: int = ROWS,
    cols: int = COLS,
) -> Image.Image:
    """
    生成棋盘格占位图。

    Args:
        width: 画布宽度（像素）
        height: 画布高度（像素）
        rows: 行数
        cols: 列数

    Returns:
        PIL.Image 对象（RGB 模式）
    """
    img = Image.new("RGB", (width, height), COLOR_WHITE)
    draw = ImageDraw.Draw(img)

    # 每个格子的宽高
    cell_w = width // cols
    cell_h = height // rows

    # 字体大小：取格子较小边的约 1/8，确保 shot_xx 能放下
    font_size = max(20, min(cell_w, cell_h) // 8)
    font = _get_font(font_size)

    grid_count = rows * cols
    for idx in range(grid_count):
        row = idx // cols
        col = idx % cols

        # 棋盘格：行列下标和为偶数则白色，奇数则黑色
        is_white = (row + col) % 2 == 0
        fill_color = COLOR_WHITE if is_white else COLOR_BLACK
        text_color = COLOR_BLACK if is_white else COLOR_WHITE

        # 格子左上角与右下角坐标
        x1 = col * cell_w
        y1 = row * cell_h
        x2 = x1 + cell_w
        y2 = y1 + cell_h

        # 绘制格子填充
        draw.rectangle([x1, y1, x2, y2], fill=fill_color)

        # 生成文本 shot_xx（01 ~ grid_count）
        label = f"shot_{idx + 1:02d}"

        # 获取文本边界框，用于居中对齐
        bbox = draw.textbbox((0, 0), label, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

        # 格子中心
        center_x = x1 + cell_w // 2
        center_y = y1 + cell_h // 2

        # 文字左上角（使文字中心与格子中心重合）
        text_x = center_x - text_w // 2
        text_y = center_y - text_h // 2

        draw.text((text_x, text_y), label, font=font, fill=text_color)

    return img


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="生成 1080×1920 的棋盘格占位图（shot_01 ~ shot_xx）"
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=ROWS,
        help="行数（默认 4）",
    )
    parser.add_argument(
        "--cols",
        type=int,
        default=COLS,
        help="列数（默认 4）",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=None,
        help="输出 PNG 路径（默认根据宫格数自动命名）",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=OUTPUT_WIDTH,
        help="画布宽度",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=OUTPUT_HEIGHT,
        help="画布高度",
    )
    args = parser.parse_args()

    if args.output is None:
        n = args.rows * args.cols
        out_path = PROJECT_ROOT / f"output/checkerboard_{n}.png"
    else:
        out_path = args.output if args.output.is_absolute() else PROJECT_ROOT / args.output
    out_path.parent.mkdir(parents=True, exist_ok=True)

    img = gen_checkerboard(
        width=args.width,
        height=args.height,
        rows=args.rows,
        cols=args.cols,
    )
    img.save(out_path, "PNG")
    print(f"[OK] 已生成棋盘格 {args.rows}×{args.cols}: {out_path}")


if __name__ == "__main__":
    main()
