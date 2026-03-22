#!/usr/bin/env python3
"""
尾帧生成脚本：基于首帧图 + 终态提示词 + 可选资产图，调用 yunwu Gemini 生成尾帧。

用法:
    # 传统模式（prompt.md + assets_by_shot.json）
    python scripts/endframe/gen_tail.py
    python scripts/endframe/gen_tail.py --shots 1
    python scripts/endframe/gen_tail.py --dry-run

    # episode.json 模式（平台拉取数据）
    python scripts/endframe/gen_tail.py --from-json data/proj/ep02/episode.json --shots 1,2,3
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

# 确保项目根在 path 中
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# 加载 .env
try:
    from dotenv import load_dotenv
    load_dotenv(_PROJECT_ROOT / ".env")
except ImportError:
    pass

import requests


# yunwu Gemini 图生图端点
YUNWU_BASE = "https://yunwu.ai/v1beta/models"
MODEL = "gemini-3.1-flash-image-preview"
ENDPOINT = f"{YUNWU_BASE}/{MODEL}:generateContent"

# 默认提示词模板（当 prompt/EndFramePromp.md 不存在时回退）
DEFAULT_TAIL_PROMPT_TEMPLATE = """请基于提供的首帧参考图，生成同一镜头结束瞬间的静态尾帧。

要求：
- 保持与首帧一致的角色身份、服装、发型、道具、场景和时间氛围
- 输出必须是镜头结束瞬间的单张静态画面，不要表现运动轨迹
- 补足尾帧中应该清晰可见、但首帧中不完整或未出现的关键资产
- 保持构图、镜头语言和光线连续
- 不要生成字幕或额外文字

首帧画面描述：
{image_prompt}

镜头终态信息：
{video_prompt}

需要重点保持：
角色一致性、伤口位置、服装连续性、光线方向、景别稳定
"""


def load_prompt_template(template_path: Path) -> str:
    """
    从 prompt/EndFramePromp.md 加载提示词模板。
    提取 ---System--- 与 ---User--- 之间的内容，作为主 prompt；
    替换 {assetList}、{image_prompt}、{video_prompt_line}、{角色一致性/伤口位置/道具位置/光线方向/景别}。
    """
    if not template_path.exists():
        return DEFAULT_TAIL_PROMPT_TEMPLATE
    text = template_path.read_text(encoding="utf-8")
    m = re.search(r"---System---\s*\n(.*?)(?=---User---|---Schema---|$)", text, re.DOTALL)
    if not m:
        return DEFAULT_TAIL_PROMPT_TEMPLATE
    return m.group(1).strip()


def load_env_key() -> str:
    """从 .env 读取 YUNWU_API_KEY。"""
    from os import environ
    key = environ.get("YUNWU_API_KEY")
    if not key:
        raise SystemExit("请在 .env 中配置 YUNWU_API_KEY")
    return key.strip()


def parse_episode_prompt_md(prompt_path: Path) -> list[tuple[str, str, str]]:
    """
    解析 episode 级 prompt.md（含 # Shot N）。
    每段：时间戳 / image_prompt / video_prompt（ Shot 15 等可能只有 2 行）
    """
    text = prompt_path.read_text(encoding="utf-8")
    blocks: list[tuple[str, str, str]] = []
    parts = re.split(r"# Shot \d+\s*\n", text)
    for blk in parts:
        if not blk.strip():
            continue
        lines = [ln.strip() for ln in blk.split("\n") if ln.strip()]
        if len(lines) >= 2:
            time_line = lines[0]
            image_prompt = lines[1]
            video_prompt = lines[2] if len(lines) > 2 else lines[1]
            blocks.append((time_line, image_prompt, video_prompt))
    return blocks


def parse_prompt_md(prompt_path: Path) -> list[tuple[str, str, str]]:
    """
    解析 prompt.md，每个 shot 返回 (time, image_prompt, video_prompt)。
    格式：每块 3 行 = 时间戳、image_prompt、video_prompt。
    """
    text = prompt_path.read_text(encoding="utf-8")
    blocks: list[tuple[str, str, str]] = []
    # 按 时间行（0-4s 等）分段
    parts = re.split(r"(?m)^(\d+(?:-\d+)?s?)\s*\n", text)
    # parts[0] 可能是空或前置内容，之后是 [time1, content1, time2, content2, ...]
    i = 1
    while i + 1 < len(parts):
        time_line = parts[i].strip()
        content = parts[i + 1].strip()
        i += 2
        lines = [ln.strip() for ln in content.split("\n") if ln.strip()]
        if len(lines) >= 2:
            image_prompt = lines[0]
            video_prompt = lines[1]
        elif len(lines) == 1:
            image_prompt = lines[0]
            video_prompt = ""
        else:
            continue
        blocks.append((time_line, image_prompt, video_prompt))
    return blocks


# 复用 src.yunwu.client 中的函数（避免重复）
def _get_yunwu():
    from src.yunwu.client import call_yunwu, read_image_as_base64, resolve_asset_path, select_assets
    return call_yunwu, read_image_as_base64, resolve_asset_path, select_assets


def resolve_asset_path(assets_dir: Path, name: str) -> Path | None:
    """解析资产文件路径，支持 .png 和 .jpg。"""
    _, _, resolve, _ = _get_yunwu()
    return resolve(assets_dir, name)


def read_image_as_base64(path: Path) -> tuple[str, str]:
    """读取图片为 base64。"""
    _, read_img, _, _ = _get_yunwu()
    return read_img(path)


def select_assets(
    asset_names: list[str],
    assets_dir: Path,
    max_count: int = 2,
) -> list[Path]:
    """从资产名列表选取最多 max_count 个图片路径。"""
    _, _, _, sel = _get_yunwu()
    return sel(asset_names, assets_dir, max_count)


def build_tail_prompt(
    template: str,
    image_prompt: str,
    video_prompt: str,
    asset_names: list[str],
) -> str:
    """
    用模板拼出尾帧任务的文本 prompt。
    asset_names: 本 shot 使用的资产名列表，用于 {assetList} 和图序说明。
    """
    continuity = "角色一致性、伤口位置、道具位置、光线方向、景别"
    asset_list = "、".join(asset_names) if asset_names else "无"
    prompt = template.replace("{assetList}", asset_list)
    prompt = prompt.replace("{image_prompt}", image_prompt)
    prompt = prompt.replace("{video_prompt_line}", video_prompt)
    prompt = prompt.replace("{角色一致性/伤口位置/道具位置/光线方向/景别}", continuity)
    # 双大括号 placeholder（若模板中有）
    prompt = prompt.replace("{{image_prompt}}", image_prompt)
    prompt = prompt.replace("{{video_prompt_line}}", video_prompt)
    prompt = prompt.replace("{{角色一致性/伤口位置/道具位置/光线方向/景别}}", continuity)
    if asset_names:
        if len(asset_names) == 1:
            prompt += f"\n\n图一为首帧图，图二为{asset_names[0]}资产。"
        else:
            prompt += f"\n\n图一为首帧图，图二为{asset_names[0]}资产，图三为{asset_names[1]}资产。"
    else:
        prompt += "\n\n图一为首帧图。"
    return prompt


def call_yunwu(
    api_key: str,
    text: str,
    first_frame_b64: tuple[str, str],
    asset_images: list[tuple[str, str]],
    *,
    endpoint: str | None = None,
    aspect_ratio: str = "9:16",
    image_size: str = "2K",
) -> bytes:
    """调用 yunwu generateContent，返回生成的图片二进制。"""
    call_fn, _, _, _ = _get_yunwu()
    return call_fn(
        api_key, text, first_frame_b64, asset_images,
        endpoint=endpoint, aspect_ratio=aspect_ratio, image_size=image_size,
    )


def _parse_shot_numbers(shots_spec: str) -> list[int] | None:
    """
    解析 --shots 字符串。
    返回 None 表示不限制（处理全部在 JSON 中出现的镜头编号）；
    返回列表表示仅处理这些 shotNumber。
    """
    s = (shots_spec or "").strip()
    if not s:
        return None
    if "-" in s and "," not in s:
        lo, hi = map(int, s.split("-", 1))
        return list(range(lo, hi + 1))
    return [int(x.strip()) for x in s.split(",") if x.strip()]


@dataclass
class TailShotResult:
    """单镜头尾帧生成结果（供流水线 / CLI 汇总）。"""

    shot_number: int
    shot_id: str
    ok: bool
    stage: Literal["skip", "dry_run", "tail", "error"]
    message: str = ""


@dataclass
class TailFromJsonResult:
    """episode.json 模式批量尾帧的整体结果。"""

    json_path: Path
    results: list[TailShotResult] = field(default_factory=list)

    @property
    def ok_count(self) -> int:
        return sum(1 for r in self.results if r.ok)

    @property
    def fail_count(self) -> int:
        return sum(1 for r in self.results if not r.ok)


def run_tail_from_json_episode(
    *,
    json_path: Path,
    shots_spec: str = "",
    prompt_template: Path | None = None,
    model: str = "gemini-3.1-flash-image-preview",
    image_size: str = "2K",
    dry_run: bool = False,
    retry: bool = False,
    fail_fast: bool = False,
    quiet: bool = False,
) -> TailFromJsonResult:
    """
    从 episode.json 批量生成尾帧（可导入，供 full_pipeline / 测试复用）。

    Args:
        json_path: episode.json 绝对路径或相对 cwd 的路径。
        shots_spec: 与 CLI --shots 相同，如 "1,2,3" 或 "1-10"；空字符串表示全部镜头。
        prompt_template: 尾帧模板路径；默认 prompt/EndFramePromp.md 相对 cwd。
        其余参数与 CLI 一致。
        quiet: 为 True 时不 print，仅返回结果结构。

    Returns:
        TailFromJsonResult：含每镜结果列表，便于流水线汇总与验收。
    """
    jp = json_path if json_path.is_absolute() else Path.cwd() / json_path
    if not jp.exists():
        raise FileNotFoundError(f"episode.json 不存在: {jp}")
    tpl = prompt_template
    if tpl is None:
        tpl = Path.cwd() / "prompt/EndFramePromp.md"
    elif not tpl.is_absolute():
        tpl = Path.cwd() / tpl

    data = json.loads(jp.read_text(encoding="utf-8"))
    episode_dir = jp.parent
    endframes_dir = episode_dir / "endframes"
    endframes_dir.mkdir(parents=True, exist_ok=True)
    api_key = load_env_key()
    call_fn, read_img, _, _ = _get_yunwu()
    prompt_template_str = load_prompt_template(tpl)
    shot_nums_filter = _parse_shot_numbers(shots_spec)
    out = TailFromJsonResult(json_path=jp)

    scene_list = data.get("scenes", [])
    for scene in scene_list:
        for shot in scene.get("shots", []):
            num = shot.get("shotNumber", 0)
            shot_id = str(shot.get("shotId", ""))
            if shot_nums_filter is not None and num not in shot_nums_filter:
                continue
            first_rel = shot.get("firstFrame", f"frames/S{num:02d}.png")
            first_path = episode_dir / first_rel
            if not first_path.exists():
                msg = f"首帧不存在 {first_rel}"
                if not quiet:
                    print(f"[Skip] Shot {num}: {msg}")
                out.results.append(TailShotResult(num, shot_id, False, "skip", msg))
                continue
            end_rel = f"endframes/S{num:02d}_end.png"
            end_path = episode_dir / end_rel
            if end_path.exists() and not retry:
                msg = f"{end_rel} 已存在，用 retry 覆盖"
                if not quiet:
                    print(f"[Skip] Shot {num}: {msg}")
                out.results.append(TailShotResult(num, shot_id, True, "skip", msg))
                continue
            image_prompt = shot.get("imagePrompt", "")
            video_prompt = shot.get("videoPrompt", "")
            assets = shot.get("assets", [])
            asset_paths = []
            asset_names = []
            for a in assets[:2]:
                lp = a.get("localPath", "")
                name = a.get("name", "")
                if lp:
                    p = episode_dir / lp
                    if p.exists():
                        asset_paths.append(p)
                        asset_names.append(name)
            prompt_text = build_tail_prompt(
                prompt_template_str, image_prompt, video_prompt, asset_names
            )
            first_b64 = read_img(first_path)
            asset_b64_list = [read_img(p) for p in asset_paths]
            if dry_run:
                if not quiet:
                    print(f"[DryRun] Shot {num}: {first_rel} -> {end_rel}")
                out.results.append(TailShotResult(num, shot_id, True, "dry_run", end_rel))
                continue
            endpoint = f"{YUNWU_BASE}/{model}:generateContent"
            if not quiet:
                print(f"[Run] Shot {num}: {first_rel} -> {end_rel} ({model}) ...")
            try:
                img_data = call_fn(
                    api_key, prompt_text, first_b64, asset_b64_list,
                    endpoint=endpoint, aspect_ratio="9:16", image_size=image_size,
                )
                end_path.write_bytes(img_data)
                for s in scene["shots"]:
                    if s.get("shotNumber") == num:
                        s["endFrame"] = end_rel
                        s["status"] = "endframe_done"
                        break
                with open(jp, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                if not quiet:
                    print(f"  -> {end_path}")
                out.results.append(TailShotResult(num, shot_id, True, "tail", end_rel))
            except Exception as e:
                err = str(e)
                if not quiet:
                    print(f"  [Error] {err}", file=sys.stderr)
                out.results.append(TailShotResult(num, shot_id, False, "error", err))
                if fail_fast:
                    raise
    return out


def run_from_json(args) -> None:
    """从 episode.json 读取数据，批量生成尾帧（CLI 入口，内部调用 run_tail_from_json_episode）。"""
    json_path = args.from_json if args.from_json.is_absolute() else Path.cwd() / args.from_json
    run_tail_from_json_episode(
        json_path=json_path,
        shots_spec=args.shots,
        prompt_template=args.prompt_template,
        model=args.model,
        image_size=args.image_size,
        dry_run=args.dry_run,
        retry=args.retry,
        fail_fast=args.fail_fast,
        quiet=False,
    )


def get_shot_to_frame(episode_dir: Path) -> list[tuple[str, str]]:
    """
    Shot 1,2,3... → (group_xx, S0n.png) 映射。
    规则：Shot 1-3 → group_01/S01-S03，Shot 4-6 → group_02/S01-S03，依此类推。
    优先 .png，无则取 .jpg。
    """
    mapping = []
    for group_dir in sorted(
        (d for d in episode_dir.iterdir() if d.is_dir() and d.name.startswith("group_")),
        key=lambda p: p.name,
    ):
        frames = {f.stem: f.name for f in group_dir.glob("S*.jpg")}
        for f in group_dir.glob("S*.png"):
            frames[f.stem] = f.name
        for stem in sorted(frames.keys(), key=lambda s: (len(s), s)):
            mapping.append((group_dir.name, frames[stem]))
    return mapping


def main() -> None:
    parser = argparse.ArgumentParser(description="尾帧生成：首帧 + 提示词 → yunwu → 尾帧图")
    parser.add_argument(
        "--group-dir",
        type=Path,
        default=None,
        help="group 目录（单 group 模式），内含 S01.png、prompt.md",
    )
    parser.add_argument(
        "--episode-dir",
        type=Path,
        default=Path("output/frames/第2集_EP02_分镜包"),
        help="episode 目录（跨 group 模式），与 --shots 联用可处理 shot 1-10 等",
    )
    parser.add_argument(
        "--shots",
        default="1,2,3",
        help="要处理的 shot 编号，逗号分隔，如 1,2,3 或 1-10",
    )
    parser.add_argument(
        "--prompt-template",
        type=Path,
        default=Path("prompt/EndFramePromp.md"),
        help="尾帧提示词模板文件",
    )
    parser.add_argument(
        "--assets-json",
        type=Path,
        default=None,
        help="assets_by_shot.json 路径，默认 episode_dir 下",
    )
    parser.add_argument(
        "--assets-dir",
        type=Path,
        default=Path("public/assets"),
        help="资产图目录",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅打印将要执行的请求，不实际调用 API",
    )
    parser.add_argument(
        "--model",
        default="gemini-3.1-flash-image-preview",
        help="yunwu 模型名，如 gemini-3-pro-image-preview、gemini-3.1-flash-image-preview",
    )
    parser.add_argument(
        "--image-size",
        default="2K",
        choices=["1K", "2K", "4K"],
        help="输出图片尺寸，4K 需模型支持",
    )
    parser.add_argument(
        "--retry",
        action="store_true",
        help="覆盖已存在的尾帧，重新生成",
    )
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        help="遇错立即退出，默认继续下一个 shot",
    )
    parser.add_argument(
        "--from-json",
        type=Path,
        default=None,
        help="episode.json 路径，启用 episode.json 模式（从平台拉取的数据）",
    )
    args = parser.parse_args()

    # ---- episode.json 模式 ----
    if args.from_json:
        run_from_json(args)
        return

    # 解析 shots：支持 "1,2,3" 或 "1-10"
    shot_str = args.shots.strip()
    if "-" in shot_str and "," not in shot_str:
        lo, hi = map(int, shot_str.split("-", 1))
        shot_nums = list(range(lo, hi + 1))
    else:
        shot_nums = [int(s.strip()) for s in shot_str.split(",") if s.strip()]
    if not shot_nums:
        raise SystemExit("--shots 至少指定一个编号")

    episode_dir = args.episode_dir if args.episode_dir.is_absolute() else Path.cwd() / args.episode_dir
    assets_dir = args.assets_dir if args.assets_dir.is_absolute() else Path.cwd() / args.assets_dir
    template_path = args.prompt_template if args.prompt_template.is_absolute() else Path.cwd() / args.prompt_template
    assets_json_path = args.assets_json or (episode_dir / "assets_by_shot.json")
    if not assets_json_path.is_absolute():
        assets_json_path = Path.cwd() / assets_json_path

    # 加载提示词模板
    prompt_template = load_prompt_template(template_path)

    # 模式：单 group 或 episode 跨 group
    if args.group_dir:
        group_dir = args.group_dir if args.group_dir.is_absolute() else Path.cwd() / args.group_dir
        prompt_path = group_dir / "prompt.md"
        blocks = parse_prompt_md(prompt_path)
        shot_to_frame = [(group_dir.name, f"S{i:02d}") for i in range(1, len(blocks) + 1)]
        base_dir = group_dir.parent
    else:
        base_dir = episode_dir
        prompt_path = episode_dir / "prompt.md"
        if not prompt_path.exists():
            raise SystemExit(f"prompt 不存在: {prompt_path}")
        blocks = parse_episode_prompt_md(prompt_path)
        shot_to_frame = get_shot_to_frame(episode_dir)

    if len(blocks) < max(shot_nums):
        raise SystemExit(f"prompt 仅 {len(blocks)} 个 shot，无法处理 {shot_nums}")

    shot_assets: dict[str, list[str]] = {}
    if assets_json_path.exists():
        shot_assets = json.loads(assets_json_path.read_text(encoding="utf-8"))

    api_key = load_env_key()

    for shot_num in shot_nums:
        idx = shot_num - 1
        if idx >= len(blocks):
            print(f"[Skip] Shot {shot_num}: 无对应 prompt 块")
            continue
        if idx >= len(shot_to_frame):
            print(f"[Skip] Shot {shot_num}: 无对应帧映射")
            continue

        group_name, frame_name = shot_to_frame[idx]
        group_dir = base_dir / group_name
        tail_name = f"T{shot_num:02d}"
        frame_path = group_dir / frame_name
        if not frame_path.exists():
            alt = frame_name.replace(".png", ".jpg") if ".png" in frame_name else frame_name.replace(".jpg", ".png")
            frame_path = group_dir / alt
        if not frame_path.exists():
            print(f"[Skip] Shot {shot_num}: 首帧不存在 {group_dir}/{frame_name}")
            continue

        time_line, image_prompt, video_prompt = blocks[idx]
        names = shot_assets.get(str(shot_num), [])
        asset_paths = select_assets(names, assets_dir, max_count=2)
        asset_names = [p.stem for p in asset_paths]
        first_frame_b64 = read_image_as_base64(frame_path)
        asset_b64_list = [read_image_as_base64(p) for p in asset_paths]

        prompt_text = build_tail_prompt(
            prompt_template,
            image_prompt,
            video_prompt,
            asset_names,
        )

        tail_dir = group_dir / "tail"
        tail_dir.mkdir(parents=True, exist_ok=True)

        if args.dry_run:
            print(f"[DryRun] Shot {shot_num}: {group_name}/{frame_name} -> {tail_name}")
            print(f"  image_prompt: {image_prompt[:60]}...")
            print(f"  assets: {asset_names}")
            continue

        out_path = tail_dir / f"{tail_name}.png"
        if out_path.exists() and not args.retry:
            print(f"[Skip] Shot {shot_num}: {tail_name} 已存在，用 --retry 覆盖")
            continue

        endpoint = f"{YUNWU_BASE}/{args.model}:generateContent"
        print(f"[Run] Shot {shot_num}: {group_name}/{frame_name} -> {tail_name} ({args.model} {args.image_size}) ...")
        try:
            img_data = call_yunwu(
                api_key,
                prompt_text,
                first_frame_b64,
                asset_b64_list,
                endpoint=endpoint,
                aspect_ratio="9:16",
                image_size=args.image_size,
            )
            out_path.write_bytes(img_data)
            print(f"  -> {out_path}")
        except Exception as e:
            print(f"  [Error] {e}", file=sys.stderr)
            if args.fail_fast:
                raise


if __name__ == "__main__":
    main()
