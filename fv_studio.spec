# -*- mode: python ; coding: utf-8 -*-
"""
FV Studio — PyInstaller 打包配置文件

使用方式：
  pyinstaller fv_studio.spec

产物位于 dist/FV_Studio/ 目录，包含：
  FV_Studio.exe          — 主程序入口
  _internal/             — Python 运行时、依赖库、前端构建产物

打包策略（--onedir）：
  - 比 --onefile 启动更快（无需每次解压到临时目录）
  - 便于分发（压缩为 zip 即可）
  - 便于用户在同目录放置 .env 和 data/

pathex 说明：
  - 'web/server'：使 routes/services/models/config 等模块可被 PyInstaller 分析
  - '.'（项目根）：使 src.feeling/src.vidu/src.yunwu 等包可被发现

hiddenimports：
  项目大量使用延迟导入（if/函数体内 import），PyInstaller 静态分析无法追踪，
  因此需要显式列出所有动态导入的模块。
"""

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# 基础路径（SPECPATH 是 PyInstaller 内置变量，指向 spec 文件所在目录 = 项目根目录）
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 数据文件：非 Python 资源，打包后保持原始目录结构
# 格式：(源路径, 目标目录——相对于 _internal/)
# ---------------------------------------------------------------------------
datas = [
    # 前端构建产物（vite build 输出）
    (os.path.join('web', 'frontend', 'dist'), os.path.join('web', 'frontend', 'dist')),
    # 默认 YAML 配置（CLI 脚本可能读取，一并打入）
    (os.path.join('config', 'default.yaml'), 'config'),
    # Feeling 多 Profile 模板：用户可复制为 exe 同级 config/feeling_contexts.json（或 _internal/config/）
    (os.path.join('config', 'feeling_contexts.example.json'), 'config'),
    # .env.example 作为参考模板
    ('.env.example', '.'),
]

# 过滤掉不存在的数据路径（如前端未构建时 dist 不存在）
datas = [(src, dst) for src, dst in datas if os.path.exists(src)]

# Windows 分发：CI 将 BtbN 构建解压到 vendor/ffmpeg-windows/，整目录打入 _internal/ffmpeg/
_bundled_ffmpeg = os.path.join(SPECPATH, 'vendor', 'ffmpeg-windows')
_ff = os.path.join(_bundled_ffmpeg, 'bin', 'ffmpeg.exe')
_fp = os.path.join(_bundled_ffmpeg, 'bin', 'ffprobe.exe')
if os.path.isfile(_ff) and os.path.isfile(_fp):
    datas.append((_bundled_ffmpeg, 'ffmpeg'))

# ---------------------------------------------------------------------------
# 隐式导入：PyInstaller 静态分析遗漏的动态 import
# ---------------------------------------------------------------------------
hiddenimports = [
    # ---- uvicorn 内部模块（启动时按字符串动态加载） ----
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.loops.asyncio',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.http.httptools_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.wsproto_impl',
    'uvicorn.protocols.websockets.websockets_impl',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'uvicorn.lifespan.off',

    # ---- FastAPI / Starlette / Pydantic ----
    'fastapi',
    'fastapi.staticfiles',
    'fastapi.responses',
    'starlette.staticfiles',
    'starlette.responses',
    'pydantic',
    'email_validator',
    'multipart',
    'python_multipart',

    # ---- web/server 内部模块（通过 sys.path 动态导入） ----
    'main',
    'config',
    'routes',
    'routes.dub_route',
    'routes.episodes',
    'routes.export_route',
    'routes.files',
    'routes.generate',
    'routes.projects',
    'routes.shots',
    'routes.tasks',
    'services',
    'services.data_service',
    'services.vidu_service',
    'services.yunwu_service',
    'services.elevenlabs_service',
    'services.audio_service',
    'services.ffmpeg_paths',
    'services.ffmpeg_service',
    'services.candidate_pick',
    'services.jianying_service',
    'services.jianying_ffprobe_materials',
    'services.jianying_protocol',
    'services.task_store',
    'services.task_store.db',
    'services.task_store.models',
    'services.task_store.repository',
    'services.task_store.runtime_config',
    'services.task_store.service',
    'services.task_store.video_finalizer',
    'models',
    'models.schemas',

    # ---- src 包（项目根级 Python 包，路由/服务中延迟 import） ----
    'src',
    'src.feeling',
    'src.feeling.client',
    'src.feeling.puller',
    'src.feeling.episode_fs_lock',
    'src.vidu',
    'src.vidu.client',
    'src.yunwu',
    'src.yunwu.client',
    'src.utils',
    'src.utils.retry',
    'src.pipeline',
    'src.pipeline.logger',

    # ---- 第三方包（可能被延迟导入） ----
    'PIL',
    'PIL.Image',
    'yaml',
    'dotenv',
    'requests',
    'pyJianYingDraft',
    'eval_type_backport',
]

# ---------------------------------------------------------------------------
# 排除模块：减小体积（测试框架、不需要的大型库）
# ---------------------------------------------------------------------------
excludes = [
    'tkinter',
    'unittest',
    'test',
    'tests',
    'pytest',
    'setuptools',
    'pip',
    'wheel',
    'distutils',
    'lib2to3',
    'ensurepip',
    'venv',
    'idlelib',
    'turtledemo',
    'pydoc_data',
]

# ---------------------------------------------------------------------------
# Analysis：收集所有依赖
# ---------------------------------------------------------------------------
a = Analysis(
    # 入口脚本
    ['launcher.py'],
    # 额外搜索路径（帮助 PyInstaller 发现通过 sys.path 动态加入的模块）
    pathex=[
        os.path.join(SPECPATH, 'web', 'server'),    # routes / services / models / config
        SPECPATH,                                     # src.* 包（项目根目录）
    ],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

# ---------------------------------------------------------------------------
# PYZ：Python 字节码归档
# ---------------------------------------------------------------------------
pyz = PYZ(a.pure)

# ---------------------------------------------------------------------------
# EXE：可执行文件
# ---------------------------------------------------------------------------
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,   # --onedir 模式：二进制文件放在 COLLECT 中
    name='FV_Studio',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,                # 启用 UPX 压缩（如 CI 环境有 UPX 则生效）
    console=True,            # 保留控制台窗口，方便查看日志
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # 可在此处添加 icon='assets/icon.ico' 指定程序图标
)

# ---------------------------------------------------------------------------
# COLLECT：收集所有文件到 dist/FV_Studio/ 目录
# ---------------------------------------------------------------------------
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='FV_Studio',
)
