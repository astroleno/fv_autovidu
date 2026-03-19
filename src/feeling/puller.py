# -*- coding: utf-8 -*-
"""
平台数据一键拉取脚本

从 Feeling 平台拉取分镜表（shots）、场景（scenes）、资产（assets），
下载所有首帧图和资产图到本地，组装 episode.json（格式与前端 Episode 类型一致）。
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.feeling.client import FeelingClient

# 加载 .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


def _get(obj: dict, *keys: str, default: Any = "") -> Any:
    """从 dict 中按多个可能的 key 取值，优先取第一个存在的。"""
    for k in keys:
        if k in obj and obj[k] is not None:
            return obj[k]
    return default


def _get_frame_url(sh: dict) -> str:
    """从 shot 中解析首帧图 URL。支持 firstframeMedia.url 或直接 URL 字段。"""
    media = _get(sh, "firstframeMedia", "firstFrameUrl", "firstFrame", "selectedFrameUrl", "imageUrl")
    if isinstance(media, dict) and media.get("url"):
        return str(media["url"])
    if isinstance(media, str):
        return media
    return ""


def _safe_name(name: str) -> str:
    """将资产名转为安全文件名，避免特殊字符。"""
    return re.sub(r'[<>:"/\\|?*]', "_", name).strip() or "asset"


def pull_episode(
    episode_id: str,
    output_dir: Path,
    *,
    project_id: str | None = None,
    episode_title: str | None = None,
    episode_number: int = 1,
    client: FeelingClient | None = None,
    force_redownload: bool = False,
) -> dict[str, Any]:
    """
    一键拉取 Episode 数据到本地。

    流程：
    1. 调用 get_scenes、get_shots、get_assets
    2. 下载所有首帧图 -> frames/S{nn}.png
    3. 下载所有资产图 -> assets/{name}.png
    4. 组装 episode.json 写入 output_dir

    Args:
        episode_id: Episode UUID
        output_dir: 输出目录，将创建 data/{projectId}/{episodeId}/ 结构
        project_id: 项目 ID，缺省时用 "proj-default"
        episode_title: 剧集标题，缺省时用 "第N集"
        episode_number: 剧集编号
        client: FeelingClient 实例，缺省时新建

    Returns:
        组装好的 Episode dict（与前端 Episode 类型一致）
    """
    client = client or FeelingClient()
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    proj_id = project_id or "proj-default"
    ep_dir = output_dir / proj_id / episode_id
    ep_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = ep_dir / "frames"
    assets_dir = ep_dir / "assets"
    frames_dir.mkdir(exist_ok=True)
    assets_dir.mkdir(exist_ok=True)

    # 1. 拉取 API 数据
    raw_scenes = client.get_scenes(episode_id)
    raw_shots = client.get_shots(episode_id)
    raw_assets = client.get_assets(proj_id, episode_id=episode_id)

    # 2. 构建资产 id/name -> 本地路径 映射，并下载资产图
    # 平台 referenceUrls 常为 metadata.referenceMapping 的风格参考（assetType=style），
    # 多角色共用同一张 style 图；thumbnail 才是正确的单体资产缩略图。
    # 统一优先使用 thumbnail，缺省时才回退 referenceUrls[0]。
    def _get_asset_image_url(a: dict) -> str:
        thumb = _get(a, "thumbnail", "imageUrl", "image_url", "url")
        if thumb:
            return str(thumb)
        urls = _get(a, "referenceUrls", "reference_urls")
        urls = urls if isinstance(urls, list) and urls else []
        if urls and urls[0]:
            return str(urls[0])
        return ""

    asset_by_id: dict[str, dict] = {}
    asset_by_name: dict[str, dict] = {}
    for a in raw_assets:
        aid = str(_get(a, "id", "assetId"))
        name = _get(a, "name", "title", default="未知")
        atype = _get(a, "type", default="other")
        if atype not in ("character", "location", "prop", "other"):
            atype = "other"
        prompt = _get(a, "prompt", "description", default="")
        img_url = _get_asset_image_url(a)
        local_name = f"{_safe_name(name)}.png"
        local_path = f"assets/{local_name}"
        full_path = assets_dir / local_name
        if img_url and (force_redownload or not full_path.exists()):
            try:
                client.download_file(img_url, full_path)
            except Exception as e:
                print(f"[Warn] 资产 {name} 下载失败: {e}")
        meta = {
            "assetId": aid,
            "name": name,
            "type": atype,
            "localPath": local_path,
            "prompt": prompt,
        }
        asset_by_id[aid] = meta
        asset_by_name[_safe_name(name)] = meta
        asset_by_name[name] = meta

    # 3. 构建 shotId -> shot 映射，以及 sceneId -> shotIds
    shot_by_id: dict[str, dict] = {}
    scene_id_to_shot_ids: dict[str, list[str]] = {}
    for s in raw_shots:
        shot_id_val = str(_get(s, "id", "shotId", default=f"shot-{len(raw_shots)}"))
        shot_by_id[shot_id_val] = s
        sid = str(_get(s, "sceneId", "scene_id", default="")).strip().lower()
        if sid:
            scene_id_to_shot_ids.setdefault(sid, []).append(shot_id_val)

    # 4. 处理 scenes；若平台未返回 scene，则构造一个包含所有 shot 的默认场景
    if not raw_scenes and raw_shots:
        raw_scenes = [{
            "id": "scene-default",
            "sceneId": "scene-default",
            "sceneNumber": 1,
            "title": "默认场景",
        }]

    scenes_out: list[dict] = []
    shot_counter = 0
    for sc in sorted(raw_scenes, key=lambda x: int(_get(x, "sceneNumber", "scene_number", default=0) or 0)):
        sid = str(_get(sc, "id", "sceneId", default="")).strip().lower()
        snum = int(_get(sc, "sceneNumber", "scene_number", default=1) or 1)
        title = _get(sc, "title", "name", default="未命名场景")
        # 优先从 scene 的 shotIds 取，否则从 shots 的 sceneId 匹配，否则用 scene 内嵌 shots
        shot_ids = _get(sc, "shotIds", "shot_ids")
        if not isinstance(shot_ids, (list, tuple)):
            shot_ids = [shot_ids] if shot_ids is not None else []
        if shot_ids:
            scene_shots_raw = [shot_by_id[str(sid)] for sid in shot_ids if str(sid) in shot_by_id]
        else:
            ids_in_scene = scene_id_to_shot_ids.get(sid, [])
            scene_shots_raw = [shot_by_id[s] for s in ids_in_scene if s in shot_by_id]
        if not scene_shots_raw:
            shots_from_scene = _get(sc, "shots") or []
            scene_shots_raw = [x for x in shots_from_scene if isinstance(x, dict)]
        if not scene_shots_raw and not scenes_out and raw_shots:
            # 兜底：首场景无匹配时，将全部 shot 归入（API sceneId 可能为不同格式）
            scene_shots_raw = list(raw_shots)

        shots_out: list[dict] = []
        for sh in sorted(scene_shots_raw, key=lambda x: int(_get(x, "shotNumber", "shot_number", default=0) or 0)):
            shot_counter += 1
            shot_id = str(_get(sh, "id", "shotId", default=f"shot-{shot_counter}"))
            shot_num = int(_get(sh, "shotNumber", "shot_number", default=shot_counter) or shot_counter)
            image_prompt = _get(sh, "imgPrompt", "imagePrompt", "image_prompt", "description", "prompt")
            video_prompt = _get(sh, "videoPrompt", "video_prompt", "videoPrompt", default=image_prompt)
            duration = int(_get(sh, "durationSec", "duration", default=5) or 5)
            camera = _get(sh, "cameraMovement", "camera_movement", "camera", default="push_in")
            aspect = _get(sh, "aspectRatio", "aspect_ratio", default="9:16")
            frame_url = _get_frame_url(sh)

            # 使用全局 shot_counter 命名，避免跨场景 shotNumber 重复导致共用同一图片
            frame_name = f"S{shot_counter:03d}.png"
            frame_rel = f"frames/{frame_name}"
            frame_path = frames_dir / frame_name
            if frame_url and not frame_path.exists():
                try:
                    client.download_file(frame_url, frame_path)
                except Exception as e:
                    print(f"[Warn] Shot {shot_counter} 首帧下载失败: {e}")

            # 资产关联：API 用 usedAssets[{name, type}] 或 assetIds
            shot_assets: list[dict] = []
            seen_aid: set[str] = set()
            used_assets = _get(sh, "usedAssets", "assetIds", "asset_ids", "assets", default=[])
            if isinstance(used_assets, list):
                for ua in used_assets:
                    if isinstance(ua, dict):
                        name = _get(ua, "name", "title", default="")
                        if name and name in asset_by_name:
                            meta = asset_by_name[name]
                            if meta["assetId"] not in seen_aid:
                                seen_aid.add(meta["assetId"])
                                shot_assets.append(meta)
                    elif isinstance(ua, str) and ua in asset_by_id:
                        if ua not in seen_aid:
                            seen_aid.add(ua)
                            shot_assets.append(asset_by_id[ua])
            elif isinstance(used_assets, str) and used_assets in asset_by_id:
                shot_assets.append(asset_by_id[used_assets])

            shots_out.append({
                "shotId": shot_id,
                "shotNumber": shot_num,
                "imagePrompt": image_prompt,
                "videoPrompt": video_prompt,
                "duration": duration,
                "cameraMovement": camera,
                "aspectRatio": aspect,
                "firstFrame": frame_rel,
                "assets": shot_assets,
                "status": "pending",
                "endFrame": None,
                "videoCandidates": [],
            })

        scenes_out.append({
            "sceneId": sid or f"scene-{snum}",
            "sceneNumber": snum,
            "title": title,
            "shots": shots_out,
        })

    # 4.5 兜底：若有 raw_shots 未被任何 scene 包含，归入「未归类」场景，确保不遗漏
    included_shot_ids: set[str] = set()
    for sc in scenes_out:
        for sh in sc["shots"]:
            included_shot_ids.add(sh["shotId"])
    orphan_shots: list[dict] = []
    for s in raw_shots:
        sid = str(_get(s, "id", "shotId", default=""))
        if sid and sid not in included_shot_ids:
            # 补处理该 shot：下载首帧、关联资产
            shot_counter += 1
            shot_id = sid
            shot_num = int(_get(s, "shotNumber", "shot_number", default=shot_counter) or shot_counter)
            image_prompt = _get(s, "imgPrompt", "imagePrompt", "image_prompt", "description", "prompt")
            video_prompt = _get(s, "videoPrompt", "video_prompt", "videoPrompt", default=image_prompt)
            duration = int(_get(s, "durationSec", "duration", default=5) or 5)
            camera = _get(s, "cameraMovement", "camera_movement", "camera", default="push_in")
            aspect = _get(s, "aspectRatio", "aspect_ratio", default="9:16")
            frame_url = _get_frame_url(s)
            frame_name = f"S{shot_counter:03d}.png"
            frame_rel = f"frames/{frame_name}"
            frame_path = frames_dir / frame_name
            if frame_url and not frame_path.exists():
                try:
                    client.download_file(frame_url, frame_path)
                except Exception as e:
                    print(f"[Warn] Shot {shot_counter} ( orphan ) 首帧下载失败: {e}")
            shot_assets = []
            seen_aid: set[str] = set()
            used_assets = _get(s, "usedAssets", "assetIds", "asset_ids", "assets", default=[])
            if isinstance(used_assets, list):
                for ua in used_assets:
                    if isinstance(ua, dict):
                        name = _get(ua, "name", "title", default="")
                        if name and name in asset_by_name:
                            meta = asset_by_name[name]
                            if meta["assetId"] not in seen_aid:
                                seen_aid.add(meta["assetId"])
                                shot_assets.append(meta)
                    elif isinstance(ua, str) and ua in asset_by_id:
                        if ua not in seen_aid:
                            seen_aid.add(ua)
                            shot_assets.append(asset_by_id[ua])
            elif isinstance(used_assets, str) and used_assets in asset_by_id:
                shot_assets.append(asset_by_id[used_assets])
            orphan_shots.append({
                "shotId": shot_id,
                "shotNumber": shot_num,
                "imagePrompt": image_prompt,
                "videoPrompt": video_prompt,
                "duration": duration,
                "cameraMovement": camera,
                "aspectRatio": aspect,
                "firstFrame": frame_rel,
                "assets": shot_assets,
                "status": "pending",
                "endFrame": None,
                "videoCandidates": [],
            })
    if orphan_shots:
        # 按 shotNumber 排序后归入新场景
        orphan_shots.sort(key=lambda x: x["shotNumber"])
        max_scene_num = max((s["sceneNumber"] for s in scenes_out), default=0) + 1
        scenes_out.append({
            "sceneId": "scene-orphan",
            "sceneNumber": max_scene_num,
            "title": "未归类镜头",
            "shots": orphan_shots,
        })
        print(f"[Info] 兜底归入 {len(orphan_shots)} 个未分配 shot 到「未归类镜头」场景")

    # 5. 组装 episode-level 全量资产库（供前端资产库页面 / RegenPage 使用）
    all_assets: list[dict] = []
    seen_asset_ids: set[str] = set()
    for meta in asset_by_id.values():
        if meta["assetId"] not in seen_asset_ids:
            seen_asset_ids.add(meta["assetId"])
            all_assets.append(meta)

    # 6. 组装 episode.json（含 episode 级 assets 供资产库展示）
    episode_title_val = episode_title or f"第{episode_number}集"
    episode: dict[str, Any] = {
        "projectId": proj_id,
        "episodeId": episode_id,
        "episodeTitle": episode_title_val,
        "episodeNumber": episode_number,
        "pulledAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scenes": scenes_out,
        "assets": all_assets,
    }

    # 7. 写入 episode.json
    json_path = ep_dir / "episode.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(episode, f, ensure_ascii=False, indent=2)
    print(f"[OK] 已拉取至 {json_path}")
    return episode


def pull_project(
    project_id: str,
    output_dir: Path,
    *,
    client: FeelingClient | None = None,
    force_redownload: bool = False,
) -> list[dict[str, Any]]:
    """
    一键拉取整个项目的所有剧集。

    先调用 get_project_episodes 获取剧集列表，再逐个拉取。
    """
    client = client or FeelingClient()
    output_dir = Path(output_dir)
    episodes = client.get_project_episodes(project_id)
    if not episodes:
        print(f"[Warn] 项目 {project_id} 下无剧集")
        return []
    results: list[dict[str, Any]] = []
    for i, ep in enumerate(episodes):
        ep_id = str(_get(ep, "id", "episodeId", default=""))
        if not ep_id:
            continue
        title = _get(ep, "title", "episodeTitle", "name", default=f"第{i + 1}集")
        num = int(_get(ep, "episodeNumber", "episode_number", "number", default=i + 1))
        print(f"\n[拉取] {title} (id={ep_id})")
        try:
            result = pull_episode(
                ep_id,
                output_dir,
                project_id=project_id,
                episode_title=title,
                episode_number=num,
                client=client,
                force_redownload=force_redownload,
            )
            results.append(result)
        except Exception as e:
            print(f"[失败] {title}: {e}")
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="从 Feeling 平台拉取 Episode 或整个项目")
    parser.add_argument("--episode-id", help="单个 Episode UUID（与 --project-id 二选一）")
    parser.add_argument("--project-id", help="项目 UUID，将拉取该项目下所有剧集")
    parser.add_argument("--output", "-o", type=Path, default=Path("data"), help="输出根目录")
    parser.add_argument("--title", default=None, help="剧集标题（仅 --episode-id 时有效）")
    parser.add_argument("--number", type=int, default=1, help="剧集编号（仅 --episode-id 时有效）")
    parser.add_argument("--force", action="store_true", help="强制重新下载资产图（修复拉错图时使用）")
    args = parser.parse_args()

    if args.project_id:
        pull_project(
            args.project_id,
            args.output,
            force_redownload=args.force,
        )
        return
    if args.episode_id:
        pull_episode(
            args.episode_id,
            args.output,
            project_id=args.project_id,
            episode_title=args.title,
            episode_number=args.number,
            force_redownload=args.force,
        )
        return
    parser.error("请指定 --episode-id 或 --project-id")
    raise SystemExit(1)


if __name__ == "__main__":
    main()
