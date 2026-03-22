#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
正式流水线入口：Feeling 拉取 → 尾帧 → 视频（与 docs/自动化流水线计划 一致）

唯一推荐入口；Makefile/justfile 仅可做薄包装，业务逻辑集中在本脚本。

用法示例（配置好项目根 .env 后）::

    python scripts/feeling/full_pipeline.py --project-id <UUID> --steps pull,tail,video --video-mode first_last_frame

    # 仅对已拉取数据跑尾帧 + 视频
    python scripts/feeling/full_pipeline.py --project-id <UUID> --episode-id <EP_ID> --steps tail,video

    # 干跑
    python scripts/feeling/full_pipeline.py --project-id <UUID> --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 项目根加入 path
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(_PROJECT_ROOT / ".env")
except ImportError:
    pass

import yaml

from src.feeling.puller import pull_episode, pull_project
from src.pipeline.logger import PipelineLogger

# 尾帧 / 批量视频（模块化复用，避免重复实现 Vidu/Yunwu）
from scripts.endframe.gen_tail import TailShotResult, run_tail_from_json_episode
from scripts.i2v.batch import VideoMode, run_batch_from_json


def _load_yaml_config() -> dict:
    p = _PROJECT_ROOT / "config" / "default.yaml"
    if not p.exists():
        return {}
    with open(p, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _discover_episode_json_paths(
    output_dir: Path,
    project_id: str,
    episode_id: str | None,
) -> list[Path]:
    """
    在 data/{projectId}/ 下查找 episode.json。

    若指定 episode_id，只返回该目录；否则返回项目下全部剧集。
    """
    proj = output_dir / project_id
    if not proj.is_dir():
        return []
    if episode_id:
        jp = proj / episode_id / "episode.json"
        return [jp] if jp.is_file() else []
    paths: list[Path] = []
    for child in sorted(proj.iterdir()):
        if child.is_dir() and (child / "episode.json").is_file():
            paths.append(child / "episode.json")
    return paths


def _parse_steps(s: str) -> set[str]:
    parts = {p.strip().lower() for p in s.split(",") if p.strip()}
    allowed = {"pull", "tail", "video"}
    bad = parts - allowed
    if bad:
        raise ValueError(f"非法步骤: {bad}，允许: {allowed}")
    return parts


def _failures_from_tail(results: list[TailShotResult]) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    for r in results:
        if r.ok:
            continue
        out.append((r.shot_id or f"n{r.shot_number}", "tail", r.message or "unknown"))
    return out


def main() -> None:
    cfg = _load_yaml_config()
    default_mode = str((cfg.get("video") or {}).get("mode") or "first_last_frame")

    parser = argparse.ArgumentParser(
        description="FV 自动化流水线：pull → tail → video（正式唯一入口）",
    )
    parser.add_argument("--project-id", required=True, help="Feeling 项目 UUID")
    parser.add_argument("--episode-id", default=None, help="仅处理该剧集；省略则处理项目下全部剧集")
    parser.add_argument(
        "--steps",
        default="pull,tail,video",
        help="逗号分隔：pull, tail, video（可跳过已完成的阶段）",
    )
    parser.add_argument(
        "--video-mode",
        choices=["first_frame", "first_last_frame", "reference"],
        default=default_mode if default_mode in ("first_frame", "first_last_frame", "reference") else "first_last_frame",
        help="与 Web GenerateVideoRequest.mode 一致；默认读取 config/default.yaml video.mode",
    )
    parser.add_argument("--model", default=None, help="覆盖 Vidu 模型")
    parser.add_argument("--resolution", default=None, help="如 720p")
    parser.add_argument("--duration", type=int, default=None, help="视频时长（秒）")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data"),
        help="数据根目录（默认 data/）",
    )
    parser.add_argument(
        "--shots",
        default="",
        help="尾帧阶段：与 gen_tail --shots 相同，如 1-10；空表示全部镜头",
    )
    parser.add_argument(
        "--skip-poll",
        action="store_true",
        help="视频阶段仅提交 Vidu，不轮询下载（调试用）",
    )
    parser.add_argument("--dry-run", action="store_true", help="仅打印将执行的步骤，尾帧/视频不调用 API")
    parser.add_argument(
        "--force-redownload",
        action="store_true",
        help="pull 阶段强制重新下载图片",
    )
    parser.add_argument(
        "--skip-images",
        action="store_true",
        help="pull 阶段只拉取 episode.json 文案，不下载图片",
    )
    args = parser.parse_args()

    output_dir = args.output if args.output.is_absolute() else Path.cwd() / args.output
    steps = _parse_steps(args.steps)
    all_failures: list[tuple[str, str, str]] = []

    # ---------- pull ----------
    if "pull" in steps:
        print(f"[pipeline] 阶段 pull: project_id={args.project_id}", file=sys.stderr)
        if args.dry_run:
            print("[pipeline] dry-run: 跳过 pull_episode/pull_project", file=sys.stderr)
        elif args.episode_id:
            pull_episode(
                args.episode_id,
                output_dir,
                project_id=args.project_id,
                force_redownload=args.force_redownload,
                skip_images=args.skip_images,
            )
        else:
            pull_project(
                args.project_id,
                output_dir,
                force_redownload=args.force_redownload,
                skip_images=args.skip_images,
            )

    json_paths = _discover_episode_json_paths(output_dir, args.project_id, args.episode_id)
    if not json_paths:
        print(
            f"[pipeline] 未找到 episode.json（output={output_dir} project={args.project_id}）",
            file=sys.stderr,
        )
        sys.exit(2)

    vmode: VideoMode = args.video_mode  # type: ignore[assignment]

    for jp in json_paths:
        try:
            data_eid = str(
                json.loads(jp.read_text(encoding="utf-8")).get("episodeId", jp.parent.name)
            )
        except Exception:
            data_eid = jp.parent.name

        pl = PipelineLogger(episode_dir=jp.parent)
        episode_failures: list[tuple[str, str, str]] = []
        pl.log("pull", data_eid, status="info", message=f"处理剧集目录 {jp.parent}")

        # ---------- tail ----------
        if "tail" in steps:
            pl.log("tail", data_eid, status="start", message="尾帧生成")
            if args.dry_run:
                tr = run_tail_from_json_episode(
                    json_path=jp,
                    shots_spec=args.shots,
                    dry_run=True,
                    quiet=True,
                )
                pl.log("tail", data_eid, status="dry-run", message=f"would process {len(tr.results)} entries")
            else:
                tr = run_tail_from_json_episode(
                    json_path=jp,
                    shots_spec=args.shots,
                    dry_run=False,
                    quiet=False,
                )
                episode_failures.extend(_failures_from_tail(tr.results))
                pl.log(
                    "tail",
                    data_eid,
                    status="done",
                    message=f"ok={tr.ok_count} fail={tr.fail_count}",
                )

        # ---------- video ----------
        if "video" in steps:
            pl.log("video", data_eid, status="start", message=f"mode={vmode} poll={not args.skip_poll}")
            if args.dry_run:
                run_batch_from_json(
                    jp,
                    mode=vmode,
                    dry_run=True,
                    model=args.model,
                    duration=args.duration,
                    resolution=args.resolution,
                    poll_and_download=False,
                )
            else:
                res = run_batch_from_json(
                    jp,
                    mode=vmode,
                    with_endframe=False,
                    dry_run=False,
                    model=args.model,
                    duration=args.duration,
                    resolution=args.resolution,
                    poll_and_download=not args.skip_poll,
                )
                for it in res.submit_items:
                    if it.error:
                        episode_failures.append((it.shot_id, "video_submit", it.error))
                for sid, err in res.poll_errors.items():
                    episode_failures.append((sid, "video_poll", err))
                for sid, err in res.download_errors.items():
                    episode_failures.append((sid, "video_download", err))

        all_failures.extend(episode_failures)
        pl.print_summary(
            episode_id=data_eid,
            stage_counts={"failures_total": len(episode_failures)},
            failures=episode_failures,
        )

    if all_failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
