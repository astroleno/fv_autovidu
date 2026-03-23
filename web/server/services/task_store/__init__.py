# -*- coding: utf-8 -*-
"""
任务状态存储包（SQLite）

最小可落地版：持久化 video / endframe / dub / regen 任务状态，
不实现通用队列与自动重试。

对外主要入口：
- `get_task_store()`：TaskStoreService 单例
- `TaskStoreService.init_database()`：启动建表
"""

from .db import DB_PATH, get_connection, init_db
from .models import TaskRow
from .service import TaskStoreService, get_task_store, infer_kind_from_task_id

__all__ = [
    "DB_PATH",
    "TaskRow",
    "TaskStoreService",
    "get_connection",
    "get_task_store",
    "infer_kind_from_task_id",
    "init_db",
]
