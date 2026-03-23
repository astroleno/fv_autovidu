# -*- coding: utf-8 -*-
"""
Feeling Video 平台 HTTP 客户端

封装平台只读 API：
- login: 登录获取 JWT（支持 phone 或 username）
- refresh: 刷新 token（建议 1.9h 刷新一次，token 有效期 2h）
- get_projects / get_project: 项目列表与详情
- get_project_episodes: 获取项目下的剧集列表
- get_shots / get_scenes / get_assets: 拉取分镜数据
- refresh_url: 刷新过期的 COS 文件 URL（备用）
- download_file: 下载文件到本地
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import requests

# 加载 .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# token 有效期 2h，建议 1.9h 刷新（6840 秒）
_TOKEN_REFRESH_BEFORE_EXPIRY = 6840


class FeelingClient:
    """
    Feeling Video 平台 API 客户端。

    使用前需在 .env 配置：
    - FEELING_API_BASE: API 基础 URL
    - FEELING_PHONE 或 FEELING_USERNAME: 登录凭据
    - FEELING_PASSWORD: 密码
    """

    def __init__(
        self,
        base_url: str | None = None,
        phone: str | None = None,
        username: str | None = None,
        password: str | None = None,
    ) -> None:
        """
        Args:
            base_url: API 基础 URL
            phone: 登录手机号（与 username 二选一）
            username: 登录用户名（与 phone 二选一）
            password: 登录密码
        """
        self.base_url = (base_url or os.environ.get("FEELING_API_BASE", "")).rstrip("/")
        self._phone = phone or os.environ.get("FEELING_PHONE", "")
        self._username = username or os.environ.get("FEELING_USERNAME", "")
        self._password = password or os.environ.get("FEELING_PASSWORD", "")
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._token_expires_at: float = 0.0  # 绝对时间戳
        self._session = requests.Session()
        self._session.headers.update({"Content-Type": "application/json"})

    def _ensure_token(self) -> str:
        """
        确保 token 有效。若已过期或即将过期（1.9h 内），则刷新。
        返回 access_token。
        """
        now = time.time()
        if self._access_token and now < self._token_expires_at - _TOKEN_REFRESH_BEFORE_EXPIRY:
            return self._access_token
        if self._refresh_token and self._access_token:
            try:
                self.refresh()
                return self._access_token or ""
            except Exception:
                pass
        self.login()
        if not self._access_token:
            raise RuntimeError("登录失败：未获取到 accessToken")
        return self._access_token

    def _set_tokens(self, data: dict[str, Any]) -> None:
        """从登录/刷新响应中解析并设置 token。"""
        token = data.get("accessToken") or data.get("access_token")
        if token:
            self._access_token = token if token.startswith("Bearer ") else f"Bearer {token}"
            self._session.headers["Authorization"] = self._access_token
        self._refresh_token = data.get("refreshToken") or data.get("refresh_token") or self._refresh_token
        # 默认 2h 有效
        expires_in = data.get("expiresIn") or data.get("expires_in") or 7200
        self._token_expires_at = time.time() + expires_in

    def login(self) -> dict[str, Any]:
        """
        调用 POST /api/auth/login 登录，缓存 Bearer JWT。
        API 格式：identifier（手机号/用户名）+ password + type: "password"
        """
        if not self.base_url:
            raise RuntimeError("请在 .env 中配置 FEELING_API_BASE")
        if not self._password:
            raise RuntimeError("请在 .env 中配置 FEELING_PASSWORD")
        ident = self._username or self._phone
        if not ident:
            raise RuntimeError("请在 .env 中配置 FEELING_USERNAME 或 FEELING_PHONE")

        url = f"{self.base_url}/auth/login"
        payload = {"identifier": ident, "password": self._password, "type": "password"}

        resp = self._session.post(url, json=payload, timeout=30)
        if not resp.ok:
            try:
                err = resp.json()
                msg = err.get("message")
                if isinstance(msg, list):
                    msg = "; ".join(str(m) for m in msg)
                elif not msg:
                    msg = err.get("userError", {}).get("message", resp.text[:200])
            except Exception:
                msg = resp.text[:200]
            raise RuntimeError(f"登录失败 ({resp.status_code}): {msg}")
        raw = resp.json()
        # API 返回 { code, message, data: { accessToken, refreshToken, user } }
        data = raw.get("data", raw) if isinstance(raw, dict) else raw
        self._set_tokens(data)
        return raw

    def refresh(self) -> dict[str, Any]:
        """
        调用 POST /api/auth/refresh 刷新访问令牌。
        token 有效期 2h，建议 1.9h 时刷新以提升体验。
        """
        if not self._refresh_token:
            return self.login()
        url = f"{self.base_url}/auth/refresh"
        # 常见做法：Body 中传 refreshToken，或 Header Authorization 用 refresh
        refresh_val = self._refresh_token.replace("Bearer ", "") if self._refresh_token else ""
        payload = {"refreshToken": refresh_val}
        resp = self._session.post(url, json=payload, timeout=30)
        if not resp.ok:
            try:
                err = resp.json()
                msg = err.get("message", err.get("data", resp.text)) if isinstance(err, dict) else resp.text[:200]
            except Exception:
                msg = resp.text[:200]
            raise RuntimeError(f"刷新 token 失败 ({resp.status_code}): {msg}")
        raw = resp.json()
        data = raw.get("data", raw) if isinstance(raw, dict) else raw
        self._set_tokens(data)
        return raw

    def get_project_episodes(self, project_id: str) -> list[dict[str, Any]]:
        """
        获取项目下的剧集列表。

        GET /api/projects/{projectId}/episodes

        Args:
            project_id: 项目 UUID

        Returns:
            Episode 数组，每项含 id、title、episodeNumber 等
        """
        self._ensure_token()
        url = f"{self.base_url}/projects/{project_id}/episodes"
        resp = self._session.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        raw = data.get("data", data.get("episodes", [])) if isinstance(data, dict) else data
        if isinstance(raw, list):
            return [x for x in raw if isinstance(x, dict)]
        if isinstance(raw, dict):
            return [x for x in raw.values() if isinstance(x, dict)]
        return []

    def get_projects(self) -> list[dict[str, Any]]:
        """
        获取当前用户可见的项目列表。

        GET {base_url}/projects
        （与 get_project_episodes 一致：base_url 已含平台 API 前缀，如 .../api）

        Returns:
            Project 数组，每项含 id、title、description 等（字段以平台为准）
        """
        self._ensure_token()
        url = f"{self.base_url}/projects"
        resp = self._session.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        raw = data.get("data", data.get("projects", data.get("items", []))) if isinstance(data, dict) else data
        if isinstance(raw, dict) and "items" in raw:
            raw = raw.get("items", [])
        if isinstance(raw, list):
            return [x for x in raw if isinstance(x, dict)]
        if isinstance(raw, dict):
            return [x for x in raw.values() if isinstance(x, dict)]
        return []

    def get_project(self, project_id: str) -> dict[str, Any]:
        """
        获取单个项目详情。

        GET {base_url}/projects/{projectId}

        Args:
            project_id: 项目 UUID

        Returns:
            项目对象 dict；若平台返回 { data: {...} } 则解包 data
        """
        self._ensure_token()
        url = f"{self.base_url}/projects/{project_id}"
        resp = self._session.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict) and "data" in data and isinstance(data["data"], dict):
            return data["data"]
        if isinstance(data, dict):
            return data
        return {}

    def get_shots(self, episode_id: str) -> list[dict[str, Any]]:
        """
        拉取分镜 Shot 列表。

        GET /api/storyboard/episodes/{episodeId}/shots

        Args:
            episode_id: Episode UUID

        Returns:
            Shot 数组，每项含 id、shotNumber、prompts、首帧URL、关联资产等
        """
        self._ensure_token()
        url = f"{self.base_url}/storyboard/episodes/{episode_id}/shots"
        resp = self._session.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        raw = data.get("data", data.get("shots", [])) if isinstance(data, dict) else data
        # API 可能返回 { items: [...], total } 或 { shots: [...] }
        if isinstance(raw, dict) and "items" in raw:
            raw = raw.get("items", [])
        elif isinstance(raw, dict) and not isinstance(raw.get("shots"), type(None)):
            raw = raw.get("shots", raw)
        if isinstance(raw, list):
            return [x for x in raw if isinstance(x, dict)]
        if isinstance(raw, dict):
            return [x for x in raw.values() if isinstance(x, dict)]
        return []

    def get_scenes(self, episode_id: str) -> list[dict[str, Any]]:
        """
        拉取场景列表。

        GET /api/storyboard/episodes/{episodeId}/scenes

        Args:
            episode_id: Episode UUID

        Returns:
            Scene 数组，每项含 sceneId、sceneNumber、title、shots 等
        """
        self._ensure_token()
        url = f"{self.base_url}/storyboard/episodes/{episode_id}/scenes"
        resp = self._session.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        raw = data.get("data", data.get("scenes", [])) if isinstance(data, dict) else data
        # API 可能返回 { scenes: [...], summary } 或 { data: [...] }
        if isinstance(raw, dict) and "scenes" in raw:
            raw = raw.get("scenes", [])
        if isinstance(raw, list):
            return [x for x in raw if isinstance(x, dict)]
        if isinstance(raw, dict):
            return [x for x in raw.values() if isinstance(x, dict)]
        return []

    def get_assets(
        self,
        project_id: str,
        *,
        episode_id: str | None = None,
        page_size: int = 20,
    ) -> list[dict[str, Any]]:
        """
        拉取资产列表。

        优先: GET /api/assets?pageSize=20&page=1&projectId={projectId}
        兼容: GET /api/assets/episode/{episodeId}（若项目接口不存在时）

        Args:
            project_id: 项目 UUID
            episode_id: 可选，按剧集筛选或兜底用
            page_size: 每页条数

        Returns:
            资产数组，每项含 id、name、type、thumbnail、referenceUrls、prompt 等
        """
        self._ensure_token()
        result: list[dict[str, Any]] = []
        page = 1
        while True:
            params: dict[str, Any] = {
                "projectId": project_id,
                "pageSize": page_size,
                "page": page,
            }
            if episode_id:
                params["episodeId"] = episode_id
            url = f"{self.base_url}/assets"
            resp = self._session.get(url, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("data", data)
            items = raw.get("items", raw.get("assets", raw)) if isinstance(raw, dict) else raw
            if isinstance(items, list):
                page_items = [x for x in items if isinstance(x, dict)]
                result.extend(page_items)
                total = raw.get("total", len(result)) if isinstance(raw, dict) else len(result)
                if len(result) >= total or len(page_items) < page_size:
                    break
            else:
                break
            page += 1
        return result

    def refresh_url(self, file_path: str) -> str:
        """
        刷新过期的 COS 文件 URL。

        GET /api/cos/refresh-url?filePath=xxx

        Args:
            file_path: COS 文件路径

        Returns:
            新的可访问 URL
        """
        self._ensure_token()
        url = f"{self.base_url}/cos/refresh-url"
        resp = self._session.get(url, params={"filePath": file_path}, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return data.get("url", data.get("data", "")) or ""

    def download_file(self, url: str, dest: Path) -> Path:
        """
        下载文件到本地。

        Args:
            url: 文件 URL（可能是 COS 签名 URL）
            dest: 目标路径

        Returns:
            保存后的 Path
        """
        dest.parent.mkdir(parents=True, exist_ok=True)
        resp = self._session.get(url, timeout=120, stream=True)
        resp.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        return dest
