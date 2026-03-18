#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
色调板生成脚本

功能：按指定比例将主色、辅色、点缀色、阴影色、过渡色拼接成横屏图，
      每块区域中央标注色号（hex），暗色底用白字、亮色底用黑字。

布局：
  - 左侧 3/4：按 6:3:1 放置主色、辅色、点缀色
  - 右侧 1/4：均分阴影色、过渡色

用法:
    python scripts/grid/gen_palette.py                    # 默认暖色复古
    python scripts/grid/gen_palette.py --preset cold      # 冷调硬切
    python scripts/grid/gen_palette.py -o output/xxx.png
"""

from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    raise SystemExit("请安装 Pillow: pip install Pillow")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# 输出尺寸（横屏 16:9）
OUTPUT_WIDTH = 1920
OUTPUT_HEIGHT = 1080

# 预设色调：(色号, 中文名)
# 暖色复古
PRESET_WARM = [
    ("#B68D6D", "复古褐橙"),  # 主色调
    ("#ACA39A", "绵柔中灰"),  # 辅色调
    ("#FFB380", "透亮暖橙"),  # 点缀色
    ("#4A372B", "深层暗棕"),  # 阴影色
    ("#8E6C51", "暖褐中间调"),  # 过渡色
]

# 低调高反差硬切，冷调偏灰蓝
PRESET_COLD = [
    ("#2A3439", "冷调偏灰蓝"),  # 主色调
    ("#4B5D67", "青灰中间调"),  # 辅色调
    ("#E8ECEF", "银白硬切高光"),  # 点缀色
    ("#0A1115", "死黑偏墨青暗部"),  # 阴影色
    ("#928A85", "肤色偏冷苍白"),  # 过渡色
]

PRESETS = {
    "warm": ("色调.png", PRESET_WARM),
    "cold": ("色调_冷调硬切.png", PRESET_COLD),
}


def _hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    """#RRGGBB -> (r, g, b)"""
    hex_str = hex_str.lstrip("#")
    return tuple(int(hex_str[i : i + 2], 16) for i in (0, 2, 4))


def _luminance(rgb: tuple[int, int, int]) -> float:
    """计算相对亮度，用于判断用黑字还是白字"""
    r, g, b = [x / 255 for x in rgb]
    return 0.299 * r + 0.587 * g + 0.114 * b


def _get_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """加载系统字体"""
    font_paths = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for fp in font_paths:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size)
            except OSError:
                continue
    return ImageFont.load_default()


def gen_palette(
    width: int = OUTPUT_WIDTH,
    height: int = OUTPUT_HEIGHT,
    colors: list[tuple[str, str]] | None = None,
) -> Image.Image:
    """
    生成色调板图片。

    Args:
        width: 画布宽度
        height: 画布高度
        colors: [(hex, 中文名), ...]，需 5 色。None 则用 PRESET_WARM。

    布局：
      - 左侧 3/4（width * 0.75）：6:3:1 -> 主色、辅色、点缀色
      - 右侧 1/4（width * 0.25）：1:1 -> 阴影色、过渡色
    """
    if colors is None:
        colors = PRESET_WARM
    if len(colors) < 5:
        raise ValueError("colors 需至少 5 项")

    img = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    # 左侧宽度与右侧宽度
    left_w = int(width * 0.75)
    right_w = width - left_w

    # 左侧 6:3:1 比例，总和 10
    r6 = int(left_w * 6 / 10)
    r3 = int(left_w * 3 / 10)
    r1 = left_w - r6 - r3  # 最后一格补齐，避免舍入误差
    left_strips = [
        (r6, colors[0][0]),
        (r3, colors[1][0]),
        (r1, colors[2][0]),
    ]

    # 右侧均分
    half_right = right_w // 2
    right_strips = [
        (half_right, colors[3][0]),
        (right_w - half_right, colors[4][0]),
    ]

    # 字体大小
    font_size = max(28, min(width, height) // 40)
    font = _get_font(font_size)

    def draw_label(cx: int, cy: int, label: str, rgb: tuple[int, int, int]) -> None:
        """在 (cx, cy) 中心绘制文本，暗底用白字、亮底用黑字"""
        lum = _luminance(rgb)
        fill = (255, 255, 255) if lum < 0.4 else (0, 0, 0)
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = cx - tw // 2
        ty = cy - th // 2
        draw.text((tx, ty), label, font=font, fill=fill)

    # 绘制左侧三块
    x = 0
    cy = height // 2
    for strip_w, hex_code in left_strips:
        rgb = _hex_to_rgb(hex_code)
        draw.rectangle([x, 0, x + strip_w, height], fill=rgb)
        draw_label(x + strip_w // 2, cy, hex_code, rgb)
        x += strip_w

    # 绘制右侧两块
    for strip_w, hex_code in right_strips:
        rgb = _hex_to_rgb(hex_code)
        draw.rectangle([x, 0, x + strip_w, height], fill=rgb)
        draw_label(x + strip_w // 2, cy, hex_code, rgb)
        x += strip_w

    return img


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="生成 1920×1080 色调板图片")
    parser.add_argument(
        "--preset",
        choices=list(PRESETS),
        default="warm",
        help="预设：warm=暖色复古, cold=冷调硬切",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="输出路径，默认根据 preset 自动命名",
    )
    args = parser.parse_args()

    out_name, colors = PRESETS[args.preset]
    out_path = args.output
    if out_path is None:
        out_path = PROJECT_ROOT / "output" / out_name
    elif not out_path.is_absolute():
        out_path = PROJECT_ROOT / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    img = gen_palette(colors=colors)
    img.save(out_path, "PNG")
    print(f"[OK] 已生成色调板: {out_path}")


if __name__ == "__main__":
    main()
