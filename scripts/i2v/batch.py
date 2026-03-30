#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量 i2v（图生视频）脚本

三种入口：
1. 传统模式：读取 output/frames/{episode}/group_xx/ + prompt.txt
2. episode.json 模式：--from-json，与 Web 对齐的 mode（first_frame / first_last_frame / reference）
3. 可被 full_pipeline 导入：submit_batch_from_json、poll_and_download_cli_videos

参数契约与 Web `GenerateVideoRequest` 一致：mode、model、resolution、duration、reference_asset_ids。
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

import requests
import yaml

from src.vidu.client import ViduClient

# 与 web/server/models/schemas.VideoMode 一致
VideoMode = Literal["first_frame", "first_last_frame", "reference"]


def load_config() -> dict[str, Any]:
    """加载 config/default.yaml。"""
    cfg_path = PROJECT_ROOT / "config" / "default.yaml"
    if not cfg_path.exists():
        return {}
    with open(cfg_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _default_video_model(mode: VideoMode) -> str:
    """与 web/server/routes/generate._default_video_model 一致。"""
    # 首尾帧走 start-end2video（与 reference2video 不同）
    if mode == "first_last_frame":
        return "viduq3-turbo"
    if mode == "reference":
        return "viduq2-pro"
    if mode == "first_frame":
        return "viduq3-turbo"
    return "viduq2-pro-fast"


def _normalize_aspect_ratio(aspect: str) -> str:
    """将 episode 中的比例转为 Vidu API 常用写法。"""
    a = (aspect or "9:16").strip().lower().replace(" ", "")
    if a in ("9:16", "16:9", "1:1", "4:3", "3:4"):
        return a
    return "9:16"


def _extract_creation_video_url(vt: dict[str, Any]) -> str | None:
    """从 Vidu query_tasks 单条 task 中解析视频下载 URL（与 web/server/routes/tasks 一致）。"""
    cr = vt.get("creations")
    if cr is None:
        return None
    if isinstance(cr, list) and len(cr) > 0:
        return cr[0].get("url") or cr[0].get("watermarked_url")
    if isinstance(cr, dict):
        return cr.get("url") or cr.get("watermarked_url")
    return None


def _extract_task_id(resp: dict[str, Any]) -> str | None:
    tid = resp.get("task_id") or resp.get("id")
    return str(tid) if tid else None


@dataclass
class ShotVideoWorkItem:
    """单镜头待提交 Vidu 的工作单元。"""

    shot_id: str
    shot_number: int
    prompt: str
    aspect_ratio: str
    first_path: Path
    end_path: Path | None
    reference_paths: list[Path]


@dataclass
class BatchSubmitItem:
    """单次提交结果（未轮询）。"""

    shot_id: str
    shot_number: int
    vidu_task_id: str | None
    error: str | None = None
    stage: Literal["submit", "skip"] = "submit"


@dataclass
class BatchFromJsonResult:
    """episode.json 批量视频：提交 + 可选轮询下载后的汇总。"""

    json_path: Path
    mode: VideoMode
    submit_items: list[BatchSubmitItem] = field(default_factory=list)
    poll_errors: dict[str, str] = field(default_factory=dict)
    download_errors: dict[str, str] = field(default_factory=dict)

    @property
    def submit_ok_count(self) -> int:
        return sum(
            1
            for x in self.submit_items
            if x.stage == "submit" and x.vidu_task_id and not x.error
        )

    @property
    def submit_fail_count(self) -> int:
        return sum(1 for x in self.submit_items if x.stage == "submit" and x.error)


def collect_shot_work_items(
    data: dict[str, Any],
    episode_dir: Path,
    *,
    mode: VideoMode,
    reference_asset_ids: list[str] | None = None,
) -> list[ShotVideoWorkItem]:
    """
    从已解析的 episode 根 dict 收集待生成视频的镜头列表。

    - first_frame：需有 firstFrame 文件
    - first_last_frame：需有首帧 + 尾帧文件
    - reference：需至少 1 张可用资产图（与 Web 一致，不自动混入首帧）
    """
    items: list[ShotVideoWorkItem] = []
    ref_filter = set(reference_asset_ids) if reference_asset_ids else None

    for scene in data.get("scenes", []):
        for shot in scene.get("shots", []):
            first_rel = shot.get("firstFrame", "")
            if not first_rel:
                continue
            first_path = episode_dir / first_rel
            if not first_path.exists():
                continue
            shot_num = int(shot.get("shotNumber", 0))
            shot_id = str(shot.get("shotId", ""))
            prompt = str(shot.get("videoPrompt", ""))
            aspect = _normalize_aspect_ratio(str(shot.get("aspectRatio", "9:16")))
            end_rel = shot.get("endFrame")
            end_path = episode_dir / end_rel if end_rel else None
            if end_path is not None and not end_path.exists():
                end_path = None

            ref_paths: list[Path] = []
            if mode == "reference":
                for a in shot.get("assets", []):
                    aid = str(a.get("assetId", ""))
                    if ref_filter is not None and aid and aid not in ref_filter:
                        continue
                    lp = a.get("localPath", "")
                    if not lp:
                        continue
                    p = episode_dir / lp
                    if p.exists():
                        ref_paths.append(p)
                ref_paths = ref_paths[:7]
                if not ref_paths:
                    continue
            elif mode == "first_last_frame":
                if not end_path or not end_path.exists():
                    continue
            items.append(
                ShotVideoWorkItem(
                    shot_id=shot_id,
                    shot_number=shot_num,
                    prompt=prompt,
                    aspect_ratio=aspect,
                    first_path=first_path,
                    end_path=end_path if mode == "first_last_frame" else None,
                    reference_paths=ref_paths if mode == "reference" else [],
                )
            )
    return items


def _submit_one(
    client: ViduClient,
    vidu_cfg: dict[str, Any],
    item: ShotVideoWorkItem,
    *,
    mode: VideoMode,
    model: str,
    duration: int,
    resolution: str,
) -> tuple[str | None, str | None]:
    """
    提交单个镜头到 Vidu。

    Returns:
        (vidu_task_id, error_message)
    """
    try:
        if mode == "first_frame":
            resp = client.img2video_from_file(
                image_path=item.first_path,
                prompt=item.prompt[:5000],
                model=model,
                duration=duration,
                resolution=resolution,
                audio=bool(vidu_cfg.get("audio", True)),
                off_peak=bool(vidu_cfg.get("off_peak", False)),
                aspect_ratio=item.aspect_ratio,
            )
        elif mode == "first_last_frame":
            if not item.end_path:
                return None, "缺少尾帧"
            b64_1 = client._image_to_base64(item.first_path)
            b64_2 = client._image_to_base64(item.end_path)
            resp = client.start_end2video(
                images=[b64_1, b64_2],
                prompt=item.prompt[:5000],
                model=model,
                duration=duration,
                resolution=resolution,
                off_peak=bool(vidu_cfg.get("off_peak", False)),
                audio=bool(vidu_cfg.get("audio", True)),
            )
        elif mode == "reference":
            if not 1 <= len(item.reference_paths) <= 7:
                return None, "参考图数量须在 1~7"
            b64_list = [client._image_to_base64(p) for p in item.reference_paths]
            resp = client.reference2video_with_images(
                images=b64_list,
                prompt=item.prompt[:5000],
                model=model,
                duration=duration,
                resolution=resolution,
                aspect_ratio=item.aspect_ratio,
                off_peak=bool(vidu_cfg.get("off_peak", False)),
            )
        else:
            return None, f"未知 mode: {mode}"
        tid = _extract_task_id(resp)
        if not tid:
            return None, "Vidu 未返回 task_id"
        return tid, None
    except Exception as e:
        return None, str(e)


def submit_batch_from_json(
    json_path: Path,
    *,
    mode: VideoMode,
    dry_run: bool = False,
    model: str | None = None,
    duration: int | None = None,
    resolution: str | None = None,
    reference_asset_ids: list[str] | None = None,
) -> BatchFromJsonResult:
    """
    从 episode.json 批量提交 Vidu 任务（不轮询）。

    供 CLI 与 full_pipeline 复用；返回每镜头的 vidu_task_id 或错误信息。
    """
    jp = json_path if json_path.is_absolute() else Path.cwd() / json_path
    if not jp.exists():
        raise FileNotFoundError(f"episode.json 不存在: {jp}")
    data = json.loads(jp.read_text(encoding="utf-8"))
    episode_dir = jp.parent
    cfg = load_config()
    vidu_cfg = cfg.get("vidu", {})
    resolved_model = model or _default_video_model(mode)
    resolved_duration = int(duration if duration is not None else vidu_cfg.get("duration", 5))
    resolved_resolution = resolution or str(vidu_cfg.get("resolution", "720p"))

    items = collect_shot_work_items(
        data, episode_dir, mode=mode, reference_asset_ids=reference_asset_ids
    )
    result = BatchFromJsonResult(json_path=jp, mode=mode)

    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not api_key and not dry_run:
        raise RuntimeError("请在 .env 中设置 VIDU_API_KEY")

    print(f"共 {len(items)} 个镜头待提交 (mode={mode}, model={resolved_model})")
    if dry_run:
        for t in items[:5]:
            print(f"  [DryRun] Shot {t.shot_number} ({t.shot_id})")
        if len(items) > 5:
            print(f"  ... 及 {len(items) - 5} 个")
        for it in items:
            result.submit_items.append(
                BatchSubmitItem(it.shot_id, it.shot_number, None, None, "skip")
            )
        return result

    client = ViduClient(api_key=api_key)
    for it in items:
        tid, err = _submit_one(
            client,
            vidu_cfg,
            it,
            mode=mode,
            model=resolved_model,
            duration=resolved_duration,
            resolution=resolved_resolution,
        )
        if err:
            print(f"[失败] Shot {it.shot_number}: {err}")
            result.submit_items.append(
                BatchSubmitItem(it.shot_id, it.shot_number, None, err, "submit")
            )
        else:
            print(f"[OK] Shot {it.shot_number} → task_id={tid}")
            result.submit_items.append(
                BatchSubmitItem(it.shot_id, it.shot_number, tid, None, "submit")
            )
    return result


def poll_vidu_tasks_until_done(
    client: ViduClient,
    vidu_task_ids: list[str],
    *,
    initial_interval_sec: float = 5.0,
    max_interval_sec: float = 30.0,
    max_wait_sec: float = 7200.0,
    on_tick: Any | None = None,
) -> dict[str, str]:
    """
    轮询 Vidu 任务直到全部进入终态（success / failed）。

    间隔：初始 initial_interval_sec，每次迭代乘以 1.5，封顶 max_interval_sec。
    超过 max_wait_sec 仍未终态的任务记为 failed，避免死循环。

    Returns:
        task_id -> state 字符串（success / failed）
    """
    pending = {str(x) for x in vidu_task_ids if x}
    states: dict[str, str] = {}
    interval = float(initial_interval_sec)
    deadline = time.monotonic() + float(max_wait_sec)

    while pending:
        if time.monotonic() > deadline:
            for tid in pending:
                states[tid] = "failed"
            break
        time.sleep(interval)
        interval = min(max_interval_sec, interval * 1.5)
        try:
            resp = client.query_tasks(list(pending))
        except Exception as e:
            if on_tick:
                on_tick(f"query_tasks 异常: {e}")
            continue
        for vt in resp.get("tasks", []):
            tid = str(vt.get("id", ""))
            if not tid:
                continue
            state = str(vt.get("state", ""))
            if state in ("created", "queueing", "processing"):
                continue
            if tid in pending:
                pending.discard(tid)
                states[tid] = "success" if state == "success" else "failed"
        if on_tick:
            on_tick(f"pending={len(pending)} interval={interval:.1f}s")

    for tid in vidu_task_ids:
        st = str(tid)
        if st and st not in states:
            states[st] = "failed"
    return states


def _patch_episode_json_with_video(
    json_path: Path,
    shot_id: str,
    *,
    video_rel_path: str,
    model_name: str,
    mode: VideoMode,
) -> None:
    """将 CLI 下载的视频写入 episode.json：追加 VideoCandidate 并更新 shot.status。"""
    data = json.loads(json_path.read_text(encoding="utf-8"))
    cand_id = f"cand-cli-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for scene in data.get("scenes", []):
        for i, shot in enumerate(scene.get("shots", [])):
            if str(shot.get("shotId")) != shot_id:
                continue
            cands = list(shot.get("videoCandidates") or [])
            cands.append({
                "id": cand_id,
                "videoPath": video_rel_path,
                "thumbnailPath": "",
                "seed": 0,
                "model": model_name,
                "mode": mode,
                "selected": False,
                "createdAt": now,
                "taskId": "",
                "taskStatus": "success",
            })
            shot["videoCandidates"] = cands
            shot["status"] = "video_done"
            scene["shots"][i] = shot
            break
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def download_videos_for_submit_items(
    json_path: Path,
    submit_items: list[BatchSubmitItem],
    *,
    mode: VideoMode,
    model_name: str,
    client: ViduClient | None = None,
) -> tuple[dict[str, str], dict[str, str]]:
    """
    对已提交的 vidu_task_id 轮询并下载 MP4 到 episode_dir/videos/，并更新 episode.json。

    Returns:
        (poll_errors_by_shot_id, download_errors_by_shot_id) — key 为 shot_id
    """
    jp = json_path if json_path.is_absolute() else Path.cwd() / json_path
    episode_dir = jp.parent
    videos_dir = episode_dir / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)

    id_map: dict[str, tuple[str, str]] = {}
    for it in submit_items:
        if it.stage == "submit" and it.vidu_task_id and not it.error:
            id_map[it.vidu_task_id] = (it.shot_id, str(it.shot_number))

    if not id_map:
        return {}, {}

    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    cli = client or ViduClient(api_key=api_key or "dummy")

    vids = list(id_map.keys())
    states = poll_vidu_tasks_until_done(cli, vids)

    poll_errors: dict[str, str] = {}
    download_errors: dict[str, str] = {}

    for vid, state in states.items():
        shot_id, _num = id_map[vid]
        if state != "success":
            poll_errors[shot_id] = f"Vidu 状态: {state}"

    for vid, state in states.items():
        if state != "success":
            continue
        shot_id, snum = id_map[vid]
        try:
            r = cli.query_tasks([vid])
            tasks = r.get("tasks", [])
            if not tasks:
                download_errors[shot_id] = "query 无结果"
                continue
            vt = tasks[0]
            url = _extract_creation_video_url(vt)
            if not url:
                download_errors[shot_id] = "无视频 URL"
                continue
            safe = f"{shot_id}_cli_{snum}.mp4"
            dest = videos_dir / safe
            rr = requests.get(url, timeout=180)
            rr.raise_for_status()
            dest.write_bytes(rr.content)
            rel = f"videos/{safe}"
            mdl = str(vt.get("model") or model_name)
            _patch_episode_json_with_video(
                jp, shot_id, video_rel_path=rel, model_name=mdl, mode=mode
            )
            print(f"[下载完成] {shot_id} -> {rel}")
        except Exception as e:
            download_errors[shot_id] = str(e)

    return poll_errors, download_errors


def run_batch_from_json(
    json_path: Path,
    *,
    mode: VideoMode = "first_frame",
    with_endframe: bool = False,
    dry_run: bool = False,
    model: str | None = None,
    duration: int | None = None,
    resolution: str | None = None,
    reference_asset_ids: list[str] | None = None,
    poll_and_download: bool = False,
) -> BatchFromJsonResult:
    """
    episode.json 批量图生视频（兼容旧参数 --with-endframe）。

    - with_endframe=True 等价于 mode=first_last_frame（若未显式指定 reference）
    - poll_and_download=True 时提交后轮询并下载（供 full_pipeline）
    """
    effective_mode: VideoMode
    if mode == "first_frame" and with_endframe:
        effective_mode = "first_last_frame"
    else:
        effective_mode = mode

    res = submit_batch_from_json(
        json_path,
        mode=effective_mode,
        dry_run=dry_run,
        model=model,
        duration=duration,
        resolution=resolution,
        reference_asset_ids=reference_asset_ids,
    )
    if dry_run or not poll_and_download:
        return res

    cfg = load_config()
    vidu_cfg = cfg.get("vidu", {})
    mname = model or _default_video_model(effective_mode)
    pe, de = download_videos_for_submit_items(
        json_path,
        res.submit_items,
        mode=effective_mode,
        model_name=mname,
    )
    res.poll_errors = pe
    res.download_errors = de
    return res


def run_batch(episode: str = "第2集_EP02_分镜包", dry_run: bool = False) -> None:
    """传统模式：output/frames 分镜包目录。"""
    # 延迟导入：避免 full_pipeline 仅用到 episode.json 模式时加载 crop 子包（环境需 3.10+ 类型注解时更稳）
    from scripts.crop import get_scene_descriptions

    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not api_key and not dry_run:
        print("请在 .env 中设置 VIDU_API_KEY")
        sys.exit(1)
    cfg = load_config()
    vidu_cfg = cfg.get("vidu", {})
    paths_cfg = cfg.get("paths", {})
    frames_base = PROJECT_ROOT / paths_cfg.get("output_frames", "output/frames")
    shot_base = PROJECT_ROOT / paths_cfg.get("shot_base", "public/img/shot")
    ep_frames = frames_base / episode
    ep_shot = shot_base / episode
    if not ep_frames.is_dir():
        print(f"未找到裁剪输出: {ep_frames}")
        sys.exit(1)
    client = ViduClient(api_key=api_key or "dummy") if not dry_run else None
    tasks = []
    for group_dir in sorted(ep_frames.iterdir()):
        if not group_dir.is_dir() or not group_dir.name.startswith("group_"):
            continue
        prompt_path = ep_shot / group_dir.name / "prompt.txt"
        if not prompt_path.exists():
            continue
        descriptions = get_scene_descriptions(prompt_path)
        if not descriptions:
            continue
        for i, desc in enumerate(descriptions):
            frame_name = f"S{i + 1:02d}.png"
            frame_path = group_dir / frame_name
            if not frame_path.exists():
                continue
            tasks.append({"group": group_dir.name, "scene": i + 1, "frame_path": frame_path, "prompt": desc[:5000]})
    print(f"共 {len(tasks)} 个任务待提交")
    if dry_run:
        for t in tasks[:3]:
            print(f"  - {t['group']}/S{t['scene']:02d}: {t['prompt'][:60]}...")
        if len(tasks) > 3:
            print(f"  ... 及 {len(tasks) - 3} 个")
        return
    success = 0
    for t in tasks:
        try:
            resp = client.img2video_from_file(
                image_path=t["frame_path"],
                prompt=t["prompt"],
                model=vidu_cfg.get("model", "viduq2-pro-fast"),
                duration=vidu_cfg.get("duration", 5),
                resolution=vidu_cfg.get("resolution", "720p"),
                audio=vidu_cfg.get("audio", True),
                off_peak=vidu_cfg.get("off_peak", False),
            )
            print(f"[OK] {t['group']}/S{t['scene']:02d} → task_id={resp.get('task_id', '?')}")
            success += 1
        except Exception as e:
            print(f"[失败] {t['group']}/S{t['scene']:02d}: {e}")
    print(f"完成: {success}/{len(tasks)} 任务已提交")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="批量 i2v：传统分镜包 或 episode.json（与 Web mode 对齐）",
    )
    parser.add_argument("--episode", default="第2集_EP02_分镜包", help="分镜包名称（传统模式）")
    parser.add_argument("--from-json", type=Path, default=None, help="episode.json 路径")
    parser.add_argument(
        "--video-mode",
        choices=["first_frame", "first_last_frame", "reference"],
        default="first_frame",
        help="与 Web GenerateVideoRequest.mode 一致；默认 first_frame",
    )
    parser.add_argument(
        "--with-endframe",
        action="store_true",
        help="兼容旧参数：等价于 --video-mode first_last_frame",
    )
    parser.add_argument("--model", default=None, help="覆盖默认模型")
    parser.add_argument("--resolution", default=None, help="如 720p")
    parser.add_argument("--duration", type=int, default=None, help="时长（秒）")
    parser.add_argument(
        "--reference-asset-ids",
        default="",
        help="reference 模式：逗号分隔 assetId，空则每镜使用全部可用资产图",
    )
    parser.add_argument(
        "--poll-and-download",
        action="store_true",
        help="提交后轮询 Vidu 并下载 mp4 到 videos/（CLI 完整闭环）",
    )
    parser.add_argument("--dry-run", action="store_true", help="仅预览")
    args = parser.parse_args()

    if args.from_json:
        ref_ids = [x.strip() for x in args.reference_asset_ids.split(",") if x.strip()]
        run_batch_from_json(
            args.from_json,
            mode=args.video_mode,
            with_endframe=args.with_endframe,
            dry_run=args.dry_run,
            model=args.model,
            duration=args.duration,
            resolution=args.resolution,
            reference_asset_ids=ref_ids or None,
            poll_and_download=args.poll_and_download,
        )
    else:
        run_batch(episode=args.episode, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
