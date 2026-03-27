# -*- coding: utf-8 -*-
"""
Feeling 运行上下文：多环境 + 多 Profile 下的请求级配置解析。

职责概要（与 docs/环境与多用户管理/环境与用户上下文隔离方案.md 一致）：
- 从 config/feeling_contexts.json 加载环境与 Profile 元数据（不含明文密码）；
- 按 profile 的 credentialSource 从环境变量解析真实 identifier/password；
- 组装 FeelingContext 并构造 FeelingClient、计算本地数据命名空间根路径。

凭据落地现状（避免与「方案全文」混淆）：
- **已落地**：`feeling_contexts.json` 仅存放 `credentialSource` 对环境变量**名的引用**；真实密码在进程环境中
  （后端由 `web/server/config.py` 顺序加载 `.env` 与 **`.env.local`（override）**，二者均不应提交 git）。
- **未落地**：`credentialSource.type=keychain` 仅为接口预留，调用会显式报错；系统钥匙串 / Keychain 增强版尚无实现。

注意：本模块可被 web 后端与 CLI/脚本共用；解析项目根时与 web/server/config.py 的策略对齐。
"""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 项目根目录（开发模式：仓库根；冻结模式：exe 同级，与 config 一致）
# ---------------------------------------------------------------------------

def _use_packaged_path_resolution() -> bool:
    """
    是否按「分发包」规则解析路径（PyInstaller 等）。

    仅依赖 sys.frozen 不够：少数入口下 frozen 未置位但 bootloader 已注入 _MEIPASS；
    反之亦然。二者任一成立即视为打包运行，避免误走源码 __file__ 推导的根目录。
    """
    return bool(getattr(sys, "frozen", False)) or bool(getattr(sys, "_MEIPASS", None))


def feeling_project_root() -> Path:
    """
    返回用于定位 config/feeling_contexts.json 的项目根目录。

    - 若存在 FV_STUDIO_EXE_DIR（PyInstaller launcher 设置），优先使用该目录；
    - 否则以本文件向上三级定位到仓库根（src/feeling/context.py -> repo）。
    """
    if _use_packaged_path_resolution():
        return Path(os.environ.get("FV_STUDIO_EXE_DIR", str(Path(sys.executable).parent)))
    return Path(__file__).resolve().parent.parent.parent


def _feeling_bundle_dir() -> Path | None:
    """
    PyInstaller 冻结模式下「打包资源根」（通常为 exe 同级的 _internal/）。

    launcher.py 会设置 FV_STUDIO_BUNDLE_DIR；若未设置则回退 sys._MEIPASS，
    以便在非 launcher 入口下仍能定位随包分发的默认配置。
    """
    if not _use_packaged_path_resolution():
        return None
    raw = (os.environ.get("FV_STUDIO_BUNDLE_DIR") or "").strip()
    if raw:
        return Path(raw)
    meipass = getattr(sys, "_MEIPASS", None)
    return Path(meipass) if meipass else None


def _dedupe_path_order(paths: list[Path]) -> list[Path]:
    """按出现顺序去重，避免 exe/_internal 与 _MEIPASS 指向同一目录时重复探测。"""
    seen: set[str] = set()
    out: list[Path] = []
    for p in paths:
        try:
            key = str(p.resolve()).lower()
        except (OSError, RuntimeError):
            key = str(p).lower()
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def feeling_contexts_json_candidates(project_root: Path | None = None) -> list[Path]:
    """
    按优先级返回可能的 feeling_contexts.json 绝对路径列表（用于探测首个存在的文件）。

    打包模式（与 web/server/config.py 的 .env 路径策略对齐）：
    1. EXE 同级 config/（用户可编辑，与 .env 放一处）
    2. EXE 同级 _internal/config/（PyInstaller --onedir 固定布局；不依赖 _MEIPASS / 环境变量）
    3. _MEIPASS 或 FV_STUDIO_BUNDLE_DIR 下的 config/（与 2 常相同，去重）

    同时尝试文件名 feeling_contexts.json 与无扩展名 feeling_contexts（Windows 下易误保存为「无后缀」）。

    开发模式：仓库根 config/ 下上述两种文件名。

    说明：仅依赖 _MEIPASS 时，若运行时未注入或路径异常，会导致找不到 _internal 内文件；
    显式拼接 exe/_internal/config 可闭环。
    """
    if not _use_packaged_path_resolution():
        root = Path(project_root) if project_root else feeling_project_root()
        base = root / "config"
        return _dedupe_path_order(
            [base / "feeling_contexts.json", base / "feeling_contexts"]
        )

    exe_root = Path(os.environ.get("FV_STUDIO_EXE_DIR", str(Path(sys.executable).parent)))
    bundle = _feeling_bundle_dir()
    bases = _dedupe_path_order(
        [
            exe_root / "config",
            exe_root / "_internal" / "config",
            *([bundle / "config"] if bundle else []),
        ]
    )
    names = ("feeling_contexts.json", "feeling_contexts")
    out: list[Path] = []
    for base in bases:
        for name in names:
            out.append(base / name)
    return _dedupe_path_order(out)


@dataclass(frozen=True)
class FeelingContext:
    """
    单次 API 调用或拉取任务所需的最小 Feeling 平台上下文。

    Attributes:
        context_id: 对前后端贯通的主键，通常等于 profiles 配置中的 key（如 dev_qa_zhangsan）。
        env_key: 环境键，如 dev / prod。
        profile_key: 与 context_id 相同意义，保留字段便于日志输出。
        base_url: Feeling API 基址（已去尾斜杠）。
        identifier_type: username | phone，决定传给 FeelingClient 的字段。
        identifier: 登录用的手机号或用户名。
        password: 登录密码（来自环境变量，不落 JSON）。
        workspace_key: 本地数据目录命名空间键（data/{envKey}/{workspaceKey}/...）。
        enabled: 配置项是否启用（禁用的 profile 不可 resolve）。
    """

    context_id: str
    env_key: str
    profile_key: str
    base_url: str
    identifier_type: str
    identifier: str
    password: str
    workspace_key: str
    enabled: bool


class ContextResolver:
    """
    加载 feeling_contexts.json 并按 context_id（profile key）解析 FeelingContext。

    线程安全：首次 load 后配置只读；多线程可同时 resolve。
    """

    def __init__(self, project_root: Path | None = None) -> None:
        self._project_root = Path(project_root) if project_root else feeling_project_root()
        self._raw: dict[str, Any] | None = None
        # load() 成功后指向实际打开的 JSON 路径（冻结模式下可能是 exe 旁或 _internal）
        self._resolved_path: Path | None = None

    def config_path(self) -> Path:
        """
        「首选」配置文件路径：用于错误提示与用户文档（冻结模式下指 exe 旁 config/，
        与放置 .env 的目录一致；非冻结为仓库 config/）。
        """
        cands = feeling_contexts_json_candidates(
            None if _use_packaged_path_resolution() else self._project_root
        )
        return cands[0] if cands else self._project_root / "config" / "feeling_contexts.json"

    def resolved_config_path(self) -> Path | None:
        """成功 load 后指向实际读取的文件；未 load 时为 None。"""
        return self._resolved_path

    def load(self, *, force: bool = False) -> dict[str, Any]:
        """
        读取并缓存 JSON。若文件不存在则抛出 FileNotFoundError。

        Returns:
            原始 dict（environments / profiles）。
        """
        if self._raw is not None and not force:
            return self._raw
        candidates = feeling_contexts_json_candidates(
            None if _use_packaged_path_resolution() else self._project_root
        )
        path: Path | None = next((p for p in candidates if p.is_file()), None)
        if path is None:
            logger.warning(
                "未找到 feeling_contexts 配置，已探测路径（按顺序）：%s",
                "; ".join(str(p) for p in candidates[:12])
                + ("…" if len(candidates) > 12 else ""),
            )
            primary = self.config_path()
            extra = ""
            if len(candidates) > 1:
                extra = f"；亦已查找：{candidates[1]}"
            raise FileNotFoundError(
                f"缺少 Feeling 上下文配置：{primary}{extra}（可从 config/feeling_contexts.example.json 复制并填写）"
            )
        self._resolved_path = path
        self._raw = json.loads(path.read_text(encoding="utf-8"))
        return self._raw

    def list_environments(self) -> list[dict[str, Any]]:
        """返回环境列表（不含密钥），供 GET /api/contexts 使用。"""
        raw = self.load()
        envs = raw.get("environments") or {}
        out: list[dict[str, Any]] = []
        for key, obj in envs.items():
            if not isinstance(obj, dict):
                continue
            out.append({
                "key": key,
                "label": str(obj.get("label", key)),
                "baseUrl": str(obj.get("baseUrl", "")),
            })
        out.sort(key=lambda x: str(x["key"]))
        return out

    def list_profiles(self, env_key: str | None = None) -> list[dict[str, Any]]:
        """
        返回 Profile 摘要列表；若指定 env_key 则只返回该环境下的 profile。
        """
        raw = self.load()
        profiles = raw.get("profiles") or {}
        out: list[dict[str, Any]] = []
        for pid, obj in profiles.items():
            if not isinstance(obj, dict):
                continue
            ek = str(obj.get("envKey", ""))
            if env_key is not None and ek != env_key:
                continue
            out.append({
                "id": pid,
                "label": str(obj.get("label", pid)),
                "envKey": ek,
                "enabled": bool(obj.get("enabled", True)),
            })
        out.sort(key=lambda x: str(x["id"]))
        return out

    def resolve(self, context_id: str) -> FeelingContext:
        """
        将 profile key 解析为完整 FeelingContext（含从环境变量读取的凭据）。

        Raises:
            ValueError: 配置缺失、未启用或凭据不完整。
            FileNotFoundError: feeling_contexts.json 不存在。
        """
        raw = self.load()
        cid = (context_id or "").strip()
        if not cid:
            raise ValueError("context_id 不能为空")

        profiles = raw.get("profiles") or {}
        prof = profiles.get(cid)
        if not isinstance(prof, dict):
            raise ValueError(f"未知的上下文: {cid}")

        if not prof.get("enabled", True):
            raise ValueError(f"上下文已禁用: {cid}")

        env_key = str(prof.get("envKey", "")).strip()
        if not env_key:
            raise ValueError(f"Profile {cid} 缺少 envKey")

        environments = raw.get("environments") or {}
        env_obj = environments.get(env_key)
        if not isinstance(env_obj, dict):
            raise ValueError(f"未知环境: {env_key}")

        base_url = str(env_obj.get("baseUrl", "")).rstrip("/")
        if not base_url:
            raise ValueError(f"环境 {env_key} 缺少 baseUrl")

        workspace_key = str(prof.get("workspaceKey", cid)).strip() or cid
        id_type = str(prof.get("identifierType", "username")).strip().lower()
        if id_type not in ("username", "phone"):
            id_type = "username"

        cred = prof.get("credentialSource") or {}
        if not isinstance(cred, dict):
            raise ValueError(f"Profile {cid} 的 credentialSource 无效")

        ident, password = _resolve_credential_source(cred, profile_id=cid)

        return FeelingContext(
            context_id=cid,
            env_key=env_key,
            profile_key=cid,
            base_url=base_url,
            identifier_type=id_type,
            identifier=ident,
            password=password,
            workspace_key=workspace_key,
            enabled=True,
        )


def _resolve_credential_source(cred: dict[str, Any], *, profile_id: str) -> tuple[str, str]:
    """
    根据 credentialSource 从 env（首版）或后续 keychain 读取 identifier 与 password。

    Returns:
        (identifier, password)

    Raises:
        ValueError: type 不支持或环境变量缺失。
    """
    ctype = str(cred.get("type", "env")).strip().lower()
    if ctype == "env":
        ienv = str(cred.get("identifierEnv", "")).strip()
        penv = str(cred.get("passwordEnv", "")).strip()
        if not ienv or not penv:
            raise ValueError(f"Profile {profile_id} 的 env 凭据需配置 identifierEnv 与 passwordEnv")
        ident = os.environ.get(ienv, "").strip()
        password = os.environ.get(penv, "").strip()
        if not ident:
            raise ValueError(f"环境变量未设置或为空: {ienv}")
        if not password:
            raise ValueError(f"环境变量未设置或为空: {penv}")
        return ident, password
    if ctype == "keychain":
        raise ValueError("credentialSource type=keychain 尚未实现，请改用 type=env")
    raise ValueError(f"不支持的 credentialSource.type: {ctype}")


def get_context_data_root(ctx: FeelingContext, data_root: Path) -> Path:
    """
    返回某上下文下的「数据命名空间根」：data_root / envKey / workspaceKey。

    Args:
        ctx: 已解析的 FeelingContext。
        data_root: 全局 DATA_ROOT（与 config.DATA_ROOT 一致）。

    Returns:
        绝对路径语义由调用方 resolve；此处仅做拼接。
    """
    return Path(data_root) / ctx.env_key / ctx.workspace_key


def build_feeling_client(ctx: FeelingContext):
    """
    基于上下文显式构造 FeelingClient（避免无参构造读全局 .env）。

    Returns:
        src.feeling.client.FeelingClient 实例。
    """
    # 延迟导入避免循环依赖
    from src.feeling.client import FeelingClient

    if ctx.identifier_type == "phone":
        return FeelingClient(
            base_url=ctx.base_url,
            phone=ctx.identifier,
            password=ctx.password,
        )
    return FeelingClient(
        base_url=ctx.base_url,
        username=ctx.identifier,
        password=ctx.password,
    )


def validate_context_login(context_id: str, *, project_root: Path | None = None) -> None:
    """
    尝试登录以校验配置；失败时抛出与原 FeelingClient 一致的异常。

    Raises:
        RuntimeError: 登录失败（网络/密码错误）。
        ValueError / FileNotFoundError: 配置问题。
    """
    resolver = ContextResolver(project_root)
    ctx = resolver.resolve(context_id)
    client = build_feeling_client(ctx)
    client.login()
