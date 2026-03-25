# -*- coding: utf-8 -*-
"""
剪映草稿导出服务

职责：
- 从 Episode 收集可导出视频候选（有 videoPath；优先 selected，否则第一条），按分镜叙事顺序排列
- 将素材复制到 `export/jianying/{draftId}/materials/`
- 使用 **pyJianYingDraft** 生成与剪映兼容的 **`draft_content.json`（时间轴）** 及官方模板的 **`draft_meta_info.json`**
  （仅写自研 `draft_info.json` 无法显示时间轴，见 reference 与社区逆向说明）
- 将草稿目录复制到本机剪映草稿根目录（同机部署）；不生成 ZIP

注意：剪映 6+ 可能对「由软件保存」的草稿加密；**由本工具生成的未加密 JSON** 在多数版本可导入。
若仍空白，请记录剪映版本并反馈。
"""

from __future__ import annotations

import json
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# 与 video_finalizer 一致：保证可 import src.feeling（uvicorn 仅挂 web/server 时）
_JY_ROOT = Path(__file__).resolve().parents[3]
if str(_JY_ROOT) not in sys.path:
    sys.path.insert(0, str(_JY_ROOT))

from src.feeling.episode_fs_lock import episode_fs_lock

from models.schemas import Episode, JianyingExportRecord, JianyingExportRequest, Shot

from services import data_service
from services.audio_service import probe_duration_sec
from services.candidate_pick import pick_playable_video_candidate
from services.jianying_protocol import canvas_wh_vertical_9_16


def _ensure_mediainfo_for_jianying() -> None:
    """
    剪映草稿生成链路预检：pyJianYingDraft 在构造 ``VideoSegment(path)`` / ``AudioSegment(path)`` 时会
    内部调用 ``VideoMaterial(path)`` / ``AudioMaterial(path)``，二者均依赖 **pymediainfo** 解析媒体信息。

    若本机 **未安装或未加载 libmediainfo 动态库**，则 ``pymediainfo.MediaInfo.can_parse()`` 为 False，
    pyJianYingDraft 会抛出**误导性**异常，例如：
    - ``ValueError: 不支持的视频素材类型 '.mp4'``（与扩展名无关，实为 MediaInfo 不可用）
    - ``ValueError: 不支持的音频素材类型 .mp3``（配音轨同理）

    在此提前检测并以明确文案失败，避免用户误以为是 MP4 格式问题。

    Raises:
        ValueError: 未安装 pymediainfo，或系统缺少 libmediainfo（需用户修复运行环境）
    """
    try:
        from pymediainfo import MediaInfo
    except ImportError as exc:
        raise ValueError(
            "剪映草稿依赖 pymediainfo，请在后端环境执行：pip install pymediainfo"
        ) from exc
    if not MediaInfo.can_parse():
        raise ValueError(
            "剪映草稿导出需要系统安装 MediaInfo 动态库（libmediainfo）。"
            "若曾出现「不支持的视频素材类型 '.mp4'」类提示，通常表示本机未正确加载该库，而非 MP4 格式不被支持。"
            "macOS：brew install mediainfo；Ubuntu/Debian：sudo apt install libmediainfo0v5；"
            "并确保运行 uvicorn 的进程能加载对应 .dylib/.so（必要时设置环境变量或查阅 pymediainfo 文档）。"
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


def _write_jianying_draft_pyjdraft(
    draft_root: Path,
    draft_id: str,
    draft_name: str,
    exportable: list[dict[str, Any]],
    dub_rows: list[dict[str, Any] | None],
    materials_dir: Path,
    canvas_width: int,
    canvas_height: int,
) -> int:
    """
    使用 pyJianYingDraft 写入 draft_content.json + draft_meta_info.json。

    剪映桌面版**时间轴**读取 ``draft_content.json``（社区与 pyJianYingDraft 文档一致）；
    仅自研 ``draft_info.json`` 不足以显示轨道，故必须依赖本库生成。

    Args:
        draft_root: 草稿根目录（其下含 materials/）
        draft_id: 草稿 UUID
        draft_name: 显示名称
        exportable: 已复制到 materials 的导出行
        dub_rows: 与 exportable 对齐的配音行（可为 None）
        materials_dir: materials 目录路径
        canvas_width/canvas_height: 像素画布（竖屏 9:16）

    Returns:
        草稿总时长（微秒），与 ScriptFile.duration 一致

    Raises:
        ImportError: 未安装 pyJianYingDraft
    """
    try:
        from pyJianYingDraft import (
            AudioSegment,
            ScriptFile,
            VideoSegment,
            assets,
            trange,
        )
        from pyJianYingDraft import SEC, TrackType
    except ImportError as exc:
        raise ImportError(
            "剪映时间轴依赖 pyJianYingDraft，请在后端环境执行：pip install pyJianYingDraft>=0.2.6"
        ) from exc

    script = ScriptFile(canvas_width, canvas_height, 30, True)
    script.add_track(TrackType.video)
    t_us = 0
    for i, row in enumerate(exportable):
        ext = row["videoAbs"].suffix or ".mp4"
        safe = f"{i + 1:03d}_{row['shotId']}{ext}"
        path = materials_dir / safe
        dur_us = max(1, int(float(row["durationSec"]) * SEC))
        seg = VideoSegment(str(path.resolve()), trange(t_us, dur_us))
        script.add_segment(seg)
        t_us += dur_us

    has_dub = any(
        i < len(dub_rows) and dub_rows[i] is not None for i in range(len(exportable))
    )
    if has_dub:
        script.add_track(TrackType.audio)
        t_us = 0
        for i, row in enumerate(exportable):
            dur_us = max(1, int(float(row["durationSec"]) * SEC))
            if i < len(dub_rows) and dub_rows[i]:
                d = dub_rows[i]
                assert d is not None
                abs_a = d["_abs"]
                aext = abs_a.suffix or ".mp3"
                asafe = f"{i + 1:03d}_{row['shotId']}_dub{aext}"
                apath = materials_dir / asafe
                seg = AudioSegment(str(apath.resolve()), trange(t_us, dur_us))
                script.add_segment(seg)
            t_us += dur_us

    script.dump(str(draft_root / "draft_content.json"))
    shutil.copy(
        assets.get_asset_path("DRAFT_META_TEMPLATE"),
        str(draft_root / "draft_meta_info.json"),
    )
    meta_path = draft_root / "draft_meta_info.json"
    meta_obj = json.loads(meta_path.read_text(encoding="utf-8"))
    meta_obj["draft_id"] = draft_id.upper()
    meta_obj["draft_name"] = draft_name
    meta_obj["tm_duration"] = script.duration
    meta_path.write_text(
        json.dumps(meta_obj, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return int(script.duration)


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

    全程在 episode_fs_lock 内：与同集 repull 互斥，避免 ep_dir 迁移后仍向旧路径写 export/。

    Args:
        req: 请求体（含 episodeId）
        include_dub_audio: 是否铺配音轨（依赖 shot.dub 已存在且与选中候选一致）

    Returns:
        适合 JianyingExportResponse 序列化的 dict
    """
    episode_id = req.episodeId
    with episode_fs_lock(episode_id):
        ep = data_service.get_episode(episode_id)
        if not ep:
            raise ValueError("Episode not found")
        ep_dir = data_service.get_episode_dir(episode_id)
        if not ep_dir:
            raise ValueError("Episode dir not found")

        exportable, missing = collect_exportable_shots(ep, ep_dir, req.shotIds)
        if not exportable:
            raise ValueError("没有可导出的已选视频，请确认分镜已选定视频且文件存在")

        # 在写盘 / 调用 pyJianYingDraft 之前：避免 libmediainfo 缺失时在复制大量素材后才报误导性「.mp4 不支持」
        _ensure_mediainfo_for_jianying()

        draft_id = str(uuid.uuid4())
        draft_name = ep.episodeTitle or episode_id
        w, h = canvas_wh_vertical_9_16(req.canvasSize)  # 竖屏 9:16，与 pyJianYingDraft 一致

        draft_root = ep_dir / "export" / "jianying" / draft_id
        draft_root.mkdir(parents=True, exist_ok=True)
        materials_dir = draft_root / "materials"
        materials_dir.mkdir(parents=True, exist_ok=True)

        dub_rows = _detect_dub_audio_rows(ep_dir, exportable) if include_dub_audio else [None] * len(exportable)

        for i, row in enumerate(exportable):
            ext = row["videoAbs"].suffix or ".mp4"
            safe = f"{i + 1:03d}_{row['shotId']}{ext}"
            dst = materials_dir / safe
            shutil.copy2(row["videoAbs"], dst)
            rel = f"materials/{safe}"
            row["materialRel"] = rel

            if i < len(dub_rows) and dub_rows[i]:
                d = dub_rows[i]
                abs_a = d["_abs"]
                aext = abs_a.suffix or ".mp3"
                asafe = f"{i + 1:03d}_{row['shotId']}_dub{aext}"
                adst = materials_dir / asafe
                shutil.copy2(abs_a, adst)

        _write_jianying_draft_pyjdraft(
            draft_root,
            draft_id,
            draft_name,
            exportable,
            dub_rows,
            materials_dir,
            w,
            h,
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
