# -*- coding: utf-8 -*-
"""
Vidu API 客户端

封装 Vidu 多种能力：
- 图生视频 (i2v)：POST /img2video，详见 docs/vidu/i2v.md
- 电商一键成片 (ad-one-click)：详见 docs/vidu/ad.md
- 视频复刻 (trending-replicate)：详见 docs/vidu/replicate.md
"""

import base64
from pathlib import Path
from typing import Any, Union

# 路径类型：支持 Path 或 str
PathOrStr = Union[Path, str]

import requests


class ViduClient:
    """
    Vidu i2v API 客户端。

    使用方式：
        client = ViduClient(api_key="your_key")
        resp = client.img2video(images=["data:image/png;base64,..."], prompt="...")
    """

    def __init__(self, api_key: str, base_url: str = "https://api.vidu.cn/ent/v2"):
        """
        Args:
            api_key: Vidu API Token
            base_url: API 基础 URL，默认 ent/v2
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Token {api_key}",
            "Content-Type": "application/json",
        })

    def _image_to_base64(self, path: Path) -> str:
        """将本地图片转为 data:image/png;base64,xxx 格式。"""
        data = path.read_bytes()
        b64 = base64.b64encode(data).decode("ascii")
        ext = path.suffix.lower()
        mime = "image/png" if ext == ".png" else "image/jpeg" if ext in (".jpg", ".jpeg") else "image/webp"
        return f"data:{mime};base64,{b64}"

    def img2video(
        self,
        images: list[str],
        prompt: str = "",
        *,
        model: str = "viduq2-pro-fast",
        duration: int = 5,
        resolution: str = "720p",
        audio: bool = False,
        seed: int = 0,
        off_peak: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        提交图生视频任务。

        Args:
            images: 首帧图片，支持 URL 或 data:image/xxx;base64,xxx
            prompt: 文本提示词
            model: 模型名称
            duration: 视频时长（秒）
            resolution: 分辨率
            audio: 是否音视频直出
            seed: 随机种子，0 为随机
            off_peak: 是否错峰
            **kwargs: 其他可选参数（voice_id, callback_url 等）

        Returns:
            API 响应 JSON，含 task_id, state 等
        """
        if len(images) != 1:
            raise ValueError("i2v 仅支持 1 张首帧图")
        url = f"{self.base_url}/img2video"
        payload = {
            "model": model,
            "images": images,
            "prompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "audio": audio,
            "seed": seed,
            "off_peak": off_peak,
            **kwargs,
        }
        # 移除空值
        payload = {k: v for k, v in payload.items() if v is not None and v != ""}
        resp = self._session.post(url, json=payload, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def img2video_from_file(
        self,
        image_path: Path,
        prompt: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        从本地图片文件提交 i2v 任务。

        Args:
            image_path: 首帧图片路径
            prompt: 提示词
            **kwargs: 透传给 img2video
        """
        b64 = self._image_to_base64(image_path)
        return self.img2video(images=[b64], prompt=prompt, **kwargs)

    def query_tasks(self, task_ids: list[str]) -> dict[str, Any]:
        """
        查询任务状态。GET /ent/v2/tasks

        Args:
            task_ids: 任务 ID 列表

        Returns:
            API 响应，含 tasks 数组
        """
        url = f"{self.base_url}/tasks"
        resp = self._session.get(url, params={"task_ids": task_ids}, timeout=30)
        resp.raise_for_status()
        return resp.json()

    # -------------------- 电商一键成片 (ad-one-click) --------------------
    # 详见 docs/vidu/ad.md

    def ad_one_click(
        self,
        images: list[str],
        *,
        prompt: str = "",
        duration: int = 15,
        aspect_ratio: str = "16:9",
        language: str = "zh",
        creative: bool = False,
        callback_url: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        创建电商一键成片任务。POST /ent/v2/ad-one-click

        Args:
            images: 商品图/模特图，1~7 张，支持 URL 或 data:image/xxx;base64,xxx
            prompt: 可选，生成视频的文本描述，最多 2000 字符
            duration: 时长 8~60 秒，默认 15
            aspect_ratio: 输出比例，1:1 | 16:9 | 9:16
            language: 旁白/台词语言，zh | en
            creative: 是否创意成片（false=真实成片，true=创意成片）
            callback_url: 回调地址，任务状态变化时 POST 通知
            **kwargs: 其他可选参数

        Returns:
            task_id, state, images, prompt, duration, aspect_ratio, language, credits
        """
        if not 1 <= len(images) <= 7:
            raise ValueError("ad_one_click 支持 1~7 张图片")
        url = f"{self.base_url}/ad-one-click"
        payload = {
            "images": images,
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "language": language,
            "creative": creative,
            "callback_url": callback_url,
            **kwargs,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        resp = self._session.post(url, json=payload, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def ad_one_click_from_files(
        self,
        image_paths: list[PathOrStr],
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        从本地图片文件列表提交电商一键成片任务。

        Args:
            image_paths: 1~7 个本地图片路径（Path 或 str）
            **kwargs: 透传给 ad_one_click
        """
        if not 1 <= len(image_paths) <= 7:
            raise ValueError("ad_one_click 支持 1~7 张图片")
        images = [self._image_to_base64(Path(p)) for p in image_paths]
        return self.ad_one_click(images=images, **kwargs)

    def ad_one_click_detail(self, task_id: str) -> dict[str, Any]:
        """
        查询一键成片任务的子任务列表。GET /ent/v2/ad-one-click/{id}

        包含：分镜列表(storyboards)、旁白(narration_records)、
        背景音乐(bgm_records)、合成任务(completed_creation_records)。

        Args:
            task_id: 创建任务接口返回的成片任务 id

        Returns:
            id, err_code, state, data_records
        """
        url = f"{self.base_url}/ad-one-click/{task_id}"
        resp = self._session.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def ad_one_click_edit(
        self,
        ad_one_click_task_id: str,
        edit_type: str,
        prompt: str,
        *,
        storyboard_video_index: int | None = None,
        callback_url: str | None = None,
        payload: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        分镜编辑。POST /ent/v2/ad-one-click/edit

        Args:
            ad_one_click_task_id: 一键成片主任务 id
            edit_type: generate_video | generate_narration | generate_bgm
            prompt: 根据 type 含义不同（分镜提示词/旁白文本/BGM 提示词）
            storyboard_video_index: 分镜序号(0 起始)，edit_type=generate_video 时必传
            callback_url: 回调地址
            payload: 透传参数
            **kwargs: 其他可选参数

        Returns:
            ad_one_click_task_id, sub_task_id, state, err_code, credits
        """
        if edit_type == "generate_video" and storyboard_video_index is None:
            raise ValueError("编辑分镜时 storyboard_video_index 必传")
        url = f"{self.base_url}/ad-one-click/edit"
        data = {
            "ad_one_click_task_id": ad_one_click_task_id,
            "type": edit_type,
            "prompt": prompt,
            "storyboard_video_index": storyboard_video_index,
            "callback_url": callback_url,
            "payload": payload,
            **kwargs,
        }
        data = {k: v for k, v in data.items() if v is not None}
        resp = self._session.post(url, json=data, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def ad_one_click_compose(
        self,
        ad_one_click_task_id: str,
        video_task_ids: list[str],
        bgm_task_id: str,
        narration_task_id: str,
        *,
        callback_url: str | None = None,
        payload: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        分镜合成。POST /ent/v2/ad-one-click/compose

        Args:
            ad_one_click_task_id: 一键成片主任务 id
            video_task_ids: 视频任务 id 列表（需与原主任务分镜数量相同）
            bgm_task_id: 背景音乐任务 id
            narration_task_id: 旁白任务 id
            callback_url: 回调地址
            payload: 透传参数
            **kwargs: 其他可选参数

        Returns:
            ad_one_click_task_id, compose_sub_task_id, state, credits
        """
        url = f"{self.base_url}/ad-one-click/compose"
        data = {
            "ad_one_click_task_id": ad_one_click_task_id,
            "video_task_ids": video_task_ids,
            "bgm_task_id": bgm_task_id,
            "narration_task_id": narration_task_id,
            "callback_url": callback_url,
            "payload": payload,
            **kwargs,
        }
        data = {k: v for k, v in data.items() if v is not None}
        resp = self._session.post(url, json=data, timeout=30)
        resp.raise_for_status()
        return resp.json()

    # -------------------- 视频复刻 (trending-replicate) --------------------
    # 详见 docs/vidu/replicate.md

    def trending_replicate(
        self,
        video_url: str,
        images: list[str],
        *,
        prompt: str = "",
        aspect_ratio: str = "16:9",
        resolution: str = "1080p",
        remove_audio: bool = False,
        callback_url: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        创建视频复刻任务。POST /ent/v2/trending-replicate

        用原视频的节奏/运镜，结合商品图生成新视频。

        Args:
            video_url: 需复刻的原视频 URL 或 data:video/mp4;base64,xxx
            images: 商品图/模特图 1~7 张，支持 URL 或 base64
            prompt: 可选，文本描述，最多 2000 字符
            aspect_ratio: 输出比例，1:1 | 16:9 | 9:16 | 4:3 | 3:4
            resolution: 540p | 720p | 1080p
            remove_audio: 是否去除原视频声音
            callback_url: 回调地址
            **kwargs: 其他可选参数

        Returns:
            task_id, state, images, prompt, resolution, aspect_ratio, remove_audio, credits
        """
        if not 1 <= len(images) <= 7:
            raise ValueError("trending_replicate 支持 1~7 张图片")
        url = f"{self.base_url}/trending-replicate"
        payload = {
            "video_url": video_url,
            "images": images,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "remove_audio": remove_audio,
            "callback_url": callback_url,
            **kwargs,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        resp = self._session.post(url, json=payload, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def trending_replicate_from_files(
        self,
        video_path: PathOrStr,
        image_paths: list[PathOrStr],
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        从本地视频和图片文件提交视频复刻任务。

        Args:
            video_path: 原视频路径（mp4/mov），Path 或 str
            image_paths: 1~7 个商品图路径（Path 或 str）
            **kwargs: 透传给 trending_replicate
        """
        if not 1 <= len(image_paths) <= 7:
            raise ValueError("trending_replicate 支持 1~7 张图片")
        # 视频 base64（需按文档格式）
        vp = Path(video_path)
        vid_data = vp.read_bytes()
        vid_b64 = base64.b64encode(vid_data).decode("ascii")
        suffix = vp.suffix.lower()
        mime = "video/mp4" if suffix == ".mp4" else "video/quicktime"
        video_url = f"data:{mime};base64,{vid_b64}"
        images = [self._image_to_base64(Path(p)) for p in image_paths]
        return self.trending_replicate(video_url=video_url, images=images, **kwargs)

    # -------------------- 查询生成物 (成片/分镜/复刻通用) --------------------

    def query_creations(self, task_id: str) -> dict[str, Any]:
        """
        查询任务生成物。GET /ent/v2/tasks/{id}/creations

        适用于：成片、单个分镜、复刻任务等，返回 creations 数组。

        Args:
            task_id: 任务 id（成片 id 或子任务 id）

        Returns:
            id, state, err_code, credits, progress, creations
            creations: [{ id, url, cover_url, watermarked_url }]
        """
        url = f"{self.base_url}/tasks/{task_id}/creations"
        resp = self._session.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()
