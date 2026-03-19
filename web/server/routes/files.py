# -*- coding: utf-8 -*-
"""
静态文件服务：GET /api/files/{path:path}

前端通过 getFileUrl(relativePath, basePath) 获取 URL，
path 格式为 projectId/episodeId/frames/S01.png 或 projectId/episodeId/assets/xxx.png
映射到 DATA_ROOT/{path}。
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


@router.get("/files/{path:path}")
def serve_file(path: str):
    """
    流式返回本地文件。
    path 相对 DATA_ROOT，如 proj-id/ep-id/frames/S01.png
    """
    if not path or ".." in path or path.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid path")
    full_path = DATA_ROOT / path
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    # 防止路径穿越
    try:
        full_path = full_path.resolve()
        if not str(full_path).startswith(str(DATA_ROOT.resolve())):
            raise HTTPException(status_code=400, detail="Invalid path")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")
    media_type = _MIME.get(full_path.suffix.lower(), "application/octet-stream")
    return FileResponse(full_path, media_type=media_type)
