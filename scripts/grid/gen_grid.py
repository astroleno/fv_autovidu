#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
25 宫格生成脚本：将 shot1-shot25 合成一张 5×5 网格图。

输入：prompt.md（shot 1-25 第一段）、public/assets/ 资产图
输出：1 张 9:16 4K 的 5×5 宫格大图

资产规则：最多 5 人物 + 9 张其它（共 14 张），按「图1是XXX、图2是YYY」映射传入。

用法:
    python scripts/grid/gen_grid.py
    python scripts/grid/gen_grid.py --dry-run
    python scripts/grid/gen_grid.py --model gemini-3-pro-image-preview --image-size 4K
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
YUNWU_BASE = "https://yunwu.ai/v1beta/models"

# shot 1-25 涉及的资产：人物最多 5，其余最多 9，顺序即「图1是XXX」的图序
ASSETS_ORDER = [
    # 5 人物（shot 1-25 主要涉及）
    "格雷·金斯顿",
    "达里尔",
    "卡尔",
    "瑞克",
    "赫谢尔",
    # 9 其它（场景/道具）
    "汽车",
    "汽车内部",
    "监狱外围",
    "监狱公共区",
    "牢房内部",
    "医药箱",
    "武器",
    "行尸",
    "滑轮系统",
]
# 人物名集合，用于区分人物与场景/道具
CHAR_NAMES = {"格雷·金斯顿", "达里尔", "卡尔", "瑞克", "赫谢尔", "格伦", "卡罗尔", "贝丝", "玛格丽特", "朱迪斯"}


def resolve_asset_path(assets_dir: Path, name: str) -> Path | None:
    """解析资产文件路径，支持 .png .jpg .jpeg。"""
    for ext in (".png", ".jpg", ".jpeg"):
        p = assets_dir / f"{name}{ext}"
        if p.exists():
            return p
    return None


def read_image_as_base64(path: Path) -> tuple[str, str]:
    """读取图片为 base64，返回 (mime_type, base64_str)。"""
    data = path.read_bytes()
    b64 = base64.standard_b64encode(data).decode("ascii")
    ext = path.suffix.lower()
    mime = "image/png" if ext == ".png" else "image/jpeg"
    return mime, b64


def _get_font(size: int) -> "ImageFont.FreeTypeFont | ImageFont.ImageFont":
    """加载支持中文的字体。"""
    try:
        from PIL import ImageFont
    except ImportError:
        raise SystemExit("请安装 Pillow: pip install Pillow")
    for fp in [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/STHeiti Light.ttc",
    ]:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size)
            except OSError:
                continue
    return ImageFont.load_default()


def label_asset_image(img_path: Path, label: str, out_path: Path) -> Path:
    """
    在单张资产图正中间叠加红色粗体资产名称，保存为 PNG。
    返回输出路径。
    """
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        raise SystemExit("请安装 Pillow: pip install Pillow")
    img = Image.open(img_path).convert("RGBA")
    w, h = img.size
    font_size = max(24, min(w, h) // 8)
    font = _get_font(font_size)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (w - tw) // 2
    ty = (h - th) // 2
    stroke = max(2, font_size // 12)
    for dx in range(-stroke, stroke + 1):
        for dy in range(-stroke, stroke + 1):
            if dx or dy:
                draw.text((tx + dx, ty + dy), label, font=font, fill=(0, 0, 0, 220))
    draw.text((tx, ty), label, font=font, fill=(255, 0, 0, 255))
    out = Image.alpha_composite(img, overlay).convert("RGB")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(out_path, "PNG")
    return out_path


def select_assets_for_grid(
    assets_dir: Path,
    max_chars: int = 5,
    max_others: int = 9,
) -> tuple[list[tuple[str, Path]], list[tuple[str, Path]]]:
    """
    从 ASSETS_ORDER 选取存在的资产，人物最多 max_chars，其余最多 max_others。
    返回 (人物列表, 其它列表)，每项 (资产名, 路径)。
    """
    chars: list[tuple[str, Path]] = []
    others: list[tuple[str, Path]] = []
    for name in ASSETS_ORDER:
        p = resolve_asset_path(assets_dir, name)
        if not p:
            continue
        if name in CHAR_NAMES:
            if len(chars) < max_chars:
                chars.append((name, p))
        else:
            if len(others) < max_others:
                others.append((name, p))
    return chars, others


def build_image_mapping(chars: list[tuple[str, Path]], others: list[tuple[str, Path]]) -> str:
    """生成「图1是XXX，图2是YYY」的映射文案。"""
    ordered = [name for name, _ in chars] + [name for name, _ in others]
    return "，".join(f"图{i+1}是{name}" for i, name in enumerate(ordered))


def parse_episode_prompt_md(prompt_path: Path) -> list[dict]:
    """解析 prompt.md，返回 [{"shot": 1, "time": "0-4s", "image_prompt": "...", "video_prompt": "..."}, ...]。"""
    text = prompt_path.read_text(encoding="utf-8")
    result: list[dict] = []
    parts = re.split(r"# Shot (\d+)\s*\n", text)
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


def load_grid_prompt_template(template_path: Path) -> str:
    """从 prompt/GridPrompt.md 提取 ---System--- 到下一个 --- 之间的内容作为主 prompt。"""
    if not template_path.exists():
        return ""
    text = template_path.read_text(encoding="utf-8")
    m = re.search(r"## ---System---\s*\n(.*?)(?=\n---\s*\n)", text, re.DOTALL)
    return m.group(1).strip() if m else ""


def build_grid_prompt(
    template: str,
    asset_list: str,
    shot_prompts: list[str],
    image_mapping: str,
    *,
    rows: int = 5,
    cols: int = 5,
    shot_start: int = 1,
) -> str:
    """
    拼出宫格生成 prompt。
    shot_prompts: 所有 shot 的 image_prompt；按 shot_start 取连续 rows*cols 个。
    """
    n = rows * cols
    prompt = template.replace("{assetList}", asset_list)
    # 替换网格尺寸相关描述
    prompt = prompt.replace("5 行 × 5 列", f"{rows} 行 × {cols} 列")
    prompt = prompt.replace("25 个等尺寸格子", f"{n} 个等尺寸格子")
    prompt = re.sub(r"5×5", f"{rows}×{cols}", prompt)
    prompt = prompt.replace("shot1 到 shot25", f"shot{shot_start} 到 shot{shot_start + n - 1}")
    prompt = prompt.replace("shot1到shot25", f"shot{shot_start}到shot{shot_start + n - 1}")
    # 追加各格画面要求（shot_prompts 已是该组的切片，索引从 0 起）
    prompt += "\n\n"
    for i in range(1, n + 1):
        p = shot_prompts[i - 1] if i - 1 < len(shot_prompts) else ""
        prompt += f"- 格{i} (shot{shot_start + i - 1})：{p}\n"
    prompt += f"\n\n{image_mapping}。"
    return prompt


def call_yunwu_grid(
    api_key: str,
    text: str,
    asset_images: list[tuple[str, str]],
    *,
    model: str = "gemini-3-pro-image-preview",
    aspect_ratio: str = "9:16",
    image_size: str = "4K",
) -> bytes:
    """
    调用 yunwu generateContent，传入提示词 + 资产图，返回生成的 5×5 宫格图二进制。
    asset_images: [(mime, base64), ...]，顺序与「图1、图2...」严格对应。
    """
    parts: list[dict] = [{"text": text}]
    for mime, b64 in asset_images:
        parts.append({
            "inline_data": {"mime_type": mime, "data": b64},
        })
    endpoint = f"{YUNWU_BASE}/{model}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
                "imageSize": image_size,
            },
        },
    }
    # 25 宫格生成耗时可能长达 30 分钟，需足够超时
    resp = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=2100,  # 35 分钟，覆盖约 30 分钟的典型耗时
    )
    resp.raise_for_status()
    data = resp.json()
    cands = data.get("candidates", [])
    if not cands:
        raise RuntimeError(f"API 未返回候选: {json.dumps(data, ensure_ascii=False)[:500]}")
    for part in cands[0].get("content", {}).get("parts", []):
        if "inlineData" in part:
            b64_str = part["inlineData"].get("data")
            if b64_str:
                return base64.standard_b64decode(b64_str)
    raise RuntimeError("API 返回中未找到图片数据")


def load_env_key() -> str:
    from os import environ
    key = environ.get("YUNWU_API_KEY")
    if not key:
        raise SystemExit("请在 .env 中配置 YUNWU_API_KEY")
    return key.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="25 宫格生成：shot1-25 合成一张 5×5 网格图")
    parser.add_argument(
        "--episode-dir",
        type=Path,
        default=PROJECT_ROOT / "output/frames/第2集_EP02_分镜包",
        help="分镜包目录（含 prompt.md）",
    )
    parser.add_argument(
        "--assets-dir",
        type=Path,
        default=PROJECT_ROOT / "public/assets",
        help="资产图目录",
    )
    parser.add_argument(
        "--template",
        type=Path,
        default=PROJECT_ROOT / "prompt/GridPrompt.md",
        help="GridPrompt 模板路径",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="输出文件路径，默认 episode_dir/grid_25.png",
    )
    parser.add_argument(
        "--model",
        default="gemini-3-pro-image-preview",
        help="yunwu 模型名",
    )
    parser.add_argument(
        "--image-size",
        default="4K",
        choices=["1K", "2K", "4K"],
        help="输出图片尺寸",
    )
    parser.add_argument(
        "--grid-size",
        type=int,
        default=25,
        choices=[9, 25],
        help="宫格尺寸：9=3×3，25=5×5",
    )
    parser.add_argument(
        "--groups",
        type=str,
        default=None,
        metavar="1,2",
        help="分组模式：1=shot1-9，2=shot10-18。如 1,2 则两组各生成 --concurrent 张",
    )
    parser.add_argument(
        "--label-assets",
        action="store_true",
        help="先在资产图正中央叠加红色粗体资产名称，再作为参考图上传",
    )
    parser.add_argument(
        "--concurrent",
        type=int,
        default=1,
        metavar="N",
        help="并发生成 N 张图，输出为 grid_25_1.png、grid_25_2.png 等。资产自动带 label",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅打印 prompt 和资产映射，不调用 API",
    )
    args = parser.parse_args()

    episode_dir = args.episode_dir if args.episode_dir.is_absolute() else PROJECT_ROOT / args.episode_dir
    assets_dir = args.assets_dir if args.assets_dir.is_absolute() else PROJECT_ROOT / args.assets_dir
    template_path = args.template if args.template.is_absolute() else PROJECT_ROOT / args.template

    prompt_path = episode_dir / "prompt.md"
    if not prompt_path.exists():
        raise SystemExit(f"prompt 不存在: {prompt_path}")

    # 1. 选取资产，构建图序映射
    chars, others = select_assets_for_grid(assets_dir)
    all_assets = chars + others
    if not all_assets:
        raise SystemExit(f"未找到可用资产，请检查 {assets_dir}")

    image_mapping = build_image_mapping(chars, others)
    asset_list = "、".join(name for name, _ in all_assets)

    # 2. 解析 prompt 并确定 shot 范围
    blocks = parse_episode_prompt_md(prompt_path)
    all_prompts = {b["shot"]: b["image_prompt"] for b in blocks}
    grid_size = args.grid_size
    rows, cols = (3, 3) if grid_size == 9 else (5, 5)
    n_per_grid = rows * cols

    if args.groups:
        # 分组模式：如 1,2 → group1: shot1-9, group2: shot10-18
        group_defs = {
            1: (1, 9),
            2: (10, 18),
        }
        group_ids = [int(x.strip()) for x in args.groups.split(",") if x.strip()]
        tasks: list[tuple[int, int, int]] = []  # (group_id, shot_start, shot_end)
        for gid in group_ids:
            if gid not in group_defs:
                raise SystemExit(f"未知 group: {gid}，支持 1,2")
            s, e = group_defs[gid]
            tasks.append((gid, s, e))
    else:
        # 单组：默认 shot 1 起取 n_per_grid 个
        tasks = [(0, 1, min(1 + n_per_grid - 1, len(all_prompts)))]

    # 校验 shot 覆盖
    shot_prompts = [all_prompts.get(i, "") for i in range(1, max(e for _, _, e in tasks) + 1)]
    for gid, s, e in tasks:
        for i in range(s, e + 1):
            if i > len(shot_prompts) or not shot_prompts[i - 1]:
                raise SystemExit(f"shot {i} 无 prompt")

    # 3. 加载模板
    template = load_grid_prompt_template(template_path)

    # 4. 若启用 --label-assets 或 --concurrent>1（并发时强制带 label），先对每张资产图叠加红色粗体名称
    if args.label_assets or args.concurrent > 1:
        labeled_dir = episode_dir / "assets_labeled"
        labeled_dir.mkdir(parents=True, exist_ok=True)
        resolved: list[tuple[str, Path]] = []
        for name, p in all_assets:
            out_p = labeled_dir / f"{name}.png"
            label_asset_image(p, name, out_p)
            resolved.append((name, out_p))
        all_assets = resolved
        print(f"  已标注 {len(all_assets)} 张资产图 -> {labeled_dir}")

    # 5. 读取资产图为 base64
    asset_b64 = [read_image_as_base64(p) for _, p in all_assets]

    def _build_prompt_for_group(shot_start: int, shot_end: int) -> str:
        slice_prompts = [all_prompts.get(i, "") for i in range(shot_start, shot_end + 1)]
        return build_grid_prompt(
            template, asset_list, slice_prompts, image_mapping,
            rows=rows, cols=cols, shot_start=shot_start,
        )

    # 构建每组任务：(group_id, prompt, output_paths)
    run_tasks: list[tuple[int, str, list[Path]]] = []
    base_out = args.output or (episode_dir / f"grid_{grid_size}.png")
    if not base_out.is_absolute():
        base_out = PROJECT_ROOT / base_out
    base_out.parent.mkdir(parents=True, exist_ok=True)
    stem, ext = base_out.stem, base_out.suffix
    parent = base_out.parent

    for gid, shot_start, shot_end in tasks:
        fp = _build_prompt_for_group(shot_start, shot_end)
        n = args.concurrent
        if n <= 1:
            out_paths = [parent / f"{stem}_g{gid}{ext}" if gid else base_out]
        else:
            out_paths = [parent / f"{stem}_g{gid}_{i}{ext}" for i in range(1, n + 1)]
        run_tasks.append((gid, fp, out_paths))

    if args.dry_run:
        print("=== 图序映射 ===")
        print(image_mapping)
        print("\n=== 资产列表 ===")
        print(asset_list)
        for gid, fp, paths in run_tasks:
            print(f"\n=== Group {gid} Prompt ===")
            print(fp[:800] + "..." if len(fp) > 800 else fp)
            print(f"  输出: {[p.name for p in paths]}")
        print("\n[DryRun] 未调用 API")
        return

    # 6. 调用 API（每组并发）
    api_key = load_env_key()
    total = sum(len(paths) for _, _, paths in run_tasks)
    print(f"[Run] 调用 {args.model}，生成 {len(run_tasks)} 组 × {args.concurrent} 张 = {total} 张 {rows}×{cols} 宫格 ({args.image_size} 9:16) ...")
    if args.concurrent > 1 or args.groups:
        print("      资产已带 label")
    print("      提示：单张可能需 20–30 分钟，请耐心等待。")

    def _run_one(idx: int, out_p: Path, prompt: str) -> None:
        img_data = call_yunwu_grid(
            api_key,
            prompt,
            asset_b64,
            model=args.model,
            aspect_ratio="9:16",
            image_size=args.image_size,
        )
        out_p.write_bytes(img_data)
        print(f"  [{idx}] -> {out_p}")

    all_futures: list[tuple] = []
    with ThreadPoolExecutor(max_workers=total) as ex:
        job_id = 0
        for gid, fp, paths in run_tasks:
            for i, p in enumerate(paths, 1):
                job_id += 1
                all_futures.append((ex.submit(_run_one, job_id, p, fp), job_id, p))
        for fut, jid, p in all_futures:
            try:
                fut.result()
            except Exception as e:
                print(f"  [{jid}] [Error] {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
