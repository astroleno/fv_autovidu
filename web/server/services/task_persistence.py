# -*- coding: utf-8 -*-
"""
本地任务状态轻量持久化

仅将 **已具备 Vidu 弱恢复元数据** 的 `video-*` 任务写入 DATA_ROOT/tasks_state.json：

- `generate_video` 先 `set_local_task(processing)` 再异步 `_run_video_gen` 才写入
  `vidu_task_id` / `episode_id` / `shot_id` / `candidate_id`。若在补全之前 debounce 刷盘，
  不得落盘，否则重启后会留下无法 `query_tasks` 的假 processing。

endframe-* / regen-* 不持久化。

弱恢复：启动时对已落盘的 video 任务补查 Vidu。

写入策略：debounce 约 5 秒；落盘前过滤。
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

import config

# 与 config.DATA_ROOT 一致：项目根下 data/
_STATE_PATH: Path = config.DATA_ROOT / "tasks_state.json"
_DEBOUNCE_SEC = 5.0
_timer_lock = threading.Lock()
_flush_timer: threading.Timer | None = None
_dirty = False


def get_state_path() -> Path:
    """持久化文件路径（便于测试替换）。"""
    return _STATE_PATH


def has_vidu_recovery_metadata(row: dict[str, Any]) -> bool:
    """
    是否具备弱恢复所需字段（与 routes.tasks.maybe_finalize_video_task 一致）。

    必须已拿到 Vidu 侧 task id，且与本地 episode/shot/candidate 绑定。
    仅有裸 processing、尚无 result.vidu_task_id 的条目不得落盘。
    """
    if not isinstance(row, dict):
        return False
    res = row.get("result")
    if not isinstance(res, dict):
        return False
    vid = res.get("vidu_task_id")
    if not vid or not str(vid).strip():
        return False
    for key in ("episode_id", "shot_id", "candidate_id"):
        v = row.get(key)
        if v is None or (isinstance(v, str) and not v.strip()):
            return False
    return True


def is_persistable_video_task(task_id: str, row: dict[str, Any] | None = None) -> bool:
    """
    是否允许写入 tasks_state.json。

    条件：task_id 为 video-*、`kind` 非冲突，且已具备 Vidu 恢复元数据。
    """
    tid = str(task_id)
    if not tid.startswith("video-"):
        return False
    if not isinstance(row, dict):
        return False
    k = row.get("kind")
    if k is not None and k != "video":
        return False
    return has_vidu_recovery_metadata(row)


def filter_persistable_tasks(tasks: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """从内存任务表中筛出唯一允许写入磁盘的条目。"""
    out: dict[str, dict[str, Any]] = {}
    for tid, row in tasks.items():
        if not isinstance(row, dict):
            continue
        if is_persistable_video_task(str(tid), row):
            out[str(tid)] = row
    return out


def load_raw_tasks_from_disk() -> dict[str, dict[str, Any]]:
    """
    读取 tasks 原始字典（不做可恢复过滤）。

    用于启动时扫描「历史误落盘」的不完整 video 行并标为 failed。
    """
    path = _STATE_PATH
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        tasks = raw.get("tasks")
        if isinstance(tasks, dict):
            return {str(k): dict(v) for k, v in tasks.items() if isinstance(v, dict)}
    except Exception:
        pass
    return {}


def load_tasks_from_disk() -> dict[str, dict[str, Any]]:
    """
    从 tasks_state.json 读取任务快照；文件不存在或损坏则返回空 dict。

    仅返回可弱恢复任务；忽略 endframe/regen、以及缺 vidu_task_id 的旧 video 条目。
    """
    path = _STATE_PATH
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        tasks = raw.get("tasks")
        if isinstance(tasks, dict):
            merged = {str(k): dict(v) for k, v in tasks.items() if isinstance(v, dict)}
            return filter_persistable_tasks(merged)
    except Exception:
        pass
    return {}


def _write_tasks_to_disk(tasks: dict[str, dict[str, Any]]) -> None:
    """原子写入 JSON（整文件覆盖）；仅写入可弱恢复的 video 任务。"""
    path = _STATE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    persistable = filter_persistable_tasks(tasks)
    payload = {"tasks": persistable, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def schedule_persist(tasks: dict[str, dict[str, Any]]) -> None:
    """
    在 debounce 后把当前 tasks 快照写入磁盘。

    Args:
        tasks: 与 routes.tasks._local_tasks 相同的引用或快照
    """
    global _flush_timer, _dirty
    with _timer_lock:
        _dirty = True

        def _flush() -> None:
            global _flush_timer, _dirty
            with _timer_lock:
                _flush_timer = None
                if not _dirty:
                    return
                _dirty = False
            try:
                _write_tasks_to_disk(dict(tasks))
            except Exception:
                pass

        if _flush_timer is not None:
            _flush_timer.cancel()
        _flush_timer = threading.Timer(_DEBOUNCE_SEC, _flush)
        _flush_timer.daemon = True
        _flush_timer.start()


def flush_now(tasks: dict[str, dict[str, Any]]) -> None:
    """立即刷盘（进程退出前可选调用）。"""
    global _flush_timer, _dirty
    with _timer_lock:
        if _flush_timer is not None:
            _flush_timer.cancel()
            _flush_timer = None
        _dirty = False
    try:
        _write_tasks_to_disk(dict(tasks))
    except Exception:
        pass
