#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
多参参考生视频脚本 (reference2video)

从 raw.txt 格式读取：
- 第 1 行：视频提示词（景别、角度、运镜、描述等）
- 第 2 行：台词（可选，格式如「卡尔：没什么。我只是不敢相信……」）
- 第 3-7 行：多参列表（角色/场景名，如 格雷·金斯顿、卡尔、达里尔、汽车、汽车内部）
- 参考首帧：指定 group/帧图（如 group_01/S01.png）

根据 docs/vidu/reference.md：
- 有台词 → 主体调用（viduq2/viduq1/vidu2.0），支持音视频直出
- 无台词 → 非主体调用（viduq2-pro 等），多图参考

资产映射：从 assets_labeled/ 按多参名称查找对应 .png 图片。
"""

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

import yaml

from src.vidu.client import ViduClient


# -----------------------------------------------------------------------------
# 配置：多参名称 → 资产文件名映射（assets_labeled 中的文件名）
# 若名称与文件名一致可省略，脚本会尝试 {name}.png
# -----------------------------------------------------------------------------
DEFAULT_ASSET_MAP = {
    "格雷·金斯顿": "格雷·金斯顿.png",
    "卡尔": "卡尔.png",
    "达里尔": "达里尔.png",
    "瑞克": "瑞克.png",
    "赫谢尔": "赫谢尔.png",
    "汽车": "汽车.png",
    "汽车内部": "汽车内部.png",
    "监狱外围": "监狱外围.png",
    "监狱公共区": "监狱公共区.png",
    "牢房内部": "牢房内部.png",
    "医药箱": "医药箱.png",
    "武器": "武器.png",
    "行尸": "行尸.png",
    "滑轮系统": "滑轮系统.png",
}


def parse_duration_from_prompt(prompt: str) -> int:
    """
    从提示词中解析时长，如 [10-15s] → 5。
    默认返回 5。
    """
    m = re.search(r"\[(\d+)-(\d+)s?\]", prompt)
    if m:
        return int(m.group(2)) - int(m.group(1))
    return 5


def extract_dialogue_speaker(dialogue_line: str) -> tuple[str | None, str]:
    """
    解析台词行，如「卡尔：没什么。我只是不敢相信……」
    返回 (speaker, text) 或 (None, full_line)
    """
    if "：" in dialogue_line:
        idx = dialogue_line.index("：")
        return dialogue_line[:idx].strip(), dialogue_line[idx + 1 :].strip()
    return None, dialogue_line


def resolve_asset_path(
    name: str,
    assets_dir: Path,
    asset_map: dict[str, str] | None = None,
) -> Path | None:
    """
    根据多参名称解析资产图片路径。
    优先查 asset_map，否则尝试 {name}.png。
    """
    am = asset_map or DEFAULT_ASSET_MAP
    fname = am.get(name, f"{name}.png")
    path = assets_dir / fname
    if path.exists():
        return path
    # 尝试 .jpg
    alt = path.with_suffix(".jpg")
    if alt.exists():
        return alt
    return None


def build_subject_prompt(video_prompt: str, subject_ids: list[str]) -> str:
    """
    构建主体调用时的 prompt。
    在描述前添加 @id 引用，便于 API 识别主体。
    格式：@1 @2 @3 ... 视频描述
    """
    refs = " ".join(f"@{sid}" for sid in subject_ids)
    return f"{refs}。{video_prompt}" if refs else video_prompt


def run_ref2v(
    frames_dir: Path,
    *,
    video_prompt: str,
    dialogue: str | None,
    params: list[str],
    first_frame_path: Path,
    assets_dir: Path | None = None,
    asset_map: dict[str, str] | None = None,
    use_subjects: bool | None = None,
    model: str | None = None,
    duration: int | None = None,
    resolution: str = "720p",
    aspect_ratio: str = "9:16",
    dry_run: bool = False,
    record_path: Path | str | None = None,
    poll_after_submit: bool = True,
    poll_interval: int = 15,
) -> dict | None:
    """
    执行多参参考生视频任务。

    Args:
        frames_dir: 分镜包目录（如 output/frames/第2集_EP02_分镜包）
        video_prompt: 视频描述提示词
        dialogue: 台词（含或去除「XX：」前缀皆可）
        params: 多参名称列表
        first_frame_path: 参考首帧图片路径
        assets_dir: 资产目录，默认 frames_dir/assets_labeled
        asset_map: 多参名→文件名映射
        use_subjects: True=主体调用（可含台词），False=非主体调用
                      未指定时：有 dialogue 则 True，否则 False
        model: 模型名，主体调用默认 viduq2，非主体默认 viduq2-pro
        duration: 时长，默认从 prompt 解析或 5
        dry_run: 仅打印参数不提交

    Returns:
        API 响应或 None
    """
    assets_dir = assets_dir or frames_dir / "assets_labeled"
    if not assets_dir.is_dir():
        print(f"[警告] 资产目录不存在: {assets_dir}")

    # 确定是否主体调用
    if use_subjects is None:
        use_subjects = bool(dialogue)

    # 解析台词：去除「卡尔：」等前缀，保留纯文本
    dialogue_text = None
    if dialogue:
        _, dialogue_text = extract_dialogue_speaker(dialogue)
        if not dialogue_text:
            dialogue_text = dialogue

    # 时长
    dur = duration
    if dur is None:
        dur = parse_duration_from_prompt(video_prompt)
    dur = max(1, min(10, dur))

    # 收集图片路径：参考首帧 + 多参资产
    image_paths: list[Path] = []
    subject_ids: list[str] = []

    if use_subjects:
        # 主体调用：每个多参为一个主体，参考首帧可并入第一个主体或单独
        # 为简化，将首帧作为场景参考加入第一个主体，或作为额外图
        # 文档：每个主体 1-3 张图，共 1-7 个主体
        # 策略：首帧 + 多参资产，多参作为主体
        seen: set[str] = set()
        # 先加入首帧
        image_paths.append(first_frame_path)
        subject_ids.append("scene")  # 场景/首帧

        for name in params:
            if name in seen:
                continue
            seen.add(name)
            path = resolve_asset_path(name, assets_dir, asset_map)
            if path:
                image_paths.append(path)
                # 使用简化的 id（无特殊字符）
                sid = re.sub(r"[^\w]", "_", name)[:20]
                subject_ids.append(sid)
            else:
                print(f"[跳过] 未找到资产: {name}")

        if len(image_paths) > 7:
            image_paths = image_paths[:7]
            subject_ids = subject_ids[:7]
    else:
        # 非主体调用：images 列表，首帧 + 多参资产
        image_paths.append(first_frame_path)
        for name in params:
            path = resolve_asset_path(name, assets_dir, asset_map)
            if path and path not in image_paths:
                image_paths.append(path)
        if len(image_paths) > 7:
            image_paths = image_paths[:7]

    if not image_paths:
        print("[错误] 无有效图片")
        return None

    # 构建 prompt
    if use_subjects:
        prompt = build_subject_prompt(video_prompt, subject_ids)
        if dialogue_text:
            prompt = f"{prompt}，并且旁白音说{dialogue_text}"
    else:
        prompt = video_prompt

    if dry_run:
        print("=== 多参参考生视频 (dry-run) ===")
        print(f"  模式: {'主体调用（含台词）' if use_subjects else '非主体调用'}")
        print(f"  模型: {model or ('viduq2' if use_subjects else 'viduq2-pro')}")
        print(f"  时长: {dur}s")
        print(f"  图片数: {len(image_paths)}")
        for i, p in enumerate(image_paths):
            print(f"    [{i}] {p.name}")
        print(f"  prompt: {prompt[:120]}...")
        if dialogue_text:
            print(f"  台词: {dialogue_text[:80]}...")
        return None

    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        print("请在 .env 中设置 VIDU_API_KEY")
        sys.exit(1)

    cfg = {}
    if (PROJECT_ROOT / "config/default.yaml").exists():
        with open(PROJECT_ROOT / "config/default.yaml", "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
    vidu_cfg = cfg.get("vidu", {})

    client = ViduClient(api_key=api_key)
    m = model or ("viduq2" if use_subjects else vidu_cfg.get("model", "viduq2-pro"))
    # 主体调用时 viduq2-pro 不支持，强制 viduq2
    if use_subjects and "pro" in m.lower():
        m = "viduq2"

    # 构建完整请求 payload（供记录，不含 base64）
    request_payload = {
        "model": m,
        "duration": dur,
        "resolution": resolution,
        "aspect_ratio": aspect_ratio,
        "image_paths": [str(p) for p in image_paths],
        "prompt": build_subject_prompt(video_prompt, subject_ids) if use_subjects else prompt,
        "dialogue": dialogue_text if use_subjects else None,
        "use_subjects": use_subjects,
        "subject_ids": subject_ids if use_subjects else None,
    }

    try:
        if use_subjects:
            # prompt 含 @refs，dialogue 由 reference2video_from_files 合并
            base_prompt = build_subject_prompt(video_prompt, subject_ids)
            resp = client.reference2video_from_files(
                image_paths=image_paths,
                prompt=base_prompt,
                use_subjects=True,
                dialogue=dialogue_text,
                subject_ids=subject_ids,
                model=m,
                duration=dur,
                resolution=resolution,
                aspect_ratio=aspect_ratio,
            )
        else:
            resp = client.reference2video_with_images(
                images=[client._image_to_base64(Path(p)) for p in image_paths],
                prompt=prompt,
                model=m,
                duration=dur,
                resolution=resolution,
                aspect_ratio=aspect_ratio,
            )
        task_id = resp.get("task_id", "")
        print(f"[OK] task_id={task_id} state={resp.get('state', '?')} credits={resp.get('credits', '?')} seed={resp.get('seed', '?')}")

        # 完整提交返回值（images 占位避免巨大 JSON）
        submit_response = dict(resp)
        if "images" in submit_response and submit_response["images"]:
            submit_response["images"] = [f"<base64_or_url x{len(resp['images'])}>"]

        poll_result = None
        if poll_after_submit and task_id:
            print(f"  轮询任务（间隔 {poll_interval}s）...")
            pending = {task_id}
            while pending:
                try:
                    q = client.query_tasks(list(pending))
                except Exception as e:
                    print(f"  [查询失败] {e}")
                    time.sleep(poll_interval)
                    continue
                tasks = q.get("tasks", [])
                t = next((x for x in tasks if x.get("id") == task_id), None)
                if not t:
                    time.sleep(poll_interval)
                    continue
                state = t.get("state", "")
                poll_result = {
                    "state": state,
                    "credits": t.get("credits"),
                    "url": None,
                    "query_response": dict(t),
                }
                if "images" in poll_result["query_response"] and poll_result["query_response"]["images"]:
                    poll_result["query_response"]["images"] = ["<base64_or_url>"]
                if state in ("success", "failed"):
                    pending.discard(task_id)
                    if state == "success":
                        creations = t.get("creations", [])
                        poll_result["url"] = creations[0].get("url") if creations else None
                    print(f"  轮询完成: {state} credits={poll_result.get('credits')} url={'...' if poll_result.get('url') else '-'}")
                    break
                print(f"  待完成: {state}，{poll_interval}s 后重试...")
                time.sleep(poll_interval)

        if record_path and resp:
            rp = Path(record_path)
            rp.parent.mkdir(parents=True, exist_ok=True)
            record = {
                "task_id": task_id,
                "group": str(first_frame_path.parent.name),
                "frame": first_frame_path.name,
                "request_payload": request_payload,
                "submit_response": submit_response,
                "poll_result": poll_result,
            }
            with open(rp, "w", encoding="utf-8") as f:
                json.dump(record, f, ensure_ascii=False, indent=2)
            print(f"  记录已保存: {rp}")
        return resp
    except Exception as e:
        print(f"[失败] {e}")
        raise


def parse_raw_block(lines: list[str]) -> dict | None:
    """
    解析 raw.txt 的一个镜头块。
    期望格式：
      L1: [景别]... 视频描述
      L2: 卡尔：台词
      L3-7: 多参名（每行一个）
    """
    lines = [ln.strip() for ln in lines if ln.strip()]
    if len(lines) < 2:
        return None
    return {
        "video_prompt": lines[0],
        "dialogue": lines[1] if lines[1].count("：") >= 1 or lines[1].count(":") >= 1 else None,
        "params": lines[2:7] if len(lines) > 2 else [],
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="多参参考生视频：视频提示词 + 台词 + 多参 + 参考首帧"
    )
    parser.add_argument(
        "--frames-dir",
        default=str(PROJECT_ROOT / "output/frames/第2集_EP02_分镜包"),
        help="分镜包目录",
    )
    parser.add_argument("--group", default="group_01", help="group 名称")
    parser.add_argument("--frame", default="S01", help="首帧名，如 S01")
    parser.add_argument(
        "--prompt",
        default=None,
        help="视频提示词（覆盖 raw 时从文件读）",
    )
    parser.add_argument(
        "--dialogue",
        default=None,
        help="台词（覆盖 raw 时从文件读）",
    )
    parser.add_argument(
        "--params",
        nargs="+",
        default=None,
        help="多参列表，如 格雷·金斯顿 卡尔 达里尔 汽车 汽车内部",
    )
    parser.add_argument(
        "--raw-offset",
        type=int,
        default=0,
        help="从 raw.txt 第几行开始读（0-based，0=第1行）",
    )
    parser.add_argument("--model", default=None, help="模型")
    parser.add_argument("--duration", type=int, default=None, help="时长（秒）")
    parser.add_argument("--resolution", default="720p", help="分辨率：540p、720p、1080p")
    parser.add_argument("--aspect-ratio", default="9:16", help="比例：16:9、9:16、1:1")
    parser.add_argument("--dry-run", action="store_true", help="仅预览")
    parser.add_argument(
        "--no-subjects",
        action="store_true",
        help="强制非主体调用（即使有台词也不生成配音）",
    )
    parser.add_argument(
        "--record",
        default=None,
        help="保存任务记录到指定 JSON 路径，不覆盖已有文件",
    )
    parser.add_argument(
        "--no-poll",
        action="store_true",
        help="提交后不轮询（默认会轮询直到 success/failed）",
    )
    parser.add_argument("--poll-interval", type=int, default=15, help="轮询间隔(秒)")
    args = parser.parse_args()

    frames_dir = Path(args.frames_dir)
    first_frame_path = frames_dir / args.group / f"{args.frame}.png"
    if not first_frame_path.suffix:
        first_frame_path = first_frame_path.with_suffix(".png")

    if not first_frame_path.exists():
        print(f"[错误] 参考首帧不存在: {first_frame_path}")
        sys.exit(1)

    # 从 raw.txt 或参数获取
    video_prompt = args.prompt
    dialogue = args.dialogue
    params = args.params or []

    raw_path = frames_dir / "raw.txt"
    if raw_path.exists() and (video_prompt is None or dialogue is None or not params):
        raw_text = raw_path.read_text(encoding="utf-8")
        raw_lines = [ln.rstrip() for ln in raw_text.split("\n")]
        # 取第一块：L0 提示词, L1 台词, L2-6 多参
        block = parse_raw_block(raw_lines[args.raw_offset : args.raw_offset + 10])
        if block:
            if video_prompt is None:
                video_prompt = block["video_prompt"]
            if dialogue is None and block.get("dialogue"):
                dialogue = block["dialogue"]
            if not params and block.get("params"):
                params = block["params"]
            print(f"[解析 raw.txt] prompt 行数={args.raw_offset+1}, params={params}")
    elif not video_prompt:
        print("[错误] 请提供 --prompt 或确保 raw.txt 存在且格式正确")
        sys.exit(1)

    use_subjects = not args.no_subjects
    record_path = None
    if args.record:
        record_path = Path(args.record)
    elif not args.dry_run:
        # 默认保存到 group 下，带时间戳避免覆盖已有记录
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        record_path = frames_dir / args.group / f"ref2v_{args.frame}_{ts}_record.json"

    poll_after = not args.no_poll
    run_ref2v(
        frames_dir=frames_dir,
        video_prompt=video_prompt,
        dialogue=dialogue,
        params=params,
        first_frame_path=first_frame_path,
        model=args.model,
        duration=args.duration,
        resolution=args.resolution,
        aspect_ratio=args.aspect_ratio,
        use_subjects=use_subjects,
        dry_run=args.dry_run,
        record_path=record_path,
        poll_after_submit=poll_after,
        poll_interval=args.poll_interval,
    )


if __name__ == "__main__":
    main()
