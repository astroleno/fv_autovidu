# -*- coding: utf-8 -*-
"""
请求级 Feeling 上下文辅助：从 Request.state 读取中间件注入的 FeelingContext，
并提供 FeelingClient、数据命名空间根、任务上下文 id 等统一入口。

设计说明：
- 无请求对象的后台线程（如 video_finalizer）应使用 TaskRow.context_id + namespace_root_from_context_id。
- 与 src.feeling.context 配合：解析逻辑在库内，Web 层仅做依赖注入与路径桥接。
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from fastapi import Request

    from src.feeling.context import FeelingContext

_context_resolver: Optional[object] = None

# HTTP 头名称（小写，ASGI 标准通常为 lower-case keys）
HEADER_FV_CONTEXT_ID = "x-fv-context-id"


def feeling_context_middleware_applies_to_path(url_path: str) -> bool:
    """
    是否对当前请求路径解析并校验 X-FV-Context-Id。

    /api/contexts 及其子路径为引导接口：须在未配置或本地 persisted ID 已失效时仍能返回 JSON
   （例如 configured: false），不能因中间件 400 阻断前端自愈。
    """
    path = (url_path or "").split("?", 1)[0].rstrip("/") or "/"
    if path == "/api/contexts":
        return False
    if path.startswith("/api/contexts/"):
        return False
    return True


def get_context_resolver():
    """
    惰性单例：解析 config/feeling_contexts.json。

    注意：不可用 __file__ 推算「仓库根」。PyInstaller 下 __file__ 位于 _internal/，
    会导致只认打包目录而忽略 exe 同级的 config/；且与 web/server/config.py 的
    FV_STUDIO_EXE_DIR（.env 所在根）不一致。此处传 None，由 ContextResolver 使用
    feeling_project_root() 与 feeling_contexts_json_candidates 统一解析路径。
    """
    global _context_resolver
    if _context_resolver is None:
        from src.feeling.context import ContextResolver

        _context_resolver = ContextResolver(None)
    return _context_resolver


def apply_request_feeling_context(request: "Request") -> str | None:
    """
    由中间件调用：根据 X-FV-Context-Id 填充 request.state.feeling_context。

    Returns:
        失败时的错误文案（HTTP 400）；成功返回 None。
    """
    raw = (request.headers.get(HEADER_FV_CONTEXT_ID) or "").strip()
    if not raw:
        request.state.feeling_context = None
        return None
    try:
        request.state.feeling_context = get_context_resolver().resolve(raw)
    except FileNotFoundError as e:
        return str(e)
    except ValueError as e:
        return str(e)
    except Exception as e:  # pylint: disable=broad-except
        return f"上下文解析失败: {e}"
    return None


def get_feeling_context(request: "Request") -> Optional["FeelingContext"]:
    """从 request.state 读取 FeelingContext；无 Header 或未解析时为 None。"""
    return getattr(request.state, "feeling_context", None)


def fs_lock_tag_from_namespace_root(namespace_root: Path | None) -> str:
    """
    将命名空间根目录转为 episode_fs_lock 的 data_namespace。

    使用相对 DATA_ROOT 的路径（如 dev/my_workspace），与 pull_episode 传入的 fs_lock_namespace 一致。
    """
    if namespace_root is None:
        return ""
    from config import DATA_ROOT

    dr = Path(DATA_ROOT).resolve()
    try:
        return str(namespace_root.resolve().relative_to(dr)).replace("\\", "/")
    except ValueError:
        return ""


def get_namespace_data_root_optional(request: "Request") -> Path | None:
    """
    当前请求对应的「数据子根」：DATA_ROOT / envKey / workspaceKey；
    无上下文时返回 None，表示使用扁平 DATA_ROOT（旧版 data/project/episode）。
    """
    from config import DATA_ROOT

    ctx = get_feeling_context(request)
    if not ctx:
        return None
    from src.feeling.context import get_context_data_root

    return get_context_data_root(ctx, Path(DATA_ROOT)).resolve()


def get_context_task_id(request: "Request") -> str | None:
    """写入 tasks.context_id 时使用；无上下文为 None（兼容旧任务）。"""
    ctx = get_feeling_context(request)
    return ctx.context_id if ctx else None


def namespace_root_from_context_id(context_id: str | None) -> Path | None:
    """
    仅供无 Request 的后台逻辑使用：根据 profile id 解析命名空间根路径。

    Args:
        context_id: 与 X-FV-Context-Id 相同的 profile key；None 或空串返回 None。
    """
    if not context_id or not str(context_id).strip():
        return None
    from config import DATA_ROOT

    from src.feeling.context import get_context_data_root

    ctx = get_context_resolver().resolve(str(context_id).strip())
    return get_context_data_root(ctx, Path(DATA_ROOT)).resolve()


def get_feeling_client(request: "Request"):
    """
    若请求带有效上下文则显式构造 FeelingClient；否则回退无参构造（读 .env）。
    """
    from src.feeling.client import FeelingClient
    from src.feeling.context import build_feeling_client

    ctx = get_feeling_context(request)
    if ctx:
        return build_feeling_client(ctx)
    return FeelingClient()
