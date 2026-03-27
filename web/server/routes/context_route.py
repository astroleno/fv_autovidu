# -*- coding: utf-8 -*-
"""
Feeling 上下文 API：列出环境与 Profile、校验登录（不返回密钥）。

前缀由 main.py 挂到 /api。
"""

from __future__ import annotations

import sys
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _SERVER_DIR.parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.context_service import get_context_resolver

router = APIRouter(prefix="/contexts", tags=["contexts"])


class ValidateContextBody(BaseModel):
    """校验指定 Profile 能否成功登录 Feeling。"""

    contextId: str = Field(..., description="与 feeling_contexts.json 中 profile key 一致")


@router.get("")
def list_contexts():
    """
    返回全部环境与可用 Profile 摘要（不含密码、不含环境变量值）。
    未配置 feeling_contexts.json 时返回空列表，便于前端降级为「仅 .env 模式」。
    """
    try:
        r = get_context_resolver()
        environments = r.list_environments()
        profiles = r.list_profiles()
    except FileNotFoundError:
        return {"environments": [], "profiles": [], "configured": False}
    except Exception as e:  # noqa
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"environments": environments, "profiles": profiles, "configured": True}


@router.post("/validate")
def validate_context(body: ValidateContextBody):
    """
    尝试对指定 contextId 执行 Feeling login；成功返回 ok，失败返回 502/400。
    """
    from src.feeling.context import validate_context_login

    try:
        # project_root=None：与 get_context_resolver 一致，冻结模式下按 exe 旁再 _internal 顺序查找
        validate_context_login(body.contextId.strip(), project_root=None)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"ok": True, "contextId": body.contextId.strip()}
