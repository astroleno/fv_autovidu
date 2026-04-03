# -*- coding: utf-8 -*-
"""
生成路由：POST endframe, video, regen-frame, regen-batch-wan27

异步触发生成任务，立即返回 taskId 供前端轮询。
尾帧批量：每个 shot 独立 task；视频批量：按 mode 分发 Vidu（i2v / 首尾帧 start-end2video / 多参考图 reference2video）。

重要：FastAPI/Starlette 的 BackgroundTasks 会**按顺序**执行每个后台任务；
若对同一请求 add_task N 次同步函数，会**串行**跑完一张再跑下一张（总耗时 ≈ N × 单张耗时）。
因此批量尾帧/批量视频改为：只 add_task **一次**，在回调内用 ThreadPoolExecutor 按 ENDFRAME_CONCURRENCY / VIDEO_CONCURRENCY 真正并行。
"""

from __future__ import annotations

import json
import logging
from typing import Optional
import os
import sys
import time
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _SERVER_DIR.parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from models.schemas import (
    BatchEndframeResponse,
    EndframeTaskItem,
    Episode,
    GenerateEndframeRequest,
    GenerateVideoRequest,
    GenerateVideoResponse,
    PromoteVideoRequest,
    RegenBatchWan27Request,
    RegenBatchWan27Response,
    RegenFrameRequest,
    RegenFrameResponse,
    Shot,
    ShotAsset,
    VideoCandidate,
    VideoMode,
)
from services import data_service
from services.prompt_compose import append_dialogue_for_video_prompt
from services.context_service import (
    fs_lock_tag_from_namespace_root,
    get_context_task_id,
    get_namespace_data_root_optional,
)
from services.task_store import get_task_store

from src.feeling.episode_fs_lock import episode_fs_lock

_LOG = logging.getLogger(__name__)

router = APIRouter()

# 并发控制：
# 1) 批量任务内用 ThreadPoolExecutor(max_workers=...) 限制并行度（见 _run_*_batch_parallel）
# 2) Semaphore 保留在单任务函数内，防止将来从别处直接调用 _run_tail_frame 时打爆 API
# 默认 20 路；若 yunwu/Vidu 限流可改小环境变量
_ENDFRAME_SEM = threading.Semaphore(int(os.getenv("ENDFRAME_CONCURRENCY", "20")))
_VIDEO_SEM = threading.Semaphore(int(os.getenv("VIDEO_CONCURRENCY", "20")))


def _endframe_max_workers(n_tasks: int) -> int:
    """批量尾帧线程池大小：不超过任务数，不超过 ENDFRAME_CONCURRENCY。"""
    cap = int(os.getenv("ENDFRAME_CONCURRENCY", "20"))
    return max(1, min(n_tasks, cap))


def _video_max_workers(n_tasks: int) -> int:
    """批量视频线程池大小。"""
    cap = int(os.getenv("VIDEO_CONCURRENCY", "20"))
    return max(1, min(n_tasks, cap))


# (task_id, episode_id, shot_id, namespace_root_str|None, task_context_id|None)
EndframeBatchItem = tuple[str, str, str, str | None, str | None]


def _run_endframe_batch_parallel(specs: list[EndframeBatchItem]) -> None:
    """
    在单个 BackgroundTask 内并行执行多路尾帧生成。

    Args:
        specs: 含命名空间路径字符串（相对 / 绝对均可，用 Path 解析）与任务 context_id
    """
    if not specs:
        return
    workers = _endframe_max_workers(len(specs))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = []
        for tid, eid, sid, ns_s, ctx_tid in specs:
            futures.append(
                pool.submit(
                    _run_tail_frame,
                    tid,
                    eid,
                    sid,
                    namespace_root=Path(ns_s) if ns_s else None,
                    task_context_id=ctx_tid,
                )
            )
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                # _run_tail_frame 内部已捕获；此处防御未预料异常
                print(f"[Warn] endframe batch worker: {e}")


# 单条视频任务：task_id, episode_id, shot_id, mode, model, duration, resolution(Vidu),
# ref_ids, seed, is_preview, promoted_from, resolution_label, ns_str, task_context_id
VideoJobSpec = tuple[
    str,
    str,
    str,
    VideoMode,
    str | None,
    int | None,
    str | None,
    list[str] | None,
    int,
    bool,
    str | None,
    str,
    str | None,
    str | None,
]


def _run_video_batch_parallel(jobs: list[VideoJobSpec]) -> None:
    """在单个 BackgroundTask 内并行提交多路 Vidu（与尾帧同理，避免 BackgroundTasks 串行）。"""
    if not jobs:
        return
    workers = _video_max_workers(len(jobs))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(
                _run_video_gen,
                task_id,
                episode_id,
                shot_id,
                mode,
                model,
                duration,
                resolution,
                ref_ids,
                seed,
                is_preview,
                promoted_from,
                resolution_label,
                namespace_root=Path(ns_s) if ns_s else None,
                task_context_id=ctx_tid,
            )
            for (
                task_id,
                episode_id,
                shot_id,
                mode,
                model,
                duration,
                resolution,
                ref_ids,
                seed,
                is_preview,
                promoted_from,
                resolution_label,
                ns_s,
                ctx_tid,
            ) in jobs
        ]
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                print(f"[Warn] video batch worker: {e}")


def _default_video_model(mode: VideoMode) -> str:
    """按生成模式默认模型（请求未带 model 时）。"""
    # 首尾帧：正式生成默认 pro；预览档由前端传 turbo + isPreview
    if mode == "first_last_frame":
        return "viduq3-pro"
    if mode == "reference":
        return "viduq2-pro"
    # 仅首帧 i2v：与产品「预览试错」一致，默认 turbo（旧版 viduq2-pro-fast 易与预期不符）
    if mode == "first_frame":
        return "viduq3-turbo"
    return "viduq2-pro-fast"


def _default_video_resolution(
    mode: VideoMode,
    resolution: str | None,
    *,
    is_preview: bool = False,
) -> str:
    """
    解析 Vidu 分辨率：显式传入优先；否则按模式给默认值。
    首尾帧：预览 540p / 正式 1080p（避免 720p+turbo 这类无意义折中）。
    仅首帧：默认 540p，与 turbo 预览档一致。
    """
    if resolution and str(resolution).strip():
        return str(resolution).strip()
    if mode == "first_last_frame":
        return "540p" if is_preview else "1080p"
    if mode == "first_frame":
        return "540p"
    return "720p"


def _normalize_aspect_ratio(aspect: str) -> str:
    """将 episode 中的比例转为 Vidu API 常用写法。"""
    a = (aspect or "9:16").strip().lower().replace(" ", "")
    if a in ("9:16", "16:9", "1:1", "4:3", "3:4"):
        return a
    return "9:16"


def _video_request_seed_int(seed: Optional[int]) -> int:
    """GenerateVideoRequest.seed：None 或 <=0 表示随机（Vidu 侧 seed=0）。"""
    if seed is None or seed <= 0:
        return 0
    return int(seed)


def _ts():
    """任务状态写入入口（SQLite）。"""
    return get_task_store()


def _run_tail_frame(
    task_id: str,
    episode_id: str,
    shot_id: str,
    *,
    namespace_root: Path | None = None,
    task_context_id: str | None = None,
) -> None:
    """同步执行尾帧生成（在线程中运行）；yunwu 调用受信号量限制。"""
    fs_tag = fs_lock_tag_from_namespace_root(namespace_root)
    try:
        _LOG.info(
            "[尾帧] 开始 task=%s episode=%s shot=%s",
            task_id,
            episode_id,
            shot_id,
        )
        ep = data_service.get_episode(episode_id, namespace_root)
        if not ep:
            _LOG.warning("[尾帧] 失败 task=%s: Episode not found", task_id)
            _ts().set_task(
                task_id, "failed", error="Episode not found", context_id=task_context_id
            )
            return
        shot = data_service.get_shot(episode_id, shot_id, namespace_root)
        if not shot:
            _LOG.warning("[尾帧] 失败 task=%s: Shot not found", task_id)
            _ts().set_task(
                task_id, "failed", error="Shot not found", context_id=task_context_id
            )
            return
        ep_dir = data_service.get_episode_dir(episode_id, namespace_root)
        if not ep_dir:
            _LOG.warning("[尾帧] 失败 task=%s: Episode dir not found", task_id)
            _ts().set_task(
                task_id, "failed", error="Episode dir not found", context_id=task_context_id
            )
            return
        first_path = ep_dir / shot.firstFrame
        if not first_path.exists():
            _LOG.warning(
                "[尾帧] 失败 task=%s: 首帧文件不存在 path=%s",
                task_id,
                shot.firstFrame,
            )
            _ts().set_task(
                task_id,
                "failed",
                error=f"First frame not found: {shot.firstFrame}",
                context_id=task_context_id,
            )
            return
        assets_dir = ep_dir / "assets"
        asset_paths = [assets_dir / a.localPath.replace("assets/", "").lstrip("/") for a in shot.assets]
        asset_paths = [p for p in asset_paths if p.exists()][:2]
        pre = _ts().get_task_row(task_id)
        if pre is not None and pre.status != "processing":
            _LOG.info(
                "[尾帧] 跳过 Yunwu task=%s: 任务已非 processing（可能已取消）status=%s",
                task_id,
                pre.status,
            )
            return
        with _ENDFRAME_SEM:
            from services.yunwu_service import generate_tail_frame

            # 尾帧走 Yunwu：system prompt 要求静态终态、不要字幕/额外文字；
            # 不对白块做拼接，仅传镜头级 videoPrompt（与 Vidu 口型台词语义解耦）。
            img_data = generate_tail_frame(
                first_path,
                shot.imagePrompt,
                shot.videoPrompt,
                asset_paths,
            )
        post = _ts().get_task_row(task_id)
        if post is not None and post.status != "processing":
            _LOG.info(
                "[尾帧] 放弃落盘 task=%s: 推理完成后任务已终态（可能已取消）status=%s",
                task_id,
                post.status,
            )
            return
        # 优先用首帧路径 stem（如 frames/S003.png → S003_end.png），避免多镜头 shotNumber 重复时互相覆盖
        _stem = Path(shot.firstFrame).stem
        end_name = f"{_stem}_end.png" if _stem else f"S{shot.shotNumber:02d}_end.png"
        # 与 pull / dub / video 收尾互斥：Yunwu 在锁外，避免长时间阻塞 repull；落盘前重新解析 ep_dir，防止 repull 后仍写到已删路径
        with episode_fs_lock(episode_id, data_namespace=fs_tag):
            ep_dir_write = data_service.get_episode_dir(episode_id, namespace_root)
            if not ep_dir_write:
                _LOG.warning("[尾帧] 失败 task=%s: 生成完成后剧集目录不存在（可能 repull 迁移中）", task_id)
                _ts().set_task(
                    task_id,
                    "failed",
                    error="Episode dir not found after generation",
                    context_id=task_context_id,
                )
                return
            end_path = ep_dir_write / "endframes" / end_name
            end_path.parent.mkdir(parents=True, exist_ok=True)
            end_path.write_bytes(img_data)
            data_service.update_shot(episode_id, shot_id, {
                "endFrame": f"endframes/{end_name}",
                "status": "endframe_done",
            }, namespace_root)
        _ts().set_task(
            task_id,
            "success",
            result={"path": f"endframes/{end_name}"},
            context_id=task_context_id,
        )
        _LOG.info(
            "[尾帧] 成功 task=%s shot=%s endFrame=%s bytes=%d",
            task_id,
            shot_id,
            f"endframes/{end_name}",
            len(img_data),
        )
    except Exception as e:
        _LOG.exception("[尾帧] 异常 task=%s episode=%s shot=%s: %s", task_id, episode_id, shot_id, e)
        _ts().set_task(task_id, "failed", error=str(e), context_id=task_context_id)
        try:
            with episode_fs_lock(episode_id, data_namespace=fs_tag):
                data_service.update_shot_status(episode_id, shot_id, "error", namespace_root)
        except Exception:
            _LOG.exception("[尾帧] 写回 error 状态失败 task=%s episode=%s shot=%s", task_id, episode_id, shot_id)


@router.post("/generate/endframe", response_model=BatchEndframeResponse)
def generate_endframe(
    req: GenerateEndframeRequest,
    background_tasks: BackgroundTasks,
    request: Request,
):
    """批量生成尾帧：每个 shot 独立 taskId，返回 tasks 列表。"""
    if not req.shotIds:
        raise HTTPException(status_code=400, detail="shotIds 不能为空")
    ns = get_namespace_data_root_optional(request)
    ns_s = str(ns) if ns is not None else None
    ctx_tid = get_context_task_id(request)
    tasks_out: list[EndframeTaskItem] = []
    specs: list[EndframeBatchItem] = []
    for shot_id in req.shotIds:
        task_id = f"endframe-{uuid.uuid4().hex[:12]}"
        _ts().set_task(task_id, "processing", context_id=ctx_tid)
        data_service.update_shot_status(
            req.episodeId, shot_id, "endframe_generating", ns
        )
        specs.append((task_id, req.episodeId, shot_id, ns_s, ctx_tid))
        tasks_out.append(EndframeTaskItem(taskId=task_id, shotId=shot_id))
    # 关键：只注册一个后台任务，内部线程池并行；勿对每镜头 add_task 一次（会串行）
    _LOG.info(
        "[尾帧] 已入队 batch episode=%s 镜头数=%d tasks=%s",
        req.episodeId,
        len(specs),
        [spec[0] for spec in specs],
    )
    background_tasks.add_task(_run_endframe_batch_parallel, specs)
    return BatchEndframeResponse(tasks=tasks_out)


def _run_video_gen(
    task_id: str,
    episode_id: str,
    shot_id: str,
    mode: VideoMode,
    model: str | None,
    duration: int | None,
    resolution: str | None,
    reference_asset_ids: list[str] | None,
    seed: int = 0,
    is_preview: bool = False,
    promoted_from: Optional[str] = None,
    resolution_label: str = "",
    *,
    namespace_root: Path | None = None,
    task_context_id: str | None = None,
) -> None:
    """
    同步执行视频生成（提交 Vidu）；任务完成与下载由 video_finalizer 后台收尾。

    Args:
        seed: Vidu 随机种子；0 表示服务端随机。
        is_preview: 是否为低成本预览候选（多候选预览时 True）。
        promoted_from: 精出来源候选 id；普通生成时为 None。
        resolution_label: 写入 VideoCandidate.resolution，缺省则用 Vidu 实际 resolution。
        namespace_root: 数据子根（多上下文）。
        task_context_id: 写入 tasks.context_id。
    """
    try:
        _LOG.info(
            "[视频] 开始 task=%s episode=%s shot=%s mode=%s",
            task_id,
            episode_id,
            shot_id,
            mode,
        )
        with _VIDEO_SEM:
            ep = data_service.get_episode(episode_id, namespace_root)
            if not ep:
                _LOG.warning("[视频] 失败 task=%s: Episode not found", task_id)
                _ts().set_task(
                    task_id, "failed", error="Episode not found", context_id=task_context_id
                )
                return
            shot = data_service.get_shot(episode_id, shot_id, namespace_root)
            if not shot:
                _LOG.warning("[视频] 失败 task=%s: Shot not found", task_id)
                _ts().set_task(
                    task_id, "failed", error="Shot not found", context_id=task_context_id
                )
                return
            ep_dir = data_service.get_episode_dir(episode_id, namespace_root)
            if not ep_dir:
                _LOG.warning("[视频] 失败 task=%s: Episode dir not found", task_id)
                _ts().set_task(
                    task_id,
                    "failed",
                    error="Episode dir not found",
                    context_id=task_context_id,
                )
                return
            first_path = ep_dir / shot.firstFrame
            if not first_path.exists():
                _LOG.warning(
                    "[视频] 失败 task=%s: 首帧不存在 firstFrame=%s",
                    task_id,
                    shot.firstFrame,
                )
                _ts().set_task(
                    task_id,
                    "failed",
                    error="First frame not found",
                    context_id=task_context_id,
                )
                return

            resolved_model = model or _default_video_model(mode)
            resolved_duration = int(duration if duration is not None else shot.duration)
            resolved_resolution = _default_video_resolution(
                mode, resolution, is_preview=is_preview
            )
            cand_resolution = resolution_label or resolved_resolution
            aspect = _normalize_aspect_ratio(shot.aspectRatio)
            # Vidu：在提示词末尾注入台词块（译文优先、原文兜底）及 Episode 级语种标签；
            # 镜头可关闭注入（纯动作/远景等），不改 shot.videoPrompt 落库，仅影响本次 composed prompt。
            if getattr(shot, "includeDialogueInVideoPrompt", True):
                composed_video_prompt = append_dialogue_for_video_prompt(
                    shot.videoPrompt,
                    shot,
                    target_locale=ep.dubTargetLocale,
                    source_locale=ep.sourceLocale,
                )
            else:
                composed_video_prompt = shot.videoPrompt

            from services import vidu_service

            resp: dict
            if mode == "first_frame":
                resp = vidu_service.submit_img2video(
                    first_path,
                    composed_video_prompt,
                    model=resolved_model,
                    duration=resolved_duration,
                    resolution=resolved_resolution,
                    aspect_ratio=aspect,
                    seed=seed,
                )
            elif mode == "first_last_frame":
                if not shot.endFrame:
                    _LOG.warning(
                        "[首尾帧视频] 失败 task=%s shot=%s: 未设置 endFrame，请先生成尾帧",
                        task_id,
                        shot_id,
                    )
                    _ts().set_task(
                        task_id,
                        "failed",
                        error="需要先生成尾帧后再使用首尾帧模式",
                        context_id=task_context_id,
                    )
                    data_service.update_shot_status(episode_id, shot_id, "error", namespace_root)
                    return
                end_path = ep_dir / shot.endFrame
                if not end_path.exists():
                    _LOG.warning(
                        "[首尾帧视频] 失败 task=%s shot=%s: 尾帧文件不存在 path=%s",
                        task_id,
                        shot_id,
                        shot.endFrame,
                    )
                    _ts().set_task(
                        task_id,
                        "failed",
                        error=f"尾帧文件不存在: {shot.endFrame}",
                        context_id=task_context_id,
                    )
                    data_service.update_shot_status(episode_id, shot_id, "error", namespace_root)
                    return
                _LOG.info(
                    "[首尾帧视频] 提交 Vidu task=%s shot=%s model=%s 首帧=%s 尾帧=%s dur=%s res=%s",
                    task_id,
                    shot_id,
                    resolved_model,
                    shot.firstFrame,
                    shot.endFrame,
                    resolved_duration,
                    resolved_resolution,
                )
                resp = vidu_service.submit_first_last_video(
                    first_path,
                    end_path,
                    composed_video_prompt,
                    model=resolved_model,
                    duration=resolved_duration,
                    resolution=resolved_resolution,
                    aspect_ratio=aspect,
                    seed=seed,
                )
            elif mode == "reference":
                assets_dir = ep_dir / "assets"
                ref_paths: list[Path] = []
                for a in shot.assets:
                    if not a.localPath:
                        continue
                    if reference_asset_ids and a.assetId not in reference_asset_ids:
                        continue
                    p = assets_dir / a.localPath.replace("assets/", "").lstrip("/")
                    if p.exists():
                        ref_paths.append(p)
                ref_paths = ref_paths[:7]
                if not ref_paths:
                    _ts().set_task(
                        task_id,
                        "failed",
                        error="多参考图模式至少需要 1 张可用资产图",
                        context_id=task_context_id,
                    )
                    data_service.update_shot_status(episode_id, shot_id, "error", namespace_root)
                    return
                resp = vidu_service.submit_reference_video(
                    ref_paths,
                    composed_video_prompt,
                    model=resolved_model,
                    duration=resolved_duration,
                    resolution=resolved_resolution,
                    aspect_ratio=aspect,
                    with_subjects=False,
                    seed=seed,
                )
            else:
                _ts().set_task(
                    task_id,
                    "failed",
                    error=f"未知 mode: {mode}",
                    context_id=task_context_id,
                )
                return

            vidu_task_id = resp.get("task_id") or resp.get("id")
            if not vidu_task_id:
                _LOG.error(
                    "[视频] 失败 task=%s: Vidu 响应无 task_id resp_keys=%s",
                    task_id,
                    list(resp.keys()) if isinstance(resp, dict) else type(resp),
                )
                _ts().set_task(
                    task_id,
                    "failed",
                    error="Vidu 未返回 task_id",
                    context_id=task_context_id,
                )
                return

            cand_id = f"cand-{uuid.uuid4().hex[:12]}"
            cand = VideoCandidate(
                id=cand_id,
                videoPath="",
                thumbnailPath="",
                seed=int(resp.get("seed") or 0),
                model=resolved_model,
                mode=mode,
                resolution=cand_resolution,
                selected=False,
                createdAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                taskId=str(vidu_task_id),
                taskStatus="processing",
                isPreview=is_preview,
                promotedFrom=promoted_from,
            )
            data_service.add_video_candidate(
                episode_id, shot_id, cand, namespace_root
            )
            data_service.update_shot_status(
                episode_id, shot_id, "video_generating", namespace_root
            )
            _ts().set_task(
                task_id,
                "awaiting_external",
                result={"vidu_task_id": str(vidu_task_id)},
                episode_id=episode_id,
                shot_id=shot_id,
                candidate_id=cand_id,
                kind="video",
                external_task_id=str(vidu_task_id),
                context_id=task_context_id,
            )
            _LOG.info(
                "[视频] 已提交待轮询 task=%s shot=%s mode=%s vidu_task_id=%s candidate=%s model=%s",
                task_id,
                shot_id,
                mode,
                vidu_task_id,
                cand_id,
                resolved_model,
            )
    except Exception as e:
        _LOG.exception(
            "[视频] 异常 task=%s episode=%s shot=%s mode=%s: %s",
            task_id,
            episode_id,
            shot_id,
            mode,
            e,
        )
        _ts().set_task(task_id, "failed", error=str(e), context_id=task_context_id)
        try:
            data_service.update_shot_status(episode_id, shot_id, "error", namespace_root)
        except Exception:
            pass


@router.post("/generate/video", response_model=GenerateVideoResponse)
def generate_video(
    req: GenerateVideoRequest,
    background_tasks: BackgroundTasks,
    request: Request,
):
    """批量生成视频；预览模式下每镜头可提交多候选（candidateCount）。"""
    if not req.shotIds:
        raise HTTPException(status_code=400, detail="shotIds 不能为空")
    is_preview = bool(req.isPreview)
    candidate_count = int(req.candidateCount) if req.candidateCount is not None else 1
    if not is_preview:
        candidate_count = 1
    if candidate_count < 1 or candidate_count > 3:
        raise HTTPException(status_code=400, detail="candidateCount 必须在 1~3 之间")
    req_seed = _video_request_seed_int(req.seed)
    resolution_label = _default_video_resolution(
        req.mode, req.resolution, is_preview=is_preview
    )

    ns = get_namespace_data_root_optional(request)
    ns_s = str(ns) if ns is not None else None
    ctx_tid = get_context_task_id(request)

    tasks_out = []
    ref_ids = req.referenceAssetIds
    jobs: list[VideoJobSpec] = []
    for shot_id in req.shotIds:
        for _ in range(candidate_count):
            task_id = f"video-{uuid.uuid4().hex[:12]}"
            _ts().set_task(task_id, "processing", context_id=ctx_tid)
            # 与尾帧接口一致：在返回 200 前即写入镜头状态，避免前端立刻 fetchEpisode 时仍显示
            # 上一次失败残留的「出错」；后台 _run_video_gen 若校验失败会再写回 error。
            data_service.update_shot_status(
                req.episodeId, shot_id, "video_generating", ns
            )
            jobs.append(
                (
                    task_id,
                    req.episodeId,
                    shot_id,
                    req.mode,
                    req.model,
                    req.duration,
                    req.resolution,
                    ref_ids,
                    req_seed,
                    is_preview,
                    None,
                    resolution_label,
                    ns_s,
                    ctx_tid,
                )
            )
            tasks_out.append({"taskId": task_id, "shotId": shot_id})
    # #region agent log
    try:
        _dbg = _PROJECT_ROOT / ".cursor" / "debug.log"
        _dbg.parent.mkdir(parents=True, exist_ok=True)
        with open(_dbg, "a", encoding="utf-8") as _df:
            _df.write(
                json.dumps(
                    {
                        "hypothesisId": "H_race_episode",
                        "location": "generate.generate_video",
                        "message": "sync_shot_video_generating",
                        "data": {"episodeId": req.episodeId, "shotIds": list(req.shotIds)},
                        "timestamp": int(time.time() * 1000),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    except Exception:
        pass
    # #endregion
    _LOG.info(
        "[视频] 已入队 batch episode=%s mode=%s 镜头数=%d tasks=%s",
        req.episodeId,
        req.mode,
        len(jobs),
        [j[0] for j in jobs],
    )
    background_tasks.add_task(_run_video_batch_parallel, jobs)
    return GenerateVideoResponse(tasks=tasks_out)


@router.post("/generate/video/promote", response_model=GenerateVideoResponse)
def promote_video(
    req: PromoteVideoRequest,
    background_tasks: BackgroundTasks,
    request: Request,
):
    """
    基于预览候选的 seed 发起精出（更高分辨率 / 不同模型）。

    按候选 ``VideoCandidate.mode`` 分流：
    - ``first_frame``：仅首帧 i2v 精出，不要求尾帧；
    - ``first_last_frame``：与现网一致，要求尾帧路径与文件存在；
    - 其它（如 ``reference``）：本期不支持，返回 400。

    校验全部通过后才入队；任一失败返回 400（detail 为分号拼接的多条说明），不部分提交。
    """
    if not req.items:
        raise HTTPException(status_code=400, detail="items 不能为空")

    ns = get_namespace_data_root_optional(request)
    ns_s = str(ns) if ns is not None else None
    ctx_tid = get_context_task_id(request)

    ep_dir = data_service.get_episode_dir(req.episodeId, ns)
    if not ep_dir:
        raise HTTPException(status_code=400, detail="剧集目录不存在")

    err_msgs: list[str] = []
    # 每项通过校验后入列表；入队时使用 cand.mode（仅可能为 first_frame / first_last_frame）
    validated: list[tuple[str, str, Shot, VideoCandidate]] = []

    for it in req.items:
        shot = data_service.get_shot(req.episodeId, it.shotId, ns)
        if not shot:
            err_msgs.append(f"镜头 {it.shotId} 不存在")
            continue
        cand = next((c for c in shot.videoCandidates if c.id == it.candidateId), None)
        if not cand:
            err_msgs.append(f"镜头 {it.shotId} 无候选 {it.candidateId}")
            continue
        if cand.taskStatus != "success":
            err_msgs.append(
                f"镜头 {it.shotId} 候选未完成（taskStatus={cand.taskStatus}）"
            )
            continue
        if cand.seed <= 0:
            err_msgs.append(f"镜头 {it.shotId} seed 无效，无法精出")
            continue
        if not cand.isPreview:
            err_msgs.append(f"镜头 {it.shotId} 仅 isPreview 候选可精出")
            continue
        # 共用：首帧文件必须存在（first_frame / first_last_frame 均需）
        first_path = ep_dir / shot.firstFrame
        if not first_path.exists():
            err_msgs.append(
                f"镜头 {it.shotId} 首帧文件不存在: {shot.firstFrame}"
            )
            continue
        # 按预览候选 mode 分支校验；仅 first_frame 与 first_last_frame 可精出
        if cand.mode == "first_frame":
            pass
        elif cand.mode == "first_last_frame":
            if not shot.endFrame:
                err_msgs.append(f"镜头 {it.shotId} 缺少尾帧")
                continue
            end_path = ep_dir / shot.endFrame
            if not end_path.exists():
                err_msgs.append(
                    f"镜头 {it.shotId} 尾帧文件不存在: {shot.endFrame}"
                )
                continue
        else:
            err_msgs.append(
                f"镜头 {it.shotId} 精出仅支持 first_frame / first_last_frame，当前为 {cand.mode}"
            )
            continue
        validated.append((it.shotId, it.candidateId, shot, cand))

    if err_msgs:
        raise HTTPException(status_code=400, detail="；".join(err_msgs))

    resolution_label = (req.resolution or "1080p").strip() or "1080p"
    promote_model = (req.model or "viduq3-pro").strip() or "viduq3-pro"

    jobs: list[VideoJobSpec] = []
    tasks_out: list[dict[str, str]] = []

    for shot_id, candidate_id, shot, cand in validated:
        task_id = f"video-{uuid.uuid4().hex[:12]}"
        _ts().set_task(task_id, "processing", context_id=ctx_tid)
        data_service.update_shot_status(
            req.episodeId, shot_id, "video_generating", ns
        )
        # VideoJobSpec 第 4 元为 Vidu 模式：与候选一致（first_frame | first_last_frame）
        job_mode: VideoMode = cand.mode
        jobs.append(
            (
                task_id,
                req.episodeId,
                shot_id,
                job_mode,
                promote_model,
                int(shot.duration),
                req.resolution or "1080p",
                None,
                int(cand.seed),
                False,
                candidate_id,
                resolution_label,
                ns_s,
                ctx_tid,
            )
        )
        tasks_out.append({"taskId": task_id, "shotId": shot_id})

    _LOG.info(
        "[精出] 已入队 promote episode=%s 条数=%d tasks=%s",
        req.episodeId,
        len(jobs),
        [j[0] for j in jobs],
    )
    background_tasks.add_task(_run_video_batch_parallel, jobs)
    return GenerateVideoResponse(tasks=tasks_out)


def _resolve_regen_asset_paths(
    ep: Episode,
    shot: Shot,
    asset_ids: list[str],
    ep_dir: Path,
) -> list[Path]:
    """
    按请求中的 asset_ids 顺序解析本地资产文件路径（最多 2 个）。

    与前端资产库一致：合并 **剧集级** ``episode.assets`` 与 **镜头级** ``shot.assets`` 的元数据，
    同一 assetId 以镜头级记录覆盖剧集级（与拉取后镜头上挂接为准）。
    仅当 ``assets/`` 下文件存在时加入列表；未知 id 或缺文件会跳过（不中断任务）。
    """
    by_id: dict[str, ShotAsset] = {}
    for a in ep.assets:
        by_id[a.assetId] = a
    for a in shot.assets:
        by_id[a.assetId] = a
    assets_dir = ep_dir / "assets"
    out: list[Path] = []
    for aid in asset_ids:
        meta = by_id.get(aid)
        if not meta:
            continue
        p = assets_dir / meta.localPath.replace("assets/", "").lstrip("/")
        if p.exists():
            out.append(p)
        if len(out) >= 2:
            break
    return out


def _run_regen_frame(
    task_id: str,
    episode_id: str,
    shot_id: str,
    image_prompt: str,
    asset_ids: list[str],
    *,
    namespace_root: Path | None = None,
    task_context_id: str | None = None,
):
    """
    同步执行单帧重生。Yunwu 在锁外；落盘与 update_shot 在 episode_fs_lock 内并重新解析 ep_dir。

    namespace_root / task_context_id 与尾帧、视频任务一致：多上下文时在 data/{env}/{ws}/ 下读写，并写入 tasks.context_id。
    """
    fs_tag = fs_lock_tag_from_namespace_root(namespace_root)
    lock_kw = {"data_namespace": fs_tag} if fs_tag else {}
    try:
        ep = data_service.get_episode(episode_id, namespace_root)
        if not ep:
            _ts().set_task(
                task_id, "failed", error="Episode not found", context_id=task_context_id
            )
            return
        shot = data_service.get_shot(episode_id, shot_id, namespace_root)
        if not shot:
            _ts().set_task(
                task_id, "failed", error="Shot not found", context_id=task_context_id
            )
            return
        ep_dir = data_service.get_episode_dir(episode_id, namespace_root)
        if not ep_dir:
            _ts().set_task(
                task_id, "failed", error="Episode dir not found", context_id=task_context_id
            )
            return
        first_path = ep_dir / shot.firstFrame
        if not first_path.exists():
            _ts().set_task(
                task_id, "failed", error="First frame not found", context_id=task_context_id
            )
            return
        asset_paths = _resolve_regen_asset_paths(ep, shot, asset_ids or [], ep_dir)
        from services.yunwu_service import regenerate_first_frame

        img_data = regenerate_first_frame(first_path, image_prompt, asset_paths)
        with episode_fs_lock(episode_id, **lock_kw):
            ep_dir_write = data_service.get_episode_dir(episode_id, namespace_root)
            if not ep_dir_write:
                _ts().set_task(
                    task_id,
                    "failed",
                    error="Episode dir not found after regeneration",
                    context_id=task_context_id,
                )
                return
            frame_path = ep_dir_write / shot.firstFrame
            frame_path.parent.mkdir(parents=True, exist_ok=True)
            frame_path.write_bytes(img_data)
            data_service.update_shot(
                episode_id,
                shot_id,
                {
                    "imagePrompt": image_prompt,
                    "endFrame": None,
                    "videoCandidates": [],
                    "status": "pending",
                },
                namespace_root,
            )
        _ts().set_task(
            task_id,
            "success",
            result={"newFramePath": shot.firstFrame},
            context_id=task_context_id,
        )
    except Exception as e:
        _ts().set_task(task_id, "failed", error=str(e), context_id=task_context_id)


def _run_regen_batch_wan27(
    task_id: str,
    episode_id: str,
    shot_ids: list[str],
    asset_ids: list[str],
    model: str,
    size: str,
    *,
    namespace_root: Path | None = None,
    task_context_id: str | None = None,
) -> None:
    """
    万相 2.7 组图异步批量重生：锁外调用 DashScope；锁内按序写回各镜首帧并清空尾帧/视频候选。

    资产解析与单帧重生一致：以 ``shot_ids[0]`` 对应镜头为基准调用 ``_resolve_regen_asset_paths``。
    v1 不修改各镜 ``imagePrompt``，避免与用户在其它入口编辑的文案漂移。
    """
    fs_tag = fs_lock_tag_from_namespace_root(namespace_root)
    lock_kw: dict[str, str] = {"data_namespace": fs_tag} if fs_tag else {}
    try:
        ep = data_service.get_episode(episode_id, namespace_root)
        if not ep:
            _ts().set_task(
                task_id, "failed", error="Episode not found", context_id=task_context_id
            )
            return
        ep_dir = data_service.get_episode_dir(episode_id, namespace_root)
        if not ep_dir:
            _ts().set_task(
                task_id, "failed", error="Episode dir not found", context_id=task_context_id
            )
            return

        ordered: list[Shot] = []
        for sid in shot_ids:
            sh = data_service.get_shot(episode_id, sid, namespace_root)
            if not sh:
                _ts().set_task(
                    task_id,
                    "failed",
                    error=f"Shot not found: {sid}",
                    context_id=task_context_id,
                )
                return
            first_path = ep_dir / sh.firstFrame
            if not first_path.exists():
                _ts().set_task(
                    task_id,
                    "failed",
                    error=f"First frame not found for shot {sid}: {sh.firstFrame}",
                    context_id=task_context_id,
                )
                return
            ordered.append(sh)

        api_key = (os.environ.get("DASHSCOPE_API_KEY") or "").strip()
        if not api_key:
            _ts().set_task(
                task_id,
                "failed",
                error="DASHSCOPE_API_KEY not set",
                context_id=task_context_id,
            )
            return

        first_shot = ordered[0]
        asset_paths = _resolve_regen_asset_paths(ep, first_shot, asset_ids or [], ep_dir)

        from src.wan27.client import resolve_base_url
        from services.wan27_batch_service import run_wan27_sequential_for_shots

        img_list = run_wan27_sequential_for_shots(
            api_key=api_key,
            base_url=resolve_base_url(),
            model=model,
            size=size,
            ordered_shots=ordered,
            ref_asset_paths=asset_paths,
        )

        with episode_fs_lock(episode_id, **lock_kw):
            ep_dir_write = data_service.get_episode_dir(episode_id, namespace_root)
            if not ep_dir_write:
                _ts().set_task(
                    task_id,
                    "failed",
                    error="Episode dir not found after Wan27 batch",
                    context_id=task_context_id,
                )
                return
            for sh, blob in zip(ordered, img_list):
                frame_path = ep_dir_write / sh.firstFrame
                frame_path.parent.mkdir(parents=True, exist_ok=True)
                frame_path.write_bytes(blob)
                data_service.update_shot(
                    episode_id,
                    sh.shotId,
                    {
                        "endFrame": None,
                        "videoCandidates": [],
                        "status": "pending",
                    },
                    namespace_root,
                )

        _ts().set_task(
            task_id,
            "success",
            result={"shotIds": shot_ids, "imageCount": len(img_list)},
            context_id=task_context_id,
        )
    except Exception as e:
        _ts().set_task(task_id, "failed", error=str(e), context_id=task_context_id)


@router.post("/generate/regen-frame", response_model=RegenFrameResponse)
def regen_frame(
    req: RegenFrameRequest,
    background_tasks: BackgroundTasks,
    request: Request,
):
    """单帧重生。"""
    task_id = f"regen-{uuid.uuid4().hex[:12]}"
    ns = get_namespace_data_root_optional(request)
    ctx_tid = get_context_task_id(request)
    _ts().set_task(
        task_id,
        "processing",
        kind="regen",
        episode_id=req.episodeId,
        shot_id=req.shotId,
        payload={
            "imagePrompt": req.imagePrompt,
            "assetIds": req.assetIds or [],
        },
        context_id=ctx_tid,
    )
    background_tasks.add_task(
        _run_regen_frame,
        task_id,
        req.episodeId,
        req.shotId,
        req.imagePrompt,
        req.assetIds or [],
        namespace_root=ns,
        task_context_id=ctx_tid,
    )
    shot = data_service.get_shot(req.episodeId, req.shotId, ns)
    return RegenFrameResponse(
        taskId=task_id,
        shotId=req.shotId,
        newFramePath=shot.firstFrame if shot else "",
    )


@router.post("/generate/regen-batch-wan27", response_model=RegenBatchWan27Response)
def regen_batch_wan27(
    req: RegenBatchWan27Request,
    background_tasks: BackgroundTasks,
    request: Request,
):
    """
    万相 2.7 组图：按顺序对 1～12 个镜头重生首帧，异步任务 + taskId 轮询。
    """
    n = len(req.shotIds)
    if not 1 <= n <= 12:
        raise HTTPException(
            status_code=400,
            detail="万相组图一批仅支持 1～12 个镜头",
        )
    task_id = f"wan27-{uuid.uuid4().hex[:12]}"
    ns = get_namespace_data_root_optional(request)
    ctx_tid = get_context_task_id(request)
    _ts().set_task(
        task_id,
        "processing",
        kind="regen_wan27_batch",
        episode_id=req.episodeId,
        shot_id=req.shotIds[0],
        payload={
            "shotIds": req.shotIds,
            "assetIds": req.assetIds or [],
            "model": req.model,
            "size": req.size,
        },
        context_id=ctx_tid,
    )
    background_tasks.add_task(
        _run_regen_batch_wan27,
        task_id,
        req.episodeId,
        req.shotIds,
        req.assetIds or [],
        req.model,
        req.size,
        namespace_root=ns,
        task_context_id=ctx_tid,
    )
    return RegenBatchWan27Response(
        taskId=task_id,
        episodeId=req.episodeId,
        shotCount=n,
    )
