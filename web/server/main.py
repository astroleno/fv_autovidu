# -*- coding: utf-8 -*-
"""
FV Studio 后端入口

FastAPI 应用，提供 /api 路由供前端调用。
启动（开发模式）：cd web/server && uvicorn main:app --reload --port 8000
或：uvicorn web.server.main:app --reload --port 8000（需从项目根运行）

生产 / 打包模式下同时托管构建好的前端静态文件（SPA），
由 _mount_frontend_spa() 在应用启动时按需挂载。
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Optional

# 确保 web/server 在 sys.path 中，便于 from models.xxx 导入
_SERVER_DIR = Path(__file__).resolve().parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

# 尽早加载项目根 .env（DATA_ROOT、FEELING_* 等），避免仅在被 import 的路由里才触发 load_dotenv
import config  # noqa: F401  # pylint: disable=unused-import

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import dub_route, episodes, export_route, files, generate, projects, shots, tasks
from services.task_store import TaskStoreService
from services.task_store.video_finalizer import start_video_finalizer_background

_LOG = logging.getLogger(__name__)

app = FastAPI(title="FV Studio API", version="1.0.0")


@app.on_event("startup")
def _startup_task_store() -> None:
    """
    初始化 SQLite 任务库、导入旧版 tasks_state.json、标记中断任务、启动 video 收尾线程。
    """
    try:
        TaskStoreService.init_database()
        TaskStoreService.migrate_legacy_json()
        TaskStoreService.mark_interrupted_processing()
        start_video_finalizer_background()
    except Exception:  # pylint: disable=broad-except
        # 不因任务子系统失败阻止 API 启动，但必须保留堆栈以便排查。
        _LOG.exception("task_store startup failed")


# ---------------------------------------------------------------------------
# CORS：开发模式允许 Vite 开发服务器跨域（5173），
# 生产模式下前端由同源 FastAPI 托管，无跨域问题
# ---------------------------------------------------------------------------
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
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(shots.router, prefix="/api", tags=["shots"])
app.include_router(generate.router, prefix="/api", tags=["generate"])
app.include_router(tasks.router, prefix="/api", tags=["tasks"])
app.include_router(export_route.router, prefix="/api", tags=["export"])
app.include_router(dub_route.router, prefix="/api", tags=["dub"])


@app.get("/api/health")
def health():
    """健康检查。"""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# 前端 SPA 静态文件托管（仅在构建产物存在时启用）
#
# 策略：
# - PyInstaller 冻结模式：前端 dist 位于 sys._MEIPASS/web/frontend/dist/
# - 开发模式手动构建后：前端 dist 位于 <项目根>/web/frontend/dist/
# - 纯开发模式（Vite dev server）：dist 目录不存在，跳过挂载
# ---------------------------------------------------------------------------
def _resolve_frontend_dist() -> Optional[Path]:
    """
    返回前端构建产物目录路径；若不存在则返回 None。
    """
    if getattr(sys, "frozen", False):
        # 冻结模式：资源在 _MEIPASS（PyInstaller 解包根目录）
        bundle_dir = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    else:
        # 开发 / 非打包生产模式：项目根 = web/server 上两级
        bundle_dir = Path(__file__).resolve().parent.parent.parent

    dist = bundle_dir / "web" / "frontend" / "dist"
    return dist if dist.is_dir() else None


def _mount_frontend_spa() -> None:
    """
    若前端构建产物存在，则：
    1. 挂载 /assets 为 StaticFiles（Vite 将 JS/CSS/图片输出到 assets/）
    2. 注册 catch-all 路由，将所有非 /api 请求重定向到 index.html（SPA 路由）
    """
    dist = _resolve_frontend_dist()
    if dist is None:
        _LOG.info("前端构建产物未找到，跳过 SPA 静态托管（开发模式请用 Vite dev server）")
        return

    _LOG.info("挂载前端 SPA 静态文件：%s", dist)

    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    # Vite 构建输出的静态资源目录
    assets_dir = dist / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

    @app.get("/{full_path:path}")
    async def _serve_frontend_spa(full_path: str) -> FileResponse:
        """
        SPA catch-all：
        - 若请求路径对应 dist/ 下的真实文件（如 favicon.ico），直接返回
        - 否则返回 index.html，由前端路由处理
        注意：该路由注册在所有 /api 路由之后，不会拦截 API 请求
        """
        file_path = dist / full_path
        if full_path and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(dist / "index.html"))


# 执行挂载（仅在 dist 存在时生效）
_mount_frontend_spa()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
