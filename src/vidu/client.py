# -*- coding: utf-8 -*-
"""
Vidu API 客户端

封装 Vidu 多种能力：
- 图生视频 (i2v)：POST /img2video，详见 docs/vidu/i2v.md
- 首尾帧生视频 (start-end2video)：POST /start-end2video，见官方「Start end to Video」
  - 恰好 2 张图：首帧、尾帧；模型含 viduq3-turbo / viduq3-pro / viduq2-* 等
- 参考生视频 (reference2video)：POST /reference2video，详见 docs/vidu/reference.md
  - 主体调用：支持多主体 + 台词（音视频直出）
  - 非主体调用：多图参考（1~7 张），与首尾帧专用接口不同，勿混用
- 电商一键成片 (ad-one-click)：详见 docs/vidu/ad.md
- 视频复刻 (trending-replicate)：详见 docs/vidu/replicate.md
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Union

# 路径类型：支持 Path 或 str
PathOrStr = Union[Path, str]

import requests

from src.utils.retry import run_with_http_retry


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
        audio: bool = True,
        # audio 为 True 时写入请求体；见 docs/vidu/i2v.md：all / speech_only / sound_effect_only
        audio_type: str = "speech_only",
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
            audio: 是否音视频直出（默认 True）
            audio_type: 音视频直出时的音频类型；默认仅人声、不要额外音效
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
        # 官方：audio 为 true 时可传 audio_type；默认仅人声，不叠加环境音效
        if audio:
            payload["audio_type"] = audio_type
        # 移除空值
        payload = {k: v for k, v in payload.items() if v is not None and v != ""}
        # 提交型 POST 不做盲重试：超时/断线时服务端可能已创建任务，重试会导致重复计费与重复成片
        resp = self._session.post(url, json=payload, timeout=30)
        resp.raise_for_status()
        return resp.json()

    # -------------------- 首尾帧生视频 (start-end2video) --------------------
    # 官方文档：https://platform.vidu.com/docs/start-end-to-video
    # POST {base_url}/start-end2video ，与 reference2video 为不同接口；首尾帧应走本方法。

    def start_end2video(
        self,
        images: list[str],
        prompt: str = "",
        *,
        model: str = "viduq3-turbo",
        duration: int = 5,
        resolution: str = "720p",
        seed: int = 0,
        bgm: bool = False,
        # 默认音视频直出；仅需画面时显式传 audio=False（q3 写入 payload）
        audio: bool = True,
        # 与 img2video 一致：q3 直出时仅人声，不传则服务端等价于 all（含音效）
        audio_type: str = "speech_only",
        is_rec: bool | None = None,
        movement_amplitude: str | None = None,
        off_peak: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        首尾帧图生视频：首帧 + 尾帧各一张，走专用接口 start-end2video。

        Args:
            images: 恰好 2 张，顺序为 [首帧, 尾帧]，URL 或 data:image/...;base64,...
            prompt: 可选，最多约 5000 字
            model: 见官方文档 Accepted values（如 viduq3-turbo、viduq3-pro、viduq2-pro 等）
            duration: 秒，范围依模型而定
            resolution: 如 720p、1080p
            seed: 随机种子，0 表示由服务端处理（与 i2v 行为对齐）
            bgm: 是否加 BGM（q3 上部分时长可能不生效，见文档）
            audio: 是否音视频直出（默认 True）；仅 q3 系列写入 payload，非 q3 时不发送
            audio_type: q3 且 audio 为 True 时写入，控制人声 / 音效 / 二者
            is_rec: 是否使用推荐提示词
            movement_amplitude: auto | small | medium | large（q2/q3 上部分参数不生效）
            off_peak: 错峰
            **kwargs: 如 callback_url、payload 等

        Returns:
            task_id、state、model、images、...（与创建类接口一致）
        """
        if len(images) != 2:
            raise ValueError("start-end2video 需要恰好 2 张图：[首帧, 尾帧]")
        url = f"{self.base_url}/start-end2video"
        payload: dict[str, Any] = {
            "model": model,
            "images": images,
            "prompt": prompt[:5000],
            "duration": duration,
            "resolution": resolution,
            "seed": seed,
            "bgm": bgm,
            "off_peak": off_peak,
            **kwargs,
        }
        # 文档：audio 仅 q3 支持；向 q2/q1 传 true 可能导致 400
        if (model or "").startswith("viduq3"):
            payload["audio"] = audio
            if audio:
                payload["audio_type"] = audio_type
        if is_rec is not None:
            payload["is_rec"] = is_rec
        if movement_amplitude:
            payload["movement_amplitude"] = movement_amplitude
        # 保留 False（如 bgm/off_peak）；仅去掉 None，避免误删布尔假值
        payload = {k: v for k, v in payload.items() if v is not None}
        # 双图 data:image;base64,... 的 JSON 可达数 MB，TLS 发送阶段易触发 write timeout（原 60s 不足）。
        # 使用单一秒数：对 connect + 上传 + 读响应统一放宽，避免慢网上传未完成即被断开。
        resp = self._session.post(url, json=payload, timeout=300)
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

    # -------------------- 参考生视频 (reference2video) --------------------
    # 详见 docs/vidu/reference.md

    def reference2video_with_subjects(
        self,
        subjects: list[dict[str, Any]],
        prompt: str,
        *,
        model: str = "viduq2",
        duration: int = 5,
        audio: bool = False,
        audio_type: str = "speech_only",
        resolution: str = "720p",
        aspect_ratio: str = "16:9",
        seed: int = 0,
        off_peak: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        参考生视频 - 主体调用（支持音视频直出/台词）。

        指定 1-7 个主体，每个主体有 id、images(1-3 张)、可选 voice_id。
        prompt 中通过 @id 引用主体，可用「旁白音说XXX」加入台词。
        注意：viduq2-pro 不支持主体调用，需用 viduq2/viduq1/vidu2.0。

        Args:
            subjects: 主体列表 [{"id": str, "images": [url/base64], "voice_id": ""}, ...]
            prompt: 提示词，含 @id 与可选「旁白音说XXX」
            model: viduq2 | viduq1 | vidu2.0（不支持 viduq2-pro）
            duration: 时长（秒）
            audio: 是否音视频直出（含台词）
            audio_type: all | speech_only | sound_effect_only（默认 speech_only，仅人声）
            **kwargs: 其他参数

        Returns:
            task_id, state, model, prompt, duration, seed, ...
        """
        if not 1 <= len(subjects) <= 7:
            raise ValueError("主体调用支持 1-7 个主体")
        url = f"{self.base_url}/reference2video"
        payload = {
            "model": model,
            "subjects": subjects,
            "prompt": prompt[:5000],
            "duration": duration,
            "audio": audio,
            "audio_type": audio_type if audio else None,
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
            "seed": seed,
            "off_peak": off_peak,
            **kwargs,
        }
        payload = {k: v for k, v in payload.items() if v is not None and v != ""}
        resp = self._session.post(url, json=payload, timeout=60)
        resp.raise_for_status()
        return resp.json()

    def reference2video_with_images(
        self,
        images: list[str],
        prompt: str,
        *,
        model: str = "viduq2-pro",
        duration: int = 5,
        bgm: bool = False,
        resolution: str = "720p",
        aspect_ratio: str = "16:9",
        seed: int = 0,
        videos: list[str] | None = None,
        off_peak: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        参考生视频 - 非主体调用（视频直出，无台词）。

        传入 1-7 张参考图（或 URL/base64），模型依此生成主体一致视频。
        viduq2-pro 支持视频参考（videos 参数）。

        Args:
            images: 参考图片，1-7 张 URL 或 base64
            prompt: 文本提示词
            model: viduq2-pro | viduq2 | viduq1 | vidu2.0
            duration: 时长（秒）
            bgm: 是否添加背景音乐
            videos: 视频参考（仅 viduq2-pro）
            **kwargs: 其他参数

        Returns:
            task_id, state, model, prompt, images, duration, ...
        """
        if not 1 <= len(images) <= 7:
            raise ValueError("非主体调用支持 1-7 张参考图")
        url = f"{self.base_url}/reference2video"
        payload = {
            "model": model,
            "images": images,
            "prompt": prompt[:5000],
            "duration": duration,
            "bgm": bgm,
            "resolution": resolution,
            "aspect_ratio": aspect_ratio,
            "seed": seed,
            "videos": videos,
            "off_peak": off_peak,
            **kwargs,
        }
        # 去掉值为 None 的键；videos 为 None 时此处已不会含 "videos"，不可再 del（否则 KeyError）
        payload = {k: v for k, v in payload.items() if v is not None}
        resp = self._session.post(url, json=payload, timeout=60)
        resp.raise_for_status()
        return resp.json()

    def reference2video_from_files(
        self,
        image_paths: list[PathOrStr],
        prompt: str,
        *,
        use_subjects: bool = False,
        dialogue: str | None = None,
        subject_ids: list[str] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        从本地图片文件提交参考生视频任务。

        Args:
            image_paths: 1-7 个图片路径，首张可作为参考首帧
            prompt: 视频描述提示词
            use_subjects: True=主体调用（可含台词），False=非主体调用
            dialogue: 台词文本，仅 use_subjects 时生效，会追加「旁白音说{dialogue}」
            subject_ids: 主体 id 列表，仅 use_subjects 时生效，长度需与 image_paths 一致
            **kwargs: 透传给 reference2video_with_subjects 或 reference2video_with_images

        Returns:
            API 响应
        """
        if not 1 <= len(image_paths) <= 7:
            raise ValueError("支持 1-7 张图片")
        b64_list = [self._image_to_base64(Path(p)) for p in image_paths]
        if use_subjects:
            ids = subject_ids or [str(i + 1) for i in range(len(image_paths))]
            if len(ids) != len(image_paths):
                raise ValueError("subject_ids 长度需与 image_paths 一致")
            subjects = [
                {"id": sid, "images": [b64], "voice_id": ""}
                for sid, b64 in zip(ids, b64_list)
            ]
            full_prompt = prompt
            if dialogue:
                full_prompt = f"{prompt}，并且旁白音说{dialogue}" if prompt else f"旁白音说{dialogue}"
            return self.reference2video_with_subjects(
                subjects=subjects,
                prompt=full_prompt,
                audio=bool(dialogue),
                **kwargs,
            )
        # 非主体调用不支持台词，仅使用视频描述
        return self.reference2video_with_images(
            images=b64_list,
            prompt=prompt,
            **kwargs,
        )

    def query_tasks(self, task_ids: list[str]) -> dict[str, Any]:
        """
        查询任务状态。GET /ent/v2/tasks

        Args:
            task_ids: 任务 ID 列表

        Returns:
            API 响应，含 tasks 数组
        """
        url = f"{self.base_url}/tasks"

        def _get() -> dict:
            r = self._session.get(url, params={"task_ids": task_ids}, timeout=30)
            r.raise_for_status()
            return r.json()

        # 查询 GET 可安全重试：不创建新任务，仅拉状态
        return run_with_http_retry(_get)

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
