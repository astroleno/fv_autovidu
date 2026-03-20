# -*- coding: utf-8 -*-
"""
Pydantic 数据模型

与前端 web/frontend/src/types/episode.ts 和 api.ts 精确对齐，
确保 API 请求/响应 JSON 结构与前端 TypeScript 类型一致。
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# ---------- 枚举 / 字面量类型 ----------

ShotStatus = Literal[
    "pending",
    "endframe_generating",
    "endframe_done",
    "video_generating",
    "video_done",
    "selected",
    "error",
]

AssetType = Literal["character", "location", "prop", "other"]

VideoMode = Literal["first_frame", "first_last_frame", "reference"]

TaskStatus = Literal["pending", "processing", "success", "failed"]


# ---------- Episode 相关（episode.ts） ----------


class ShotAsset(BaseModel):
    """Shot 关联的资产。"""

    assetId: str
    name: str
    type: AssetType = "other"
    localPath: str
    prompt: str = ""


class VideoCandidate(BaseModel):
    """视频候选。"""

    id: str
    videoPath: str
    thumbnailPath: str = ""
    seed: int = 0
    model: str = ""
    mode: VideoMode = "first_frame"
    selected: bool = False
    createdAt: str = ""
    taskId: str = ""
    taskStatus: TaskStatus = "pending"


class Shot(BaseModel):
    """单镜头。"""

    shotId: str
    shotNumber: int
    visualDescription: str = ""  # 画面描述，平台 visualDescription
    imagePrompt: str
    videoPrompt: str
    duration: int = 5
    cameraMovement: str = "push_in"
    aspectRatio: str = "9:16"
    firstFrame: str
    assets: list[ShotAsset] = Field(default_factory=list)
    status: ShotStatus = "pending"
    # 使用 Optional 而非 str | None，兼容 Python 3.9 + Pydantic 对注解的解析
    endFrame: Optional[str] = None
    videoCandidates: list[VideoCandidate] = Field(default_factory=list)


class Scene(BaseModel):
    """场景。"""

    sceneId: str
    sceneNumber: int
    title: str
    shots: list[Shot] = Field(default_factory=list)


class Episode(BaseModel):
    """剧集，episode.json 根结构。"""

    projectId: str
    episodeId: str
    episodeTitle: str
    episodeNumber: int
    pulledAt: str
    scenes: list[Scene] = Field(default_factory=list)
    # 剧集级全量资产库（供资产库页面 / RegenPage 展示），拉取时由 puller 填入
    assets: list[ShotAsset] = Field(default_factory=list)


# ---------- API 请求/响应（api.ts） ----------


class PullEpisodeRequest(BaseModel):
    """拉取 Episode 请求。"""

    episodeId: str
    projectId: Optional[str] = None  # 可选，拉资产需正确 projectId；缺省时从本地已存在剧集推断
    forceRedownload: bool = False  # 强制重新下载资产图（修复拉成风格图时使用）
    # True：不下载首帧/资产图，只写 episode.json（画面描述、提示词等仍从平台拉取）
    skipImages: bool = False


class GenerateEndframeRequest(BaseModel):
    """批量生成尾帧请求。"""

    episodeId: str
    shotIds: list[str]


class GenerateEndframeResponse(BaseModel):
    """生成尾帧响应。"""

    taskId: str
    shotId: str


class GenerateVideoRequest(BaseModel):
    """批量生成视频请求。"""

    episodeId: str
    shotIds: list[str]
    mode: VideoMode = "first_frame"
    model: Optional[str] = None
    duration: Optional[int] = None


class GenerateVideoResponse(BaseModel):
    """生成视频响应。"""

    tasks: list[dict[str, str]] = Field(default_factory=list)


class RegenFrameRequest(BaseModel):
    """单帧重生请求。"""

    episodeId: str
    shotId: str
    imagePrompt: str
    assetIds: list[str] = Field(default_factory=list)


class RegenFrameResponse(BaseModel):
    """单帧重生响应。"""

    taskId: str
    shotId: str
    newFramePath: str


class SelectCandidateRequest(BaseModel):
    """选定候选视频请求。"""

    candidateId: str


class ExportRoughCutRequest(BaseModel):
    """导出粗剪请求。"""

    episodeId: str
    shotIds: Optional[list[str]] = None


class ExportRoughCutResponse(BaseModel):
    """导出粗剪响应。"""

    exportPath: str


class TaskStatusResponse(BaseModel):
    """任务状态响应。"""

    taskId: str
    status: TaskStatus
    progress: Optional[int] = None
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None
