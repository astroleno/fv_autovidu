# -*- coding: utf-8 -*-
"""
task_store 内部配置桥接。

优先复用已加载的后端 `config` 模块；若当前 import 命中了项目根同名命名空间包，
则回退导入 `web.server.config`，保证在不同入口下都能解析到 DATA_ROOT。
"""

from __future__ import annotations

from pathlib import Path


def _load_config_module():
    try:
        import config as cfg  # type: ignore

        if hasattr(cfg, "DATA_ROOT"):
            return cfg
    except Exception:
        pass

    from web.server import config as cfg  # type: ignore

    return cfg


CONFIG = _load_config_module()
DATA_ROOT: Path = Path(CONFIG.DATA_ROOT)

