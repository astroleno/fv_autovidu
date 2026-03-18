#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
任务轮询：轮询 Vidu 任务状态直到 success/failed
"""

import json
import os
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

from src.vidu.client import ViduClient


def poll_until_done(
    client: ViduClient,
    task_ids: list[str],
    interval: int = 15,
    verbose: bool = True,
) -> dict[str, dict]:
    result = {tid: {"state": "pending", "url": None, "credits": None, "raw": None} for tid in task_ids}
    pending = set(task_ids)
    while pending:
        ids = list(pending)
        try:
            resp = client.query_tasks(ids)
        except Exception as e:
            if verbose:
                print(f"[查询失败] {e}")
            time.sleep(interval)
            continue
        tasks = resp.get("tasks", [])
        by_id = {t["id"]: t for t in tasks if "id" in t}
        for tid in ids:
            t = by_id.get(tid)
            if not t:
                continue
            state = t.get("state", "")
            result[tid]["state"] = state
            result[tid]["raw"] = t
            if state in ("success", "failed"):
                pending.discard(tid)
                result[tid]["credits"] = t.get("credits")
                if state == "success":
                    creations = t.get("creations", [])
                    result[tid]["url"] = creations[0].get("url") if creations else None
                if verbose:
                    status = f" url=..." if result[tid].get("url") else ""
                    print(f"  {tid}: {state}{status}")
        if verbose and pending:
            print(f"  待完成: {len(pending)}/{len(task_ids)}，{interval}s 后重试...")
        if pending:
            time.sleep(interval)
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(description="轮询 Vidu 任务状态")
    parser.add_argument("--records", default=None, help="i2v_*_records.json 路径")
    parser.add_argument("--task-ids", nargs="+", default=[], help="直接传入 task_id 列表")
    parser.add_argument("--interval", type=int, default=15, help="轮询间隔(秒)")
    args = parser.parse_args()

    api_key = os.environ.get("VIDU_API_KEY") or os.environ.get("API_KEY")
    if not api_key:
        print("请在 .env 中设置 VIDU_API_KEY")
        sys.exit(1)

    task_ids = list(args.task_ids)
    records_path = args.records
    label_by_id = {}
    records_data = []
    default_records = PROJECT_ROOT / "output/frames/第2集_EP02_分镜包/group_01/i2v_test_records.json"
    if records_path or (not task_ids and default_records.exists()):
        path = Path(records_path) if records_path else default_records
        if path.exists():
            records_data = json.loads(path.read_text(encoding="utf-8"))
            for r in records_data:
                vid = str(r.get("vidu_task_id", ""))
                if vid:
                    task_ids.append(vid)
                    label_by_id[vid] = r.get("task_id", vid)
        else:
            print(f"未找到 {path}")
            sys.exit(1)

    if not task_ids:
        print("请提供 --records 或 --task-ids")
        sys.exit(1)

    task_ids = list(dict.fromkeys(task_ids))
    print(f"轮询 {len(task_ids)} 个任务，间隔 {args.interval}s...")
    client = ViduClient(api_key=api_key)
    result = poll_until_done(client, task_ids, interval=args.interval)

    rec_by_vid = {str(r["vidu_task_id"]): r for r in records_data}
    out = []
    for tid, r in result.items():
        label = label_by_id.get(tid, tid)
        rec = rec_by_vid.get(tid, {})
        item = {
            "task_id": label,
            "vidu_task_id": tid,
            "state": r["state"],
            "url": r["url"],
            "credits": r.get("credits"),
            "seed": rec.get("seed"),
            "duration": rec.get("duration"),
            "timestamp": rec.get("timestamp"),
        }
        # 完整 query 返回值（含积分、model、prompt 等）
        if r.get("raw"):
            raw = dict(r["raw"])
            if "images" in raw and raw["images"]:
                raw["images"] = ["<base64_or_url>"]
            item["query_response"] = raw
        out.append(item)
    records_dir = Path(records_path).parent if records_path else default_records.parent
    out_path = records_dir / "poll_results.json"
    records_dir.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\n结果已保存: {out_path}")
    success = sum(1 for r in result.values() if r["state"] == "success")
    total_credits = sum(r.get("credits") or 0 for r in result.values())
    print(f"完成: {success}/{len(task_ids)} success | 消耗积分: {total_credits}")


if __name__ == "__main__":
    main()
