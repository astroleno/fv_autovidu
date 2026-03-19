#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
单帧带资产重生脚本

基于首帧参考图 + 资产图 + 修改后的 imagePrompt，调用 yunwu Gemini 重新生成首帧。
生成后替换 frames/S{nn}.png，并清除该 Shot 的 endFrame 和 videoCandidates。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

from src.yunwu.client import call_yunwu, read_image_as_base64, YUNWU_BASE


def main() -> None:
    parser = argparse.ArgumentParser(description="单帧带资产重生：修改 prompt + 选资产 → 新首帧")
    parser.add_argument("--from-json", type=Path, required=True, help="episode.json 路径")
    parser.add_argument("--shot-id", required=True, help="Shot UUID")
    parser.add_argument("--image-prompt", required=True, help="修改后的 imagePrompt")
    parser.add_argument("--asset-ids", default="", help="资产 ID 列表，逗号分隔")
    parser.add_argument("--model", default="gemini-3.1-flash-image-preview")
    parser.add_argument("--image-size", default="2K", choices=["1K", "2K", "4K"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    json_path = args.from_json if args.from_json.is_absolute() else Path.cwd() / args.from_json
    if not json_path.exists():
        raise SystemExit(f"episode.json 不存在: {json_path}")
    data = json.loads(json_path.read_text(encoding="utf-8"))
    episode_dir = json_path.parent

    shot = None
    for scene in data.get("scenes", []):
        for s in scene.get("shots", []):
            if s.get("shotId") == args.shot_id:
                shot = s
                break
        if shot:
            break
    if not shot:
        raise SystemExit(f"未找到 shot_id={args.shot_id}")

    first_rel = shot.get("firstFrame", "")
    first_path = episode_dir / first_rel
    if not first_path.exists():
        raise SystemExit(f"首帧不存在: {first_rel}")

    asset_ids = [x.strip() for x in args.asset_ids.split(",") if x.strip()]
    asset_paths = []
    for a in shot.get("assets", []):
        if a.get("assetId") in asset_ids:
            lp = a.get("localPath", "")
            if lp:
                p = episode_dir / lp
                if p.exists():
                    asset_paths.append(p)
    asset_paths = asset_paths[:2]

    template = """请基于提供的首帧参考图，按照新的描述重新生成该镜头的首帧画面。

要求：
- 严格遵循下面的「新画面描述」
- 保持与参考图一致的角色身份、服装、道具、场景风格
- 若提供了资产图，将其特征融入画面
- 不要生成字幕或额外文字

新画面描述：
{image_prompt}

参考首帧已作为图一提供。
"""
    text = template.format(image_prompt=args.image_prompt)
    if asset_paths:
        names = [p.stem for p in asset_paths]
        text += f"\n\n图一为首帧参考，图二为{names[0]}资产。" if len(names) == 1 else f"\n\n图一为首帧参考，图二为{names[0]}资产，图三为{names[1]}资产。"
    else:
        text += "\n\n图一为首帧参考。"

    api_key = __import__("os").environ.get("YUNWU_API_KEY")
    if not api_key:
        raise SystemExit("请在 .env 中配置 YUNWU_API_KEY")
    first_b64 = read_image_as_base64(first_path)
    asset_b64_list = [read_image_as_base64(p) for p in asset_paths]
    endpoint = f"{YUNWU_BASE}/{args.model}:generateContent"

    if args.dry_run:
        print(f"[DryRun] 重生 Shot {args.shot_id}，asset_ids={asset_ids}")
        return

    print(f"[Run] 重生 Shot {args.shot_id} ...")
    img_data = call_yunwu(
        api_key, text, first_b64, asset_b64_list,
        endpoint=endpoint, aspect_ratio="9:16", image_size=args.image_size,
    )
    first_path.write_bytes(img_data)
    shot["imagePrompt"] = args.image_prompt
    shot["endFrame"] = None
    shot["videoCandidates"] = []
    shot["status"] = "pending"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  -> {first_path} 已更新，episode.json 已写入")


if __name__ == "__main__":
    main()
