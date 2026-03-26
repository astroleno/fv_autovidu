# -*- coding: utf-8 -*-
"""
静态文件服务：GET /api/files/{path:path}

前端 getFileUrl(relativePath, basePath)：
- 无多上下文：basePath = projectId/episodeId → path = projectId/episodeId/frames/...
- 多上下文：basePath = contextId/projectId/episodeId → 首段为 profile id，映射到 DATA_ROOT/envKey/workspaceKey/...

未命中命名空间路径时回退旧版 DATA_ROOT 直连拼接（迁移期兼容）。
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

# 项目根目录（用于解析 DATA_ROOT）
import sys

_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from config import DATA_ROOT

router = APIRouter()

# 允许的 MIME 类型
_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
}


def _resolve_file_under_data_root(path: str) -> Path:
    """
    将 URL path 解析为磁盘绝对路径并做越界检查。

    Raises:
        HTTPException: 非法 path 或路径不在 DATA_ROOT 下。
    """
    if not path or ".." in path or path.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid path")
    data_root = Path(DATA_ROOT).resolve()
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    full_path: Path | None = None
    legacy_rel_from_context: str | None = None

    # 至少三段 contextId/projectId/episodeId/... 时才尝试按 Feeling profile 解析
    if len(parts) >= 3:
        try:
            from services.context_service import get_context_resolver
            from src.feeling.context import get_context_data_root

            ctx = get_context_resolver().resolve(parts[0])
            ns = get_context_data_root(ctx, data_root).resolve()
            rel = "/".join(parts[1:])
            legacy_rel_from_context = rel
            candidate = (ns / rel).resolve()
            if candidate.is_file() and str(candidate).startswith(str(ns)):
                full_path = candidate
        except (ValueError, FileNotFoundError, OSError):
            full_path = None

    if (full_path is None or not full_path.is_file()) and legacy_rel_from_context:
        legacy_candidate = (data_root / legacy_rel_from_context).resolve()
        if legacy_candidate.is_file() and str(legacy_candidate).startswith(str(data_root)):
            full_path = legacy_candidate

    if full_path is None or not full_path.is_file():
        full_path = (data_root / path).resolve()

    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if not str(full_path).startswith(str(data_root)):
        raise HTTPException(status_code=400, detail="Invalid path")
    return full_path


@router.get("/files/{path:path}")
def serve_file(path: str):
    """
    流式返回本地文件。
    path 可为旧版 proj-id/ep-id/frames/S01.png，或带 profile 前缀的 contextId/proj/ep/frames/...。
    """
    full_path = _resolve_file_under_data_root(path)
    media_type = _MIME.get(full_path.suffix.lower(), "application/octet-stream")
    return FileResponse(full_path, media_type=media_type)
