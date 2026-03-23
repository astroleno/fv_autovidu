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


class DubStatus(BaseModel):
    """
    分镜配音状态（仅针对当前 selected 候选；切换候选后需重新配音）。

    status: pending | processing | completed | failed | stale（与 sourceCandidateId 不一致时由前端或后端标记）
    """

    status: str = "pending"
    sourceCandidateId: Optional[str] = None
    mode: Optional[str] = None  # sts | tts
    voiceId: Optional[str] = None
    audioPath: Optional[str] = None
    originalAudioPath: Optional[str] = None
    taskId: Optional[str] = None
    error: Optional[str] = None
    processedAt: Optional[str] = None


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
    dub: Optional[DubStatus] = None


class JianyingExportRecord(BaseModel):
    """剧集级最近一次剪映草稿导出记录（非分镜级状态）。"""

    lastExportedAt: str
    draftId: str
    zipPath: Optional[str] = None
    draftDirRelative: Optional[str] = None


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
    jianyingExport: Optional[JianyingExportRecord] = None


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
    """生成尾帧响应（单条任务，兼容旧客户端）。"""

    taskId: str
    shotId: str


class EndframeTaskItem(BaseModel):
    """批量尾帧任务中的一项。"""

    taskId: str
    shotId: str


class BatchEndframeResponse(BaseModel):
    """批量生成尾帧响应：每个 shot 对应独立 taskId。"""

    tasks: list[EndframeTaskItem]


class GenerateVideoRequest(BaseModel):
    """批量生成视频请求。"""

    episodeId: str
    shotIds: list[str]
    mode: VideoMode = "first_frame"
    model: Optional[str] = None
    duration: Optional[int] = None
    resolution: Optional[str] = None
    referenceAssetIds: Optional[list[str]] = None


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


class JianyingExportRequest(BaseModel):
    """剪映草稿导出请求。"""

    episodeId: str
    shotIds: Optional[list[str]] = None
    draftPath: Optional[str] = None
    createZip: bool = True
    canvasSize: str = "720p"  # 720p | 1080p


class JianyingExportResponse(BaseModel):
    """剪映草稿导出响应。"""

    draftId: str
    draftDir: str
    zipPath: Optional[str] = None
    exportedShots: int
    missingShots: list[str] = Field(default_factory=list)
    exportedAt: str


class DubProcessRequest(BaseModel):
    """批量配音请求。"""

    episodeId: str
    shotIds: Optional[list[str]] = None
    voiceId: str
    mode: str = "sts"  # sts | tts
    concurrency: int = 2


class DubProcessShotRequest(BaseModel):
    """单镜头配音请求。"""

    episodeId: str
    shotId: str
    voiceId: str
    mode: str = "sts"
    ttsText: Optional[str] = None  # mode=tts 时使用；缺省可用 shot.videoPrompt


class DubTaskItem(BaseModel):
    """配音任务列表中的一项。"""

    taskId: str
    shotId: str


class DubProcessResponse(BaseModel):
    """批量配音响应：每个分镜独立 taskId，供现有任务轮询使用。"""

    tasks: list[DubTaskItem] = Field(default_factory=list)


class DubEpisodeStatusResponse(BaseModel):
    """按剧集查询各分镜配音状态。"""

    episodeId: str
    shots: list[dict[str, Any]] = Field(default_factory=list)


class TaskStatusResponse(BaseModel):
    """任务状态响应。"""

    taskId: str
    status: TaskStatus
    progress: Optional[int] = None
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None


# ---------- 项目（Project）相关：与前端 types/project.ts 对齐 ----------


class ProjectSummary(BaseModel):
    """项目列表项：平台信息 + 本地已拉取剧集数。"""

    projectId: str
    title: str = ""
    description: str = ""
    coverImage: Optional[str] = None
    episodeCount: int = 0
    pulledEpisodeCount: int = 0
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class ProjectDetail(BaseModel):
    """单项目详情（与 ProjectSummary 字段一致，便于复用）。"""

    projectId: str
    title: str = ""
    description: str = ""
    coverImage: Optional[str] = None
    episodeCount: int = 0
    pulledEpisodeCount: int = 0
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


ProjectEpisodeSource = Literal["remote_and_local", "remote_only", "local_only"]


class ProjectEpisodeItem(BaseModel):
    """远端与本地合并后的单集条目。"""

    episodeId: str
    title: str = ""
    episodeNumber: int = 0
    source: ProjectEpisodeSource = "remote_only"
    pulledLocally: bool = False
    localProjectId: Optional[str] = None
    pulledAt: Optional[str] = None


class ProjectEpisodeListResponse(BaseModel):
    """项目详情页：项目头 + 剧集列表。"""

    project: dict[str, Any] = Field(default_factory=dict)
    episodes: list[ProjectEpisodeItem] = Field(default_factory=list)


class PullProjectFailedItem(BaseModel):
    """一键拉取失败的一集。"""

    episodeId: str
    message: str = ""


class PullProjectResponse(BaseModel):
    """POST /projects/{id}/pull-all 响应。"""

    projectId: str
    requested: int = 0
    successCount: int = 0
    failedCount: int = 0
    failedEpisodes: list[PullProjectFailedItem] = Field(default_factory=list)
