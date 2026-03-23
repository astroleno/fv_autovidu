# -*- coding: utf-8 -*-
"""
剪映草稿导出服务

职责：
- 从 Episode 收集可导出视频候选（有 videoPath；优先 selected，否则第一条），按分镜叙事顺序排列
- 将素材复制到 `export/jianying/{draftId}/materials/`，生成最小 `draft_info.json` / `draft_meta_info.json`
- 将草稿目录复制到本机剪映草稿根目录（同机部署）；不生成 ZIP（避免与「导出到剪映」语义重复）

注意：剪映私有协议可能随版本变化；字段以实机验证为准（见 docs/剪映与配音接入方案）。
"""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from models.schemas import Episode, JianyingExportRecord, JianyingExportRequest, Shot

from services import data_service
from services.audio_service import probe_duration_sec
from services.candidate_pick import pick_playable_video_candidate
from services.jianying_protocol import (
    PROTOCOL_TEMPLATE_VERSION,
    USEC_PER_SEC,
    canvas_wh,
)


def _flatten_shots_narrative_order(episode: Episode) -> list[Shot]:
    """按场景顺序 + 镜头顺序展开所有 Shot。"""
    out: list[Shot] = []
    for scene in episode.scenes:
        out.extend(scene.shots)
    return out


def collect_exportable_shots(
    episode: Episode,
    ep_dir: Path,
    shot_ids: list[str] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    收集可导出的分镜（至少一条候选已落盘 videoPath；选取规则见 candidate_pick）。

    Returns:
        exportable: 每项含 shotId, candidateId, videoAbs, videoRelative, durationSec
        missing_shots: 无法导出的 shotId（显式请求却缺素材，或叙事中应出现但无选中视频）
    """
    wanted: set[str] | None = set(shot_ids) if shot_ids else None
    ordered = _flatten_shots_narrative_order(episode)
    exportable: list[dict[str, Any]] = []
    missing: list[str] = []

    for shot in ordered:
        if wanted is not None and shot.shotId not in wanted:
            continue
        cand = pick_playable_video_candidate(shot)
        if not cand or not cand.videoPath:
            if wanted is None or (wanted and shot.shotId in wanted):
                missing.append(shot.shotId)
            continue
        abs_path = (ep_dir / cand.videoPath).resolve()
        if not abs_path.is_file():
            missing.append(shot.shotId)
            continue
        dur = probe_duration_sec(abs_path)
        if dur is None or dur <= 0:
            dur = float(shot.duration or 5)
        exportable.append(
            {
                "shotId": shot.shotId,
                "candidateId": cand.id,
                "videoAbs": abs_path,
                "videoRelative": cand.videoPath,
                "durationSec": dur,
                "shot": shot,
            }
        )

    # 显式请求的 shotId 不在剧集中
    if wanted:
        narrative_ids = {s.shotId for s in ordered}
        for sid in wanted:
            if sid not in narrative_ids:
                missing.append(sid)

    # 去重保持顺序
    seen: set[str] = set()
    deduped: list[str] = []
    for m in missing:
        if m not in seen:
            seen.add(m)
            deduped.append(m)
    missing = deduped

    return exportable, missing


def _duration_usec(duration_sec: float) -> int:
    return max(1, int(duration_sec * USEC_PER_SEC))


def build_draft_info(
    draft_id: str,
    draft_name: str,
    items: list[dict[str, Any]],
    materials_rel_paths: list[str],
    canvas_width: int,
    canvas_height: int,
    audio_items: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    构建 draft_info.json 字典（最小字段集）。

    Args:
        draft_id: 草稿 UUID
        draft_name: 显示名称
        items: collect_exportable_shots 结果，且已绑定 materials 内相对路径键 `materialRel`
        materials_rel_paths: 与 items 顺序一致的视频素材相对路径（位于草稿根目录下）
        canvas_width/canvas_height: 像素画布
        audio_items: 可选；与视频片段时间对齐的配音素材（Phase 3），每项含 materialRel、durationSec
    """
    materials_videos: list[dict[str, Any]] = []
    video_segments: list[dict[str, Any]] = []
    materials_audios: list[dict[str, Any]] = []
    audio_segments: list[dict[str, Any]] = []

    timeline_offset = 0
    audio_items = audio_items or []

    for i, row in enumerate(items):
        rel = materials_rel_paths[i]
        material_id = str(uuid.uuid4())
        dur_sec = float(row["durationSec"])
        dur_us = _duration_usec(dur_sec)

        materials_videos.append(
            {
                "id": material_id,
                "path": rel,
                "duration": dur_us,
                "type": "video",
            }
        )
        video_segments.append(
            {
                "id": str(uuid.uuid4()),
                "material_id": material_id,
                "target_timerange": {
                    "start": timeline_offset,
                    "duration": dur_us,
                },
                "source_timerange": {
                    "start": 0,
                    "duration": dur_us,
                },
            }
        )

        if i < len(audio_items) and audio_items[i]:
            a = audio_items[i]
            ap = a.get("materialRel")
            if ap:
                audio_material_id = str(uuid.uuid4())
                a_dur_sec = float(a.get("durationSec") or dur_sec)
                a_us = _duration_usec(a_dur_sec)
                materials_audios.append(
                    {
                        "id": audio_material_id,
                        "path": ap,
                        "duration": a_us,
                        "type": "audio",
                    }
                )
                audio_segments.append(
                    {
                        "id": str(uuid.uuid4()),
                        "material_id": audio_material_id,
                        "target_timerange": {
                            "start": timeline_offset,
                            "duration": a_us,
                        },
                        "source_timerange": {
                            "start": 0,
                            "duration": a_us,
                        },
                    }
                )

        timeline_offset += dur_us

    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    return {
        "draft_template_version": PROTOCOL_TEMPLATE_VERSION,
        "id": draft_id,
        "name": draft_name,
        "canvas_config": {
            "width": canvas_width,
            "height": canvas_height,
        },
        "duration": timeline_offset,
        "materials": {
            "videos": materials_videos,
            "audios": materials_audios,
        },
        "tracks": [
            {"type": "video", "segments": video_segments},
            {"type": "audio", "segments": audio_segments},
        ],
        "create_time": now_ts,
        "update_time": now_ts,
    }


def build_draft_meta_info(draft_id: str, draft_name: str) -> dict[str, Any]:
    """生成 draft_meta_info.json 最小内容。"""
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    return {
        "draft_id": draft_id,
        "draft_name": draft_name,
        "tm_create": now_ts,
        "tm_modify": now_ts,
        "draft_template_version": PROTOCOL_TEMPLATE_VERSION,
    }


def _detect_dub_audio_rows(
    ep_dir: Path,
    items: list[dict[str, Any]],
) -> list[dict[str, Any] | None]:
    """
    若 Shot 上存在已完成的 dub 且 sourceCandidateId 与当前选中一致，则返回配音素材行。

    否则对应位置为 None（占位，不铺音频轨）。
    """
    rows: list[dict[str, Any] | None] = []
    for row in items:
        shot: Shot = row["shot"]
        dub = getattr(shot, "dub", None)
        if not dub:
            rows.append(None)
            continue
        status = getattr(dub, "status", None)
        if status != "completed":
            rows.append(None)
            continue
        if getattr(dub, "sourceCandidateId", None) != row.get("candidateId"):
            rows.append(None)
            continue
        ap = getattr(dub, "audioPath", None)
        if not ap:
            rows.append(None)
            continue
        abs_audio = (ep_dir / ap).resolve()
        if not abs_audio.is_file():
            rows.append(None)
            continue
        dsec = probe_duration_sec(abs_audio) or float(row["durationSec"])
        rows.append({"materialRel": "", "durationSec": dsec, "_abs": abs_audio})
    return rows


def export_jianying_draft(
    req: JianyingExportRequest,
    *,
    include_dub_audio: bool = True,
) -> dict[str, Any]:
    """
    执行剪映草稿导出，写入磁盘并更新 episode.jianyingExport。

    Args:
        req: 请求体（含 episodeId）
        include_dub_audio: 是否铺配音轨（依赖 shot.dub 已存在且与选中候选一致）

    Returns:
        适合 JianyingExportResponse 序列化的 dict
    """
    episode_id = req.episodeId
    ep = data_service.get_episode(episode_id)
    if not ep:
        raise ValueError("Episode not found")
    ep_dir = data_service.get_episode_dir(episode_id)
    if not ep_dir:
        raise ValueError("Episode dir not found")

    exportable, missing = collect_exportable_shots(ep, ep_dir, req.shotIds)
    if not exportable:
        raise ValueError("没有可导出的已选视频，请确认分镜已选定视频且文件存在")

    draft_id = str(uuid.uuid4())
    draft_name = ep.episodeTitle or episode_id
    w, h = canvas_wh(req.canvasSize)

    draft_root = ep_dir / "export" / "jianying" / draft_id
    draft_root.mkdir(parents=True, exist_ok=True)
    materials_dir = draft_root / "materials"
    materials_dir.mkdir(parents=True, exist_ok=True)

    rel_paths: list[str] = []
    dub_rows = _detect_dub_audio_rows(ep_dir, exportable) if include_dub_audio else [None] * len(exportable)

    audio_for_build: list[dict[str, Any]] = []
    for i, row in enumerate(exportable):
        ext = row["videoAbs"].suffix or ".mp4"
        safe = f"{i + 1:03d}_{row['shotId']}{ext}"
        dst = materials_dir / safe
        shutil.copy2(row["videoAbs"], dst)
        rel = f"materials/{safe}"
        rel_paths.append(rel)
        row["materialRel"] = rel

        dub_entry: dict[str, Any] | None = None
        if i < len(dub_rows) and dub_rows[i]:
            d = dub_rows[i]
            abs_a = d["_abs"]
            aext = abs_a.suffix or ".mp3"
            asafe = f"{i + 1:03d}_{row['shotId']}_dub{aext}"
            adst = materials_dir / asafe
            shutil.copy2(abs_a, adst)
            arel = f"materials/{asafe}"
            dub_entry = {"materialRel": arel, "durationSec": d["durationSec"]}
        audio_for_build.append(dub_entry or {})

    info = build_draft_info(
        draft_id,
        draft_name,
        exportable,
        rel_paths,
        w,
        h,
        audio_items=audio_for_build,
    )
    meta = build_draft_meta_info(draft_id, draft_name)

    (draft_root / "draft_info.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (draft_root / "draft_meta_info.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # 不再生成 ZIP；episode 记录仍保留 zipPath 字段以兼容旧 JSON，恒为 None
    zip_rel: str | None = None

    target_root = Path(req.draftPath).expanduser().resolve()
    target_root.mkdir(parents=True, exist_ok=True)
    dest = target_root / draft_id
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(draft_root, dest)
    jianying_copy_abs = str(dest.resolve())

    exported_at = datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z")
    ep.jianyingExport = JianyingExportRecord(
        lastExportedAt=exported_at,
        draftId=draft_id,
        zipPath=zip_rel,
        draftDirRelative=str(draft_root.relative_to(ep_dir)),
    )
    data_service.persist_episode(ep)

    draft_dir_abs = str(draft_root.resolve())
    return {
        "draftId": draft_id,
        "draftDir": draft_dir_abs,
        "zipPath": zip_rel,
        "jianyingCopyPath": jianying_copy_abs,
        "exportedShots": len(exportable),
        "missingShots": missing,
        "exportedAt": exported_at,
    }


def guess_jianying_draft_root_candidates() -> list[str]:
    """
    返回本机可能存在的剪映草稿根目录候选路径（用于 draftPath）。

    剪映国内版实际写入目录多为 ``Projects/com.lveditor.draft``。
    若该子目录存在，**只返回该路径**，不再追加父级 ``Projects``，避免 UI 上出现
    「同一根目录两种写法」的重复按钮（用户只需使用侦测到的唯一地址）。
    若子目录不存在但 ``Projects`` 存在，则退回父级路径供用户自行核对剪映设置。
    """
    home = Path.home()
    bases = [
        home / "Movies" / "JianyingPro" / "User Data" / "Projects",
        home / "Library" / "Application Support" / "JianyingPro" / "User Data" / "Projects",
        home / "Movies" / "CapCut" / "User Data" / "Projects",
    ]
    out: list[str] = []
    seen: set[str] = set()
    for base in bases:
        try:
            if not base.is_dir():
                continue
            sub = base / "com.lveditor.draft"
            if sub.is_dir():
                s = str(sub.resolve())
                if s not in seen:
                    seen.add(s)
                    out.append(s)
                # 已命中标准草稿根，不再追加 base，避免与 sub 并列造成混淆
                continue
            root_s = str(base.resolve())
            if root_s not in seen:
                seen.add(root_s)
                out.append(root_s)
        except OSError:
            continue
    return out
