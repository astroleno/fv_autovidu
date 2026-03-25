# -*- coding: utf-8 -*-
"""
FV Studio Windows 可执行文件入口点

PyInstaller 打包后的启动脚本，负责：
1. 检测冻结环境（PyInstaller）并设置正确的路径环境变量
2. 将 web/server 目录加入 sys.path，使内部模块可导入
3. 启动 uvicorn 运行 FastAPI 后端
4. 延迟 1.5 秒后自动在默认浏览器中打开前端界面
"""

from __future__ import annotations

import os
import sys
import threading
import webbrowser

# ---------------------------------------------------------------------------
# 路径初始化：区分 PyInstaller 冻结模式与源码直接运行
# ---------------------------------------------------------------------------
# PyInstaller --onedir 模式：
#   sys._MEIPASS  → <exe所在目录>/_internal/（代码与依赖库的临时/固定目录）
#   sys.executable → <exe所在目录>/FV_Studio.exe
# 开发模式：
#   __file__ → <项目根>/launcher.py

if getattr(sys, "frozen", False):
    # ---- 冻结模式 ----
    # BUNDLE_DIR: PyInstaller 解包后的内部资源目录（_internal/）
    BUNDLE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    # EXE_DIR: .exe 所在目录，用于查找用户可配置文件（.env、data/）
    EXE_DIR = os.path.dirname(sys.executable)
else:
    # ---- 开发模式 ----
    BUNDLE_DIR = os.path.dirname(os.path.abspath(__file__))
    EXE_DIR = BUNDLE_DIR

# 设置环境变量，供 web/server/config.py 识别运行环境
os.environ["FV_STUDIO_EXE_DIR"] = EXE_DIR
os.environ["FV_STUDIO_BUNDLE_DIR"] = BUNDLE_DIR

# 将 web/server 加入 sys.path，使 main / config / routes / services 可直接 import
# 注意：PyInstaller 通过 pathex 收集模块后会平铺到 _internal/，
# 运行时 _internal/ 已在 sys.path 中，因此此步骤在冻结模式下通常冗余但无害
_server_dir = os.path.join(BUNDLE_DIR, "web", "server")
if _server_dir not in sys.path:
    sys.path.insert(0, _server_dir)

# 项目根目录也需要在 path 中，以便 from src.xxx import ... 生效
if BUNDLE_DIR not in sys.path:
    sys.path.insert(0, BUNDLE_DIR)


# ---------------------------------------------------------------------------
# 浏览器自动打开（后台线程，延迟启动避免服务未就绪）
# ---------------------------------------------------------------------------
def _open_browser(port: int, delay: float = 1.5) -> None:
    """在守护线程中延迟打开浏览器。"""
    import time

    time.sleep(delay)
    url = f"http://localhost:{port}"
    try:
        webbrowser.open(url)
    except Exception:
        pass  # 无头环境下忽略


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------
def main() -> None:
    """启动 FV Studio 后端服务。"""
    import uvicorn  # 延迟导入，避免在路径设置前触发

    # 读取端口配置（与 config.py 的 WEB_PORT 保持一致）
    port = int(os.environ.get("WEB_PORT", "8000"))

    print("=" * 50)
    print("  FV Studio 正在启动...")
    print(f"  请在浏览器中访问 http://localhost:{port}")
    print("  按 Ctrl+C 停止服务")
    print("=" * 50)

    # 启动浏览器打开线程
    threading.Thread(target=_open_browser, args=(port,), daemon=True).start()

    # 导入 FastAPI 应用并启动（必须在路径设置之后）
    # 注意：web/ 和 web/server/ 不是 Python 包（无 __init__.py），
    # 但 web/server 已加入 sys.path，因此 main.py 可作为顶层模块直接 import
    import main as _server_main  # noqa: E402  — 即 web/server/main.py

    uvicorn.run(
        _server_main.app,
        host="0.0.0.0",
        port=port,
        log_level="info",
        # 冻结模式下禁用热重载（无源文件可监听）
        reload=False,
    )


if __name__ == "__main__":
    main()
