# -*- coding: utf-8 -*-
"""
同一 episodeId 在进程内的「目录级」互斥锁。

用途：
- pull_episode 执行归一化（删/迁旧目录）与写入 episode.json、frames、assets 时；
- 后台 dub、video_finalizer 在同一路径下写 dub/、videos/、改 episode.json 时；

避免与 pull 交叉导致：缓存的 ep_dir 指向已删目录、mkdir 复活旧 project 路径、读写不一致。

注意：与 data_service._episode_mutation_lock 不同：本锁保护「整段跨目录文件操作」，
后者仅保护 episode.json 的读改写。后台写盘路径应先持本锁再调用 data_service（其内部仍会持 mutation 锁）。
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Generator

_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _lock_for(episode_id: str) -> threading.Lock:
    with _guard:
        if episode_id not in _locks:
            _locks[episode_id] = threading.Lock()
        return _locks[episode_id]


@contextmanager
def episode_fs_lock(episode_id: str) -> Generator[None, None, None]:
    """在持有期间，其它线程对同一 episodeId 的 episode_fs_lock 将阻塞。"""
    lock = _lock_for(episode_id)
    lock.acquire()
    try:
        yield
    finally:
        lock.release()
