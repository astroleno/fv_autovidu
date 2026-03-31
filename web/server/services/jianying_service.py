# -*- coding: utf-8 -*-
"""
剪映草稿导出服务

职责：
- 从 Episode 收集可导出视频候选（有 videoPath；优先 selected，否则第一条），按分镜叙事顺序排列
- 将素材复制到 `export/jianying/{draftId}/Resources/`
- 按 reference/migration-packages 验证过的最小未加密结构写出
  `draft_info.json` / `draft_content.json` / `draft_meta_info.json` / `draft_virtual_store.json`
- 将草稿目录复制到本机剪映草稿根目录（同机部署）；不生成 ZIP

注意：剪映 6+ 可能对「由软件保存」的草稿加密；**由本工具生成的未加密 JSON** 在多数版本可导入。
若仍空白，请记录剪映版本并反馈。
"""

from __future__ import annotations

import json
import hashlib
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

# 与 video_finalizer 一致：保证可 import src.feeling（uvicorn 仅挂 web/server 时）
_JY_ROOT = Path(__file__).resolve().parents[3]
if str(_JY_ROOT) not in sys.path:
    sys.path.insert(0, str(_JY_ROOT))

from src.feeling.episode_fs_lock import episode_fs_lock

from models.schemas import Episode, JianyingExportRecord, JianyingExportRequest, Shot

from services import data_service
from services.audio_service import probe_duration_sec
from services.candidate_pick import pick_playable_video_candidate
from services.jianying_ffprobe_materials import probe_video_material_fields
from services.jianying_protocol import canvas_wh_vertical_9_16
from services.jianying_text_track import build_text_track_payload, subtitle_text_from_shot


_DRAFT_AGENCY_CONFIG = {
    "is_auto_agency_enabled": False,
    "is_auto_agency_popup": False,
    "is_single_agency_mode": False,
    "marterials": None,
    "use_converter": False,
    "video_resolution": 720,
}

_ATTACHMENT_EDITING = {
    "editing_draft": {
        "ai_remove_filter_words": {"enter_source": "", "right_id": ""},
        "ai_shorts_info": {"report_params": "", "type": 0},
        "crop_info_extra": {
            "crop_mirror_type": 0,
            "crop_rotate": 0.0,
            "crop_rotate_total": 0.0,
        },
        "digital_human_template_to_video_info": {
            "has_upload_material": False,
            "template_type": 0,
        },
        "draft_removable_storage_device": "",
        "is_from_deeplink": False,
        "is_social_text": False,
        "multi_language_info": {
            "main_language": "none",
            "multi_language_current": "none",
            "multi_language_list": [],
        },
        "note_info": {"content": "", "visible": False},
        "package_download_info": [],
        "project_cover_info": {
            "is_cover_changed": False,
            "source": 0,
            "source_cover_start_tm": 0,
        },
        "timeline_select_info": {"is_on": False, "items": []},
    }
}

_ATTACHMENT_PC_COMMON = {
    "ai_packaging_infos": [],
    "ai_packaging_report_info": {
        "caption_id_list": [],
        "commercial_material": "",
        "material_source": "",
        "method": "",
        "page_from": "",
        "style": "",
        "task_id": "",
        "text_style": "",
        "tos_id": "",
        "video_category": "",
    },
    "broll": {
        "ai_packaging_infos": [],
        "ai_packaging_report_info": {
            "caption_id_list": [],
            "commercial_material": "",
            "material_source": "",
            "method": "",
            "page_from": "",
            "style": "",
            "task_id": "",
            "text_style": "",
            "tos_id": "",
            "video_category": "",
        },
    },
}

_ATTACHMENT_ACTION_SCENE = {"action_scene": {"removed_segments": [], "segment_infos": []}}
_ATTACHMENT_PC_TIMELINE = {
    "reference_lines_config": {
        "horizontal_lines": [],
        "is_lock": False,
        "is_visible": False,
        "vertical_lines": [],
    },
    "safe_area_type": 0,
}
_ATTACHMENT_SCRIPT_VIDEO = {
    "script_video": {
        "attachment_valid": False,
        "language": "",
        "overdub_recover": [],
        "overdub_sentence_ids": [],
        "parts": [],
        "sync_subtitle": False,
        "translate_segments": [],
        "translate_type": "",
        "version": "1.0.0",
    }
}


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


def _seconds_to_us(seconds: float) -> int:
    return max(1, int(float(seconds or 0) * 1_000_000))


def _default_crop() -> dict[str, float]:
    return {
        "upper_left_x": 0,
        "upper_left_y": 0,
        "upper_right_x": 1,
        "upper_right_y": 0,
        "lower_left_x": 0,
        "lower_left_y": 1,
        "lower_right_x": 1,
        "lower_right_y": 1,
    }


def _protocol_file_name(shot_id: str, abs_path: Path) -> str:
    ext = abs_path.suffix or ".mp4"
    digest = hashlib.md5(str(abs_path.resolve()).encode("utf-8")).hexdigest()[:8]
    return f"{digest}_{shot_id}{ext}"


def _build_reference_track(track_type: str) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "name": "",
        "is_default_name": True,
        "type": track_type,
        "segments": [],
    }


def _create_base_draft_info(draft_id: str, width: int, height: int, duration_us: int) -> dict[str, Any]:
    return {
        "canvas_config": {
            "width": width,
            "height": height,
            "ratio": "original",
        },
        "duration": duration_us,
        "render_index_track_mode_on": True,
        "config": {
            "maintrack_adsorb": False,
        },
        "color_space": 0,
        "fps": 30,
        "id": draft_id,
        "materials": {
            "videos": [],
            "texts": [],
            "audios": [],
            "stickers": [],
            "speeds": [],
            "effects": [],
            "video_effects": [],
            "placeholders": [],
            "transitions": [],
            "material_animations": [],
        },
        "tracks": [],
    }


def _create_base_draft_meta_info(draft_name: str) -> dict[str, Any]:
    return {
        "draft_materials": [
            {"type": 0, "value": []},
            {"type": 1, "value": []},
            {"type": 2, "value": []},
        ],
        "draft_name": draft_name,
    }


def _create_base_draft_virtual_store() -> dict[str, Any]:
    now_sec = int(datetime.now(tz=timezone.utc).timestamp())
    now_us = int(datetime.now(tz=timezone.utc).timestamp() * 1_000_000)
    return {
        "draft_materials": [],
        "draft_virtual_store": [
            {
                "type": 0,
                "value": [
                    {
                        "creation_time": now_sec,
                        "display_name": "",
                        "filter_type": 0,
                        "id": "",
                        "import_time": now_sec,
                        "import_time_us": now_us,
                        "sort_sub_type": 0,
                        "sort_type": 0,
                    }
                ],
            },
            {
                "type": 1,
                "value": [],
            },
            {
                "type": 2,
                "value": [],
            },
        ],
    }


def _write_jianying_draft_pyjdraft(
    draft_root: Path,
    draft_id: str,
    draft_name: str,
    exportable: list[dict[str, Any]],
    dub_rows: list[dict[str, Any] | None],
    materials_dir: Path,
    canvas_width: int,
    canvas_height: int,
    *,
    subtitle_font_size: float = 8.0,
    subtitle_align: Literal["left", "center", "right"] = "center",
    subtitle_auto_wrapping: bool = True,
    subtitle_transform_y: float = -0.8,
    subtitle_position_mode: Literal["manual", "jianying_spec"] = "manual",
) -> int:
    """
    按 reference/migration-packages 与实机样本对齐的最小结构直接写
    `draft_info.json` / `draft_content.json` / `draft_meta_info.json` / `draft_virtual_store.json`。

    Args:
        draft_root: 草稿根目录（其下含 Resources/）
        draft_id: 草稿 UUID
        draft_name: 显示名称
        exportable: 已复制到 Resources 的导出行
        dub_rows: 与 exportable 对齐的配音行（可为 None）
        materials_dir: Resources 目录路径
        canvas_width/canvas_height: 像素画布（竖屏 9:16）

    Returns:
        草稿总时长（微秒）
    """
    entries: list[dict[str, Any]] = []
    audio_entries: list[dict[str, Any]] = []
    # 与主视频轨 target_timerange 对齐的原文字幕三元组 (start_us, duration_us, text)
    text_track_segments_spec: list[tuple[int, int, str]] = []
    t_us = 0
    for i, row in enumerate(exportable):
        path = materials_dir / row["resourceName"]
        width, height, observed_duration_us, _ = probe_video_material_fields(path.resolve())
        target_duration_us = _seconds_to_us(float(row["durationSec"]))
        observed_duration_us = max(observed_duration_us, target_duration_us)

        sub_line = subtitle_text_from_shot(row["shot"])
        if sub_line:
            text_track_segments_spec.append((t_us, target_duration_us, sub_line))

        material_id = str(uuid.uuid4())
        speed_id = str(uuid.uuid4())
        segment_id = str(uuid.uuid4())
        final_file_path = str(path.resolve())

        should_mute_original = bool(
            i < len(dub_rows)
            and dub_rows[i] is not None
            and getattr(row.get("shot"), "dub", None)
            and getattr(row["shot"].dub, "status", None) == "completed"
            and getattr(row["shot"].dub, "mode", None) not in ("original", "off", None)
        )

        entries.append(
            {
                "metaInfo": {
                    "id": str(uuid.uuid4()),
                    "create_time": int(datetime.now(tz=timezone.utc).timestamp()),
                    "duration": observed_duration_us,
                    "extra_info": row["shotId"],
                    "file_Path": final_file_path,
                    "height": height,
                    "import_time": int(datetime.now(tz=timezone.utc).timestamp()),
                    "import_time_ms": int(datetime.now(tz=timezone.utc).timestamp() * 1000),
                    "metetype": "video",
                    "type": 0,
                    "width": width,
                    "remote_url": final_file_path,
                },
                "material": {
                    "id": material_id,
                    "local_material_id": material_id,
                    "material_id": material_id,
                    "remote_url": final_file_path,
                    "path": final_file_path,
                    "duration": observed_duration_us,
                    "width": width,
                    "height": height,
                    "crop": _default_crop(),
                    "crop_ratio": "free",
                    "crop_scale": 1,
                    "check_flag": 63487,
                    "material_name": row["shotId"],
                    "category_name": "local",
                    "category_id": "",
                    "type": "video",
                },
                "speed": {
                    "id": speed_id,
                    "curve_speed": None,
                    "mode": 0,
                    "speed": 1,
                    "type": "speed",
                },
                "segment": {
                    "id": segment_id,
                    "material_id": material_id,
                    "target_timerange": {
                        "start": t_us,
                        "duration": target_duration_us,
                    },
                    "source_timerange": {
                        "start": 0,
                        "duration": max(observed_duration_us, target_duration_us),
                    },
                    "speed": 1,
                    "reverse": False,
                    "visible": True,
                    "volume": 0 if should_mute_original else 1,
                    "extra_material_refs": [speed_id],
                },
            }
        )

        if i < len(dub_rows) and dub_rows[i]:
            d = dub_rows[i]
            assert d is not None
            apath = materials_dir / d["resourceName"]
            final_audio_path = str(apath.resolve())
            audio_duration_us = _seconds_to_us(float(d["durationSec"]))
            audio_material_id = str(uuid.uuid4())
            audio_entries.append(
                {
                    "material": {
                        "id": audio_material_id,
                        "local_material_id": audio_material_id,
                        "material_id": audio_material_id,
                        "music_id": audio_material_id,
                        "path": final_audio_path,
                        "remote_url": final_audio_path,
                        "duration": audio_duration_us,
                        "type": "extract_music",
                        "name": f"dub_{row['shotId']}",
                        "material_name": f"dub_{row['shotId']}",
                        "category_name": "local",
                        "category_id": "",
                        "check_flag": 3,
                        "copyright_limit_type": "none",
                        "effect_id": "",
                        "formula_id": "",
                        "source_platform": 0,
                        "wave_points": [],
                    },
                    "segment": {
                        "id": str(uuid.uuid4()),
                        "enable_adjust": True,
                        "enable_color_correct_adjust": False,
                        "enable_color_curves": True,
                        "enable_color_match_adjust": False,
                        "enable_color_wheels": True,
                        "enable_lut": True,
                        "enable_smart_color_adjust": False,
                        "last_nonzero_volume": 1,
                        "reverse": False,
                        "render_index": 0,
                        "track_attribute": 0,
                        "track_render_index": 0,
                        "visible": True,
                        "material_id": audio_material_id,
                        "target_timerange": {
                            "start": t_us,
                            "duration": min(target_duration_us, max(audio_duration_us, 0)),
                        },
                        "source_timerange": {
                            "start": 0,
                            "duration": max(audio_duration_us, target_duration_us, 0),
                        },
                        "common_keyframes": [],
                        "keyframe_refs": [],
                        "speed": 1,
                        "volume": 1,
                        "extra_material_refs": [],
                        "is_tone_modify": False,
                        "clip": None,
                        "hdr_settings": None,
                    },
                }
            )

        t_us += target_duration_us

    total_duration_us = t_us
    draft_info = _create_base_draft_info(draft_id, canvas_width, canvas_height, total_duration_us)
    video_track = _build_reference_track("video")
    video_track["segments"] = [entry["segment"] for entry in entries]
    draft_info["materials"]["videos"] = [entry["material"] for entry in entries]
    draft_info["materials"]["speeds"] = [entry["speed"] for entry in entries]

    text_materials, text_segment_jsons, text_speed_jsons = build_text_track_payload(
        canvas_width,
        canvas_height,
        text_track_segments_spec,
        font_size=subtitle_font_size,
        align=subtitle_align,
        auto_wrapping=subtitle_auto_wrapping,
        transform_y=subtitle_transform_y,
        position_mode=subtitle_position_mode,
    )
    draft_info["materials"]["texts"] = text_materials
    draft_info["materials"]["speeds"].extend(text_speed_jsons)

    # 轨道顺序：视频 → 文本（叠在上层）→ 音频，与常见时间线堆叠习惯一致
    draft_info["tracks"] = [video_track]
    if text_segment_jsons:
        text_track = _build_reference_track("text")
        text_track["segments"] = text_segment_jsons
        draft_info["tracks"].append(text_track)

    if audio_entries:
        audio_track = _build_reference_track("audio")
        audio_track["segments"] = [entry["segment"] for entry in audio_entries]
        draft_info["tracks"].append(audio_track)
        draft_info["materials"]["audios"] = [entry["material"] for entry in audio_entries]

    draft_meta_info = _create_base_draft_meta_info(draft_name)
    draft_meta_info["draft_materials"][0]["value"] = [entry["metaInfo"] for entry in entries]
    draft_virtual_store = _create_base_draft_virtual_store()
    draft_virtual_store["draft_virtual_store"][1]["value"] = [
        {"child_id": entry["metaInfo"]["id"], "parent_id": ""}
        for entry in entries
    ]

    (draft_root / "draft_info.json").write_text(
        json.dumps(draft_info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (draft_root / "draft_content.json").write_text(
        json.dumps(draft_info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (draft_root / "draft_meta_info.json").write_text(
        json.dumps(draft_meta_info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (draft_root / "draft_virtual_store.json").write_text(
        json.dumps(draft_virtual_store, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return total_duration_us


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


def _json_dumps_compact(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _create_virtual_store_from_material_ids(material_ids: list[str]) -> dict[str, Any]:
    now_us = int(datetime.now(tz=timezone.utc).timestamp() * 1_000_000)
    return {
        "draft_materials": [],
        "draft_virtual_store": [
            {
                "type": 0,
                "value": [
                    {
                        "creation_time": 0,
                        "display_name": "",
                        "filter_type": 0,
                        "id": "",
                        "import_time": 0,
                        "import_time_us": 0,
                        "sort_sub_type": 0,
                        "sort_type": 0,
                        "subdraft_filter_type": 0,
                    }
                ],
            },
            {
                "type": 1,
                "value": [
                    {
                        "child_id": mid,
                        "parent_id": "",
                    }
                    for mid in material_ids
                ],
            },
            {
                "type": 2,
                "value": [],
            },
        ],
        "_generated_at_us": now_us,
    }


def _ensure_reference_style_draft_files(draft_root: Path, draft_name: str) -> None:
    """
    基于现有 draft_content.json 补齐 reference 包风格的额外草稿文件。

    - draft_info.json: 与 draft_content.json 同步
    - draft_virtual_store.json: 最小素材映射
    - draft_meta_info.json: 保留 pyJianYingDraft 生成结果，仅确保 draft_name 已写入
    """
    content_path = draft_root / "draft_content.json"
    if not content_path.is_file():
        raise FileNotFoundError(str(content_path))

    draft_info = json.loads(content_path.read_text(encoding="utf-8"))
    mats = draft_info.get("materials") if isinstance(draft_info, dict) else {}
    material_ids: list[str] = []
    if isinstance(mats, dict):
        for key in ("videos", "audios", "texts"):
            rows = mats.get(key)
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                mid = row.get("id") or row.get("material_id")
                if isinstance(mid, str) and mid.strip():
                    material_ids.append(mid)

    (draft_root / "draft_info.json").write_text(
        json.dumps(draft_info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (draft_root / "draft_virtual_store.json").write_text(
        _json_dumps_compact(_create_virtual_store_from_material_ids(material_ids)),
        encoding="utf-8",
    )

    meta_path = draft_root / "draft_meta_info.json"
    if meta_path.is_file():
        try:
            meta_obj = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            meta_obj = {}
    else:
        meta_obj = {}
    if isinstance(meta_obj, dict):
        meta_obj["draft_name"] = draft_name
        meta_obj.setdefault(
            "draft_materials",
            [{"type": 0, "value": []}, {"type": 1, "value": []}, {"type": 2, "value": []}],
        )
        meta_path.write_text(
            json.dumps(meta_obj, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _write_json_compact(path: Path, obj: Any) -> None:
    _write_text(path, _json_dumps_compact(obj))


def _ensure_modern_jianying_shell(draft_root: Path) -> None:
    """
    补齐当前剪映项目目录常见的壳文件与 Timelines 子目录。

    这里不尝试生成剪映保存后的加密 draft_info，只提供最小未加密壳结构，
    以贴近 reference 包与本机已存在项目的目录树。
    """
    draft_info_path = draft_root / "draft_info.json"
    if not draft_info_path.is_file():
        return
    draft_info_text = draft_info_path.read_text(encoding="utf-8")

    now = datetime.now(tz=timezone.utc)
    now_sec = int(now.timestamp())
    now_us = int(now.timestamp() * 1_000_000)

    timeline_project_path = draft_root / "Timelines" / "project.json"
    timeline_id = str(uuid.uuid4())
    if timeline_project_path.is_file():
        try:
            existing = json.loads(timeline_project_path.read_text(encoding="utf-8"))
            maybe_id = existing.get("main_timeline_id")
            if isinstance(maybe_id, str) and maybe_id.strip():
                timeline_id = maybe_id.strip()
        except json.JSONDecodeError:
            pass

    timeline_project = {
        "config": {
            "color_space": -1,
            "render_index_track_mode_on": False,
            "use_float_render": False,
        },
        "create_time": now_us,
        "id": timeline_id,
        "main_timeline_id": timeline_id,
        "timelines": [
            {
                "create_time": now_us,
                "id": timeline_id,
                "is_marked_delete": False,
                "name": "时间线01",
                "update_time": now_us,
            }
        ],
        "update_time": now_us,
        "version": 0,
    }
    layout = {
        "dockItems": [
            {
                "dockIndex": 0,
                "ratio": 1,
                "timelineIds": [timeline_id],
                "timelineNames": ["时间线01"],
            }
        ],
        "layoutOrientation": 1,
    }

    draft_settings = (
        "[General]\n"
        "cloud_last_modify_platform=mac\n"
        f"draft_create_time={now_sec}\n"
        f"draft_last_edit_time={now_sec}\n"
        "real_edit_keys=0\n"
        "real_edit_seconds=0\n"
    )

    _write_text(draft_root / "draft_settings", draft_settings)
    _write_json_compact(draft_root / "draft_agency_config.json", _DRAFT_AGENCY_CONFIG)
    _write_text(draft_root / "draft_biz_config.json", "")
    _write_json_compact(draft_root / "timeline_layout.json", layout)
    _write_json_compact(draft_root / "attachment_editing.json", _ATTACHMENT_EDITING)
    _write_json_compact(draft_root / "attachment_pc_common.json", _ATTACHMENT_PC_COMMON)
    _write_json_compact(
        draft_root / "common_attachment" / "attachment_action_scene.json",
        _ATTACHMENT_ACTION_SCENE,
    )
    _write_json_compact(
        draft_root / "common_attachment" / "attachment_pc_timeline.json",
        _ATTACHMENT_PC_TIMELINE,
    )
    _write_json_compact(
        draft_root / "common_attachment" / "attachment_script_video.json",
        _ATTACHMENT_SCRIPT_VIDEO,
    )
    _write_json_compact(draft_root / "Timelines" / "project.json", timeline_project)

    timeline_root = draft_root / "Timelines" / timeline_id
    _write_text(timeline_root / "draft_info.json", draft_info_text)
    _write_json_compact(timeline_root / "attachment_editing.json", _ATTACHMENT_EDITING)
    _write_json_compact(timeline_root / "attachment_pc_common.json", _ATTACHMENT_PC_COMMON)
    _write_json_compact(
        timeline_root / "common_attachment" / "attachment_action_scene.json",
        _ATTACHMENT_ACTION_SCENE,
    )
    _write_json_compact(
        timeline_root / "common_attachment" / "attachment_pc_timeline.json",
        _ATTACHMENT_PC_TIMELINE,
    )
    _write_json_compact(
        timeline_root / "common_attachment" / "attachment_script_video.json",
        _ATTACHMENT_SCRIPT_VIDEO,
    )


def _rewrite_material_paths_for_copied_draft(copied_draft_root: Path) -> None:
    """
    将复制后的草稿 JSON 中素材绝对路径改写为 copied_draft_root/materials 下的最终路径。

    现有导出流程先在仓库 data/.../export/jianying/{draftId} 下生成草稿，再 copytree 到
    剪映草稿根目录。若不改写，draft_content.json 中 materials.*.path 会继续指向仓库内
    的临时导出目录，而非用户实际打开的草稿目录。
    """
    candidates = [
        copied_draft_root / "draft_content.json",
        copied_draft_root / "draft_info.json",
    ]
    timelines_dir = copied_draft_root / "Timelines"
    if timelines_dir.is_dir():
        candidates.extend(timelines_dir.glob("*/draft_info.json"))

    materials_dir = copied_draft_root / "materials"
    resources_dir = copied_draft_root / "Resources"

    for content_path in candidates:
        if not content_path.is_file():
            continue
        try:
            obj = json.loads(content_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        mats = obj.get("materials")
        if not isinstance(mats, dict):
            continue

        changed = False
        for key in ("videos", "audios"):
            rows = mats.get(key)
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                raw_path = row.get("path")
                if not isinstance(raw_path, str) or not raw_path.strip():
                    continue
                file_name = Path(raw_path).name
                base_dir = resources_dir if (resources_dir / file_name).exists() else materials_dir
                new_path = str((base_dir / file_name).resolve())
                if row.get("path") != new_path:
                    row["path"] = new_path
                    if isinstance(row.get("remote_url"), str):
                        row["remote_url"] = new_path
                    changed = True

        if changed:
            content_path.write_text(
                json.dumps(obj, ensure_ascii=False, indent=4),
                encoding="utf-8",
            )

    meta_path = copied_draft_root / "draft_meta_info.json"
    if meta_path.is_file():
        try:
            meta_obj = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            meta_obj = None
        if isinstance(meta_obj, dict):
            rows = (((meta_obj.get("draft_materials") or [{}])[0]).get("value") or [])
            changed = False
            for row in rows:
                if not isinstance(row, dict):
                    continue
                raw_path = row.get("file_Path")
                if not isinstance(raw_path, str) or not raw_path.strip():
                    continue
                file_name = Path(raw_path).name
                base_dir = resources_dir if (resources_dir / file_name).exists() else materials_dir
                new_path = str((base_dir / file_name).resolve())
                if row.get("file_Path") != new_path:
                    row["file_Path"] = new_path
                    if isinstance(row.get("remote_url"), str):
                        row["remote_url"] = new_path
                    changed = True
            if changed:
                meta_path.write_text(
                    json.dumps(meta_obj, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )


def _safe_jianying_folder_name(name: str, fallback: str) -> str:
    """将草稿标题收敛为适合本地目录的名称。"""
    s = (name or "").strip()
    s = s.replace("/", "_").replace(":", "_")
    s = " ".join(s.split())
    return s or fallback


def _resolve_project_title(project_id: str, feeling_client: Any = None) -> str | None:
    """
    尝试从平台读取项目显示名；失败时返回 None。

    命名属于体验层，不能因为平台接口瞬时失败而阻断导出。
    feeling_client: 多上下文请求传入的 FeelingClient；否则无参构造读 .env。
    """
    pid = (project_id or "").strip()
    if not pid:
        return None
    try:
        from src.feeling.client import FeelingClient

        client = feeling_client or FeelingClient()
        raw = client.get_project(pid) or {}
        for key in ("title", "name", "projectTitle", "projectName"):
            v = raw.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    except Exception:
        return None
    return None


def _pick_jianying_copy_dest(target_root: Path, draft_name: str, draft_id: str) -> Path:
    """
    为复制到剪映草稿根目录挑选最终目录名。

    优先使用草稿标题，若重名则追加 Finder/剪映常见的 `` (1)`` / `` (2)`` 后缀，
    尽量避免剪映在首次打开后再把 UUID 目录重命名，导致 draft_content.json 中
    已写死的绝对素材路径失效。
    """
    base = _safe_jianying_folder_name(draft_name, draft_id)
    cand = target_root / base
    if not cand.exists():
        return cand
    n = 1
    while True:
        cand = target_root / f"{base} ({n})"
        if not cand.exists():
            return cand
        n += 1


def _build_jianying_copy_name(
    episode: Episode,
    episode_id: str,
    *,
    feeling_client: Any = None,
) -> str:
    """
    构造复制到剪映目录时使用的草稿文件夹名。

    规范：项目名-剧集名-版本。
    当前本地 episode.json 未持久化项目显示名，因此优先尝试从平台读取项目 title/name；
    若失败再退回 projectId。
    """
    project_id = (getattr(episode, "projectId", None) or "").strip()
    project_part = _resolve_project_title(project_id, feeling_client) or project_id
    episode_part = (getattr(episode, "episodeTitle", None) or "").strip() or episode_id
    combined = f"{project_part}-{episode_part}" if project_part else episode_part
    return _safe_jianying_folder_name(combined, episode_id)


def export_jianying_draft(
    req: JianyingExportRequest,
    *,
    include_dub_audio: bool = True,
    namespace_root: Path | None = None,
    feeling_client: Any = None,
) -> dict[str, Any]:
    """
    执行剪映草稿导出，写入磁盘并更新 episode.jianyingExport。

    全程在 episode_fs_lock 内：与同集 repull 互斥，避免 ep_dir 迁移后仍向旧路径写 export/。

    Args:
        req: 请求体（含 episodeId）
        include_dub_audio: 是否铺配音轨（依赖 shot.dub 已存在且与选中候选一致）
        namespace_root: 多上下文时的数据子根；None 为旧版扁平布局
        feeling_client: 解析项目标题用的 Feeling 客户端

    Returns:
        适合 JianyingExportResponse 序列化的 dict
    """
    from services.context_service import fs_lock_tag_from_namespace_root

    episode_id = req.episodeId
    lock_tag = fs_lock_tag_from_namespace_root(namespace_root)
    with episode_fs_lock(episode_id, data_namespace=lock_tag):
        ep = data_service.get_episode(episode_id, namespace_root)
        if not ep:
            raise ValueError("Episode not found")
        ep_dir = data_service.get_episode_dir(episode_id, namespace_root)
        if not ep_dir:
            raise ValueError("Episode dir not found")

        exportable, missing = collect_exportable_shots(ep, ep_dir, req.shotIds)
        if not exportable:
            raise ValueError("没有可导出的已选视频，请确认分镜已选定视频且文件存在")

        draft_id = str(uuid.uuid4())
        draft_name = ep.episodeTitle or episode_id
        copy_name = _build_jianying_copy_name(ep, episode_id, feeling_client=feeling_client)
        w, h = canvas_wh_vertical_9_16(req.canvasSize)  # 竖屏 9:16，与 pyJianYingDraft 一致

        draft_root = ep_dir / "export" / "jianying" / draft_id
        draft_root.mkdir(parents=True, exist_ok=True)
        resources_dir = draft_root / "Resources"
        resources_dir.mkdir(parents=True, exist_ok=True)

        dub_rows = _detect_dub_audio_rows(ep_dir, exportable) if include_dub_audio else [None] * len(exportable)

        for i, row in enumerate(exportable):
            safe = _protocol_file_name(row["shotId"], row["videoAbs"])
            dst = resources_dir / safe
            shutil.copy2(row["videoAbs"], dst)
            rel = f"Resources/{safe}"
            row["materialRel"] = rel
            row["resourceName"] = safe

            if i < len(dub_rows) and dub_rows[i]:
                d = dub_rows[i]
                abs_a = d["_abs"]
                asafe = _protocol_file_name(f"dub_{row['shotId']}", abs_a)
                adst = resources_dir / asafe
                shutil.copy2(abs_a, adst)
                d["resourceName"] = asafe

        _write_jianying_draft_pyjdraft(
            draft_root,
            draft_id,
            draft_name,
            exportable,
            dub_rows,
            resources_dir,
            w,
            h,
            subtitle_font_size=float(req.subtitleFontSize),
            subtitle_align=req.subtitleAlign,
            subtitle_auto_wrapping=req.subtitleAutoWrapping,
            subtitle_transform_y=float(req.subtitleTransformY),
            subtitle_position_mode=req.subtitlePositionMode,
        )

        # 不再生成 ZIP；episode 记录仍保留 zipPath 字段以兼容旧 JSON，恒为 None
        zip_rel: str | None = None

        target_root = Path(req.draftPath).expanduser().resolve()
        target_root.mkdir(parents=True, exist_ok=True)
        dest = _pick_jianying_copy_dest(target_root, copy_name, draft_id)
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(draft_root, dest)
        _rewrite_material_paths_for_copied_draft(dest)
        jianying_copy_abs = str(dest.resolve())

        exported_at = datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z")
        ep.jianyingExport = JianyingExportRecord(
            lastExportedAt=exported_at,
            draftId=draft_id,
            zipPath=zip_rel,
            draftDirRelative=str(draft_root.relative_to(ep_dir)),
        )
        data_service.persist_episode(ep, namespace_root)

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
