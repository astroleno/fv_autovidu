# -*- coding: utf-8 -*-
"""
FV Studio 后端入口

FastAPI 应用，提供 /api 路由供前端调用。
启动：cd web/server && uvicorn main:app --reload --port 8000
或：uvicorn web.server.main:app --reload --port 8000（需从项目根运行）
"""

import sys
from pathlib import Path

# 确保 web/server 在 sys.path 中，便于 from models.xxx 导入
_SERVER_DIR = Path(__file__).resolve().parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import episodes, export_route, files, generate, shots, tasks

app = FastAPI(title="FV Studio API", version="1.0.0")

# CORS：允许前端开发服务器（Vite 默认 5173）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载路由（前端期望 /api 前缀，路由内部已包含 /api）
app.include_router(files.router, prefix="/api", tags=["files"])
app.include_router(episodes.router, prefix="/api", tags=["episodes"])
app.include_router(shots.router, prefix="/api", tags=["shots"])
app.include_router(generate.router, prefix="/api", tags=["generate"])
app.include_router(tasks.router, prefix="/api", tags=["tasks"])
app.include_router(export_route.router, prefix="/api", tags=["export"])


@app.get("/api/health")
def health():
    """健康检查。"""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
