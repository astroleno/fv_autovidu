# -*- coding: utf-8 -*-
"""
配音路由：ElevenLabs STS / TTS

- 每个分镜返回独立 dub-* taskId，前端复用 GET /api/tasks 轮询
- 处理在后台线程中执行；通过 Semaphore 限制并发，HTTP 立即返回
"""

from __future__ import annotations

import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from fastapi import APIRouter, HTTPException

from models.schemas import (
    DubEpisodeStatusResponse,
    DubProcessRequest,
    DubProcessResponse,
    DubProcessShotRequest,
    DubStatus,
    DubTaskItem,
)
from services import data_service
from services.audio_service import (
    extract_audio_from_video,
    has_audio_stream,
)
from services import elevenlabs_service

router = APIRouter()


def _iso_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _suffix_from_content_type(ct: str) -> str:
    c = (ct or "").lower()
    if "mpeg" in c or "mp3" in c:
        return ".mp3"
    if "wav" in c:
        return ".wav"
    return ".mp3"


def _run_dub_task(
    task_id: str,
    episode_id: str,
    shot_id: str,
    voice_id: str,
    mode: str,
    tts_text: str | None,
) -> None:
    """在后台线程执行单镜配音并更新 episode.json。"""
    from routes.tasks import set_local_task

    set_local_task(
        task_id,
        "processing",
        kind="dub",
        episode_id=episode_id,
        shot_id=shot_id,
        result={},
    )

    ep_dir = data_service.get_episode_dir(episode_id)
    if not ep_dir:
        set_local_task(
            task_id,
            "failed",
            kind="dub",
            episode_id=episode_id,
            shot_id=shot_id,
            error="剧集目录不存在",
        )
        return

    shot = data_service.get_shot(episode_id, shot_id)
    if not shot:
        set_local_task(
            task_id,
            "failed",
            kind="dub",
            episode_id=episode_id,
            shot_id=shot_id,
            error="分镜不存在",
        )
        return

    selected = next((c for c in shot.videoCandidates if c.selected), None)
    if not selected or not selected.videoPath:
        err = "无已选视频候选，无法配音"
        data_service.set_shot_dub(
            episode_id,
            shot_id,
            DubStatus(
                status="failed",
                taskId=task_id,
                error=err,
                voiceId=voice_id,
                mode=mode,
            ),
        )
        set_local_task(
            task_id,
            "failed",
            kind="dub",
            episode_id=episode_id,
            shot_id=shot_id,
            error=err,
        )
        return

    dub_dir = ep_dir / "dub"
    dub_dir.mkdir(parents=True, exist_ok=True)
    video_abs = (ep_dir / selected.videoPath).resolve()

    data_service.set_shot_dub(
        episode_id,
        shot_id,
        DubStatus(
            status="processing",
            sourceCandidateId=selected.id,
            mode=mode,
            voiceId=voice_id,
            taskId=task_id,
        ),
    )

    try:
        original_rel: str | None = None
        if mode == "tts":
            text = (tts_text or "").strip() or (shot.videoPrompt or "").strip()
            if not text:
                raise ValueError("TTS 模式需要提供文本或 shot.videoPrompt")
            audio_bytes, ct = elevenlabs_service.text_to_speech(voice_id, text)
            ext = _suffix_from_content_type(ct)
        else:
            if not has_audio_stream(video_abs):
                raise ValueError("当前视频无音轨，请改用 TTS 模式或更换素材")
            wav_path = dub_dir / f"{shot_id}_src.wav"
            extract_audio_from_video(video_abs, wav_path)
            original_rel = f"dub/{shot_id}_src.wav"
            audio_bytes, ct = elevenlabs_service.speech_to_speech(
                voice_id,
                wav_path.read_bytes(),
            )
            ext = _suffix_from_content_type(ct)

        out_rel = f"dub/{shot_id}_dub{ext}"
        (ep_dir / out_rel).write_bytes(audio_bytes)

        dub_done = DubStatus(
            status="completed",
            sourceCandidateId=selected.id,
            mode=mode,
            voiceId=voice_id,
            audioPath=out_rel,
            originalAudioPath=original_rel,
            taskId=task_id,
            error=None,
            processedAt=_iso_now(),
        )
        data_service.set_shot_dub(episode_id, shot_id, dub_done)
        set_local_task(
            task_id,
            "success",
            kind="dub",
            episode_id=episode_id,
            shot_id=shot_id,
            result={"audioPath": out_rel, "mode": mode},
        )
    except Exception as exc:  # pylint: disable=broad-except
        err = str(exc)
        data_service.set_shot_dub(
            episode_id,
            shot_id,
            DubStatus(
                status="failed",
                sourceCandidateId=selected.id,
                mode=mode,
                voiceId=voice_id,
                taskId=task_id,
                error=err,
            ),
        )
        set_local_task(
            task_id,
            "failed",
            kind="dub",
            episode_id=episode_id,
            shot_id=shot_id,
            error=err,
        )


def _collect_dub_shot_ids(episode_id: str, shot_ids: list[str] | None) -> list[str]:
    """确定要处理的分镜 ID 列表（默认：全部有已选候选的分镜）。"""
    ep = data_service.get_episode(episode_id)
    if not ep:
        return []
    out: list[str] = []
    for scene in ep.scenes:
        for shot in scene.shots:
            if shot_ids and shot.shotId not in shot_ids:
                continue
            sel = next((c for c in shot.videoCandidates if c.selected), None)
            if sel and sel.videoPath:
                out.append(shot.shotId)
    return out


@router.get("/dub/configured")
def dub_configured():
    """ElevenLabs 是否已配置 API Key。"""
    return {"configured": elevenlabs_service.is_configured()}


@router.get("/dub/voices")
def dub_voices():
    """列出可用音色（简化字段）。"""
    if not elevenlabs_service.is_configured():
        raise HTTPException(status_code=503, detail="未配置 ELEVENLABS_API_KEY")
    try:
        raw = elevenlabs_service.list_voices()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    simplified = []
    for v in raw:
        vid = v.get("voice_id") or v.get("voiceId")
        if not vid:
            continue
        simplified.append(
            {
                "voiceId": vid,
                "name": v.get("name") or vid,
                "labels": v.get("labels") or {},
            }
        )
    return {"voices": simplified}


@router.get("/dub/status/{episode_id}", response_model=DubEpisodeStatusResponse)
def dub_status(episode_id: str):
    """查询各分镜 dub 状态摘要。"""
    ep = data_service.get_episode(episode_id)
    if not ep:
        raise HTTPException(status_code=404, detail="Episode not found")
    rows: list[dict[str, Any]] = []
    for scene in ep.scenes:
        for shot in scene.shots:
            d = shot.dub.model_dump(mode="json") if shot.dub else None
            rows.append({"shotId": shot.shotId, "dub": d})
    return DubEpisodeStatusResponse(episodeId=episode_id, shots=rows)


@router.post("/dub/process", response_model=DubProcessResponse)
def dub_process(req: DubProcessRequest):
    """批量配音：为每个分镜启动后台任务并立即返回 taskId 列表。"""
    if not elevenlabs_service.is_configured():
        raise HTTPException(status_code=503, detail="未配置 ELEVENLABS_API_KEY")
    ids = _collect_dub_shot_ids(req.episodeId, req.shotIds)
    if not ids:
        raise HTTPException(status_code=400, detail="没有可配音的已选分镜")

    max_c = max(1, min(req.concurrency or 2, 8))
    sem = threading.Semaphore(max_c)
    tasks_out: list[DubTaskItem] = []

    for sid in ids:
        task_id = f"dub-{uuid.uuid4().hex}"
        tasks_out.append(DubTaskItem(taskId=task_id, shotId=sid))

        def _job(
            tid: str = task_id,
            shot: str = sid,
        ) -> None:
            with sem:
                _run_dub_task(
                    tid,
                    req.episodeId,
                    shot,
                    req.voiceId,
                    req.mode,
                    None,
                )

        threading.Thread(target=_job, daemon=True).start()

    return DubProcessResponse(tasks=sorted(tasks_out, key=lambda x: x.shotId))


@router.post("/dub/process-shot", response_model=DubTaskItem)
def dub_process_shot(req: DubProcessShotRequest):
    """单镜配音。"""
    if not elevenlabs_service.is_configured():
        raise HTTPException(status_code=503, detail="未配置 ELEVENLABS_API_KEY")
    task_id = f"dub-{uuid.uuid4().hex}"

    def _job() -> None:
        _run_dub_task(
            task_id,
            req.episodeId,
            req.shotId,
            req.voiceId,
            req.mode,
            req.ttsText,
        )

    threading.Thread(target=_job, daemon=True).start()
    return DubTaskItem(taskId=task_id, shotId=req.shotId)
