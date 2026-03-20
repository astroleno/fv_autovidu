#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一次性测试：为本集「全局序号前 N 个」镜头生成尾帧（逻辑与 web/server/routes/generate._run_tail_frame 一致）。
使用与后端相同的 ENDFRAME_CONCURRENCY 思路：threading.Semaphore 限制并发。

镜头列表：按「场景 sceneNumber 升序 → 每场 shots 数组顺序」展平为叙事序列，取前 N 个。
禁止按 shotNumber 数值排序（多场均为 1-2-3 时会错误地变成 1,1,1,2,2,2…）。
全局序号 1…N 与 puller 写入顺序、frames/S001.png… 一致。

用法（项目根目录）:
  python scripts/test_tail_batch_5.py
  python scripts/test_tail_batch_5.py --count 5

依赖：项目根 .env 中 YUNWU_API_KEY；data 下存在对应 episode 与首帧图。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT / "web" / "server") not in sys.path:
    sys.path.insert(0, str(_ROOT / "web" / "server"))
os.environ.setdefault("DATA_ROOT", str(_ROOT / "data"))

try:
    from dotenv import load_dotenv

    load_dotenv(_ROOT / ".env")
except ImportError:
    pass

from services import data_service
from services.yunwu_service import generate_tail_frame

# 第2集（与 data/{projectId}/ 下目录一致）
EPISODE_ID = "c25126d1-73c7-418a-8ebe-e877df4f2e84"


def _shot_ids_first_n(episode_id: str, n: int) -> list[tuple[int, str, str]]:
    """
    返回 [(shotNumber, shotId, firstFrame), ...]：叙事顺序下的前 n 条。

    叙事顺序 = 场景按 sceneNumber 升序 → 每场内 shots 保持 JSON 数组顺序
   （例如三场镜头号为 1-2-3、1-2-3、1-2-3-4 时，全局为 1…10，取前 5 即第 1 场的 1-2-3 加第 2 场的 1-2）。

    **不要**按 shotNumber 做全局排序，否则会把不同场的「镜号 1」排在一起。
    """
    ep = data_service.get_episode(episode_id)
    if not ep:
        raise SystemExit(f"未找到 Episode: {episode_id}，请先 pull。")
    flat: list[tuple[int, str, str]] = []
    for sc in sorted(ep.scenes, key=lambda s: s.sceneNumber):
        for sh in sc.shots:
            flat.append((sh.shotNumber, sh.shotId, sh.firstFrame or ""))
    return flat[:n]

_SEM = threading.Semaphore(int(os.getenv("ENDFRAME_CONCURRENCY", "5")))


def run_one(shot_id: str) -> tuple[str, str, str | None]:
    """返回 (shot_id, 状态 ok|fail, 错误信息)。"""
    try:
        shot = data_service.get_shot(EPISODE_ID, shot_id)
        if not shot:
            return shot_id, "fail", "Shot not found"
        ep_dir = data_service.get_episode_dir(EPISODE_ID)
        if not ep_dir:
            return shot_id, "fail", "Episode dir not found"
        first_path = ep_dir / shot.firstFrame
        if not first_path.exists():
            return shot_id, "fail", f"首帧不存在: {shot.firstFrame}"
        assets_dir = ep_dir / "assets"
        asset_paths = [
            assets_dir / a.localPath.replace("assets/", "").lstrip("/")
            for a in shot.assets
        ]
        asset_paths = [p for p in asset_paths if p.exists()][:2]
        with _SEM:
            img_data = generate_tail_frame(
                first_path,
                shot.imagePrompt,
                shot.videoPrompt,
                asset_paths,
            )
        # 与后端 generate._run_tail_frame 一致：用首帧 stem 命名，避免 shotNumber 重复覆盖
        stem = Path(shot.firstFrame).stem
        end_name = f"{stem}_end.png" if stem else f"S{shot.shotNumber:03d}_end.png"
        end_path = ep_dir / "endframes" / end_name
        end_path.parent.mkdir(parents=True, exist_ok=True)
        end_path.write_bytes(img_data)
        data_service.update_shot(EPISODE_ID, shot_id, {
            "endFrame": f"endframes/{end_name}",
            "status": "endframe_done",
        })
        return shot_id, "ok", None
    except Exception as e:
        try:
            data_service.update_shot_status(EPISODE_ID, shot_id, "error")
        except Exception:
            pass
        return shot_id, "fail", str(e)


def main() -> None:
    parser = argparse.ArgumentParser(description="为本集全局序号前 N 个镜头批量生成尾帧")
    parser.add_argument(
        "--count",
        "-n",
        type=int,
        default=5,
        help="生成前 N 个镜头（按 shotNumber 排序），默认 5",
    )
    args = parser.parse_args()
    n = max(1, args.count)

    picked = _shot_ids_first_n(EPISODE_ID, n)
    shot_ids = [p[1] for p in picked]

    print(f"Episode: {EPISODE_ID}")
    print(f"并发上限: {int(os.getenv('ENDFRAME_CONCURRENCY', '5'))} (ENDFRAME_CONCURRENCY)")
    print(f"待生成镜头（全局序号前 {len(picked)} 个）:")
    for num, sid, ff in picked:
        print(f"  #{num}  {ff}  shotId={sid}")

    results: list[tuple[str, str, str | None]] = []
    with ThreadPoolExecutor(max_workers=5) as ex:
        futs = {ex.submit(run_one, sid): sid for sid in shot_ids}
        for fut in as_completed(futs):
            results.append(fut.result())
    order = {sid: i for i, sid in enumerate(shot_ids)}
    for sid, st, err in sorted(results, key=lambda x: order.get(x[0], 0)):
        if st == "ok":
            print(f"  [OK]   {sid}")
        else:
            print(f"  [FAIL] {sid}  {err}")
    ok = sum(1 for _, s, _ in results if s == "ok")
    print(f"完成: {ok}/{len(shot_ids)} 成功")

    # 更新 episode.json 的 pulledAt，前端 ShotCard 用其作 ?v= 缓存破坏，新尾帧才能立刻显示
    if ok > 0:
        ep_dir = data_service.get_episode_dir(EPISODE_ID)
        if ep_dir:
            ep_json = ep_dir / "episode.json"
            try:
                raw = json.loads(ep_json.read_text(encoding="utf-8"))
                raw["pulledAt"] = datetime.now(timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%S.%fZ"
                )
                ep_json.write_text(
                    json.dumps(raw, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                print("已更新 episode.json pulledAt，前端刷新页面即可看到新尾帧。")
            except Exception as e:
                print(f"[Warn] 更新 pulledAt 失败: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
