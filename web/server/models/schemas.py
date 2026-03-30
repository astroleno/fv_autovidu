# -*- coding: utf-8 -*-
"""
Pydantic 数据模型

与前端 web/frontend/src/types/episode.ts 和 api.ts 精确对齐，
确保 API 请求/响应 JSON 结构与前端 TypeScript 类型一致。
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

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
    # 与 Vidu 请求一致，如 540p / 720p / 1080p；便于前端展示与精出对比
    resolution: str = ""
    selected: bool = False
    createdAt: str = ""
    taskId: str = ""
    taskStatus: TaskStatus = "pending"
    # 预览阶段生成的低成本候选；精出后新候选 isPreview=False
    isPreview: bool = False
    # 精出候选记录来源预览候选 id，便于追溯
    promotedFrom: Optional[str] = None


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


class CharacterVoiceBinding(BaseModel):
    """角色资产绑定的音色信息。键由 Episode.characterVoices 的 assetId 承载。"""

    voiceId: str = ""
    previewText: str = ""
    previewAudioPath: str = ""
    updatedAt: str = ""


class AssociatedDialogue(BaseModel):
    """
    Feeling 平台结构化对白（与 JSON 键 associatedDialogue 对齐）。

    role: 说话角色名；content: 该角色台词正文。与顶层 dialogue 字符串可同时存在，
    用于字幕展示或从结构化数据拼接展示行。
    """

    role: str = ""
    content: str = ""


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
    # --- 台词与本地化（与 puller / episode.json / 前端 Shot 一致）---
    # 平台原文台词行（字幕、编剧语言）
    dialogue: str = ""
    # 结构化对白；无有效 role/content 时 JSON 中省略或为 null
    associatedDialogue: Optional[AssociatedDialogue] = None
    # 目标语译文，供 Vidu 提示词拼接与 TTS；拉取时为空，由 Web 编辑
    dialogueTranslation: str = ""
    # 一期 STS：镜头级音色覆盖；空表示回退 Episode.dubDefaultVoiceId
    dubVoiceIdOverride: str = ""
    # 角色级 STS：显式指定本镜说话角色对应的资产 id；空表示按 associatedDialogue.role 自动匹配资产名
    dubSpeakerAssetId: str = ""
    # 生成视频（Vidu）时是否将台词块拼入 composed prompt；默认 True；False 时仍保留 dialogue 供字幕/配音/剪映
    includeDialogueInVideoPrompt: bool = True


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
    # 一期 STS：剧集级默认音色；空表示尚未设置
    dubDefaultVoiceId: str = ""
    # 角色资产绑定音色：key = assetId
    characterVoices: dict[str, CharacterVoiceBinding] = Field(default_factory=dict)
    # 配音/本地化：目标语 BCP-47 或项目约定（如 en-US、ja）；空表示未设置
    dubTargetLocale: str = ""
    # 台词原文语言标签，供 UI 展示
    sourceLocale: str = ""


# ---------- API 请求/响应（api.ts） ----------


class PullEpisodeRequest(BaseModel):
    """拉取 Episode 请求。"""

    episodeId: str
    projectId: Optional[str] = None  # 可选，拉资产需正确 projectId；缺省时从本地已存在剧集推断
    forceRedownload: bool = False  # 强制覆盖本地已有首帧/资产图
    # 兼容：为 True 时首帧与资产图均不下载（仅写 episode.json）
    skipImages: bool = False
    # 分别控制首帧与资产图；若 skipImages=True 则二者均视为 True
    skipFrames: bool = False
    skipAssets: bool = False


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


class CancelEndframesRequest(BaseModel):
    """取消进行中的尾帧生成任务；可选按剧集过滤。"""

    episodeId: Optional[str] = None


class CancelEndframesResponse(BaseModel):
    cancelled: int
    taskIds: list[str] = Field(default_factory=list)


class GenerateVideoRequest(BaseModel):
    """批量生成视频请求。"""

    episodeId: str
    shotIds: list[str]
    mode: VideoMode = "first_frame"
    model: Optional[str] = None
    duration: Optional[int] = None
    resolution: Optional[str] = None
    referenceAssetIds: Optional[list[str]] = None
    # 0 或 None 表示随机；透传 Vidu
    seed: Optional[int] = None
    # 每镜头提交次数；仅 isPreview=True 时允许 >1（见路由层强制）
    candidateCount: int = 1
    isPreview: bool = False


class GenerateVideoResponse(BaseModel):
    """生成视频响应。"""

    tasks: list[dict[str, str]] = Field(default_factory=list)


class PromoteVideoItem(BaseModel):
    """锁种精出：单镜头 + 指定预览候选 id。"""

    shotId: str
    candidateId: str


class PromoteVideoRequest(BaseModel):
    """基于预览候选 seed 发起更高分辨率/精出模型。"""

    episodeId: str
    items: list[PromoteVideoItem]
    model: str = "viduq3-pro"
    resolution: str = "1080p"


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


JianyingSubtitleAlign = Literal["left", "center", "right"]


class JianyingExportRequest(BaseModel):
    """
    剪映草稿导出请求。

    仅支持将草稿目录复制到本机剪映草稿根（draftPath）；**不再生成 ZIP**（与「导出到剪映」语义重复）。
    若需「打包下载全部素材」应另做独立导出能力，不在本接口混用。
    """

    episodeId: str
    shotIds: Optional[list[str]] = None
    draftPath: str
    # 写入 draft_info.json 的 canvas_config；默认 1080p，前端不提供切换
    canvasSize: str = "1080p"  # 720p | 1080p
    # 字幕轨 v1：与 pyJianYingDraft TextStyle / ClipSettings 对齐（见 jianying_text_track）
    subtitleFontSize: int = Field(default=8, ge=4, le=16)
    subtitleAlign: JianyingSubtitleAlign = "center"
    subtitleAutoWrapping: bool = True
    subtitleTransformY: float = Field(default=-0.8, ge=-1.0, le=0.0)

    @field_validator("draftPath")
    @classmethod
    def _draft_path_strip(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("draftPath 不能为空")
        return s

    @field_validator("canvasSize")
    @classmethod
    def _canvas_size_literal(cls, v: str) -> str:
        if v not in ("720p", "1080p"):
            raise ValueError("canvasSize 须为 720p 或 1080p")
        return v


class JianyingExportResponse(BaseModel):
    """剪映草稿导出响应。"""

    draftId: str
    draftDir: str
    zipPath: Optional[str] = None
    # 当请求带 draftPath 时：复制到剪映目录后的草稿文件夹绝对路径（draftPath/draftId）
    jianyingCopyPath: Optional[str] = None
    exportedShots: int
    missingShots: list[str] = Field(default_factory=list)
    exportedAt: str


class DubProcessRequest(BaseModel):
    """批量配音请求。"""

    episodeId: str
    shotIds: Optional[list[str]] = None
    mode: str = "sts"  # sts | tts
    concurrency: int = 2


class DubProcessShotRequest(BaseModel):
    """单镜头配音请求。"""

    episodeId: str
    shotId: str
    voiceId: str = Field(
        default="",
        description="可选；空则完全由 Episode/Shot 持久化字段解析（与批量接口一致）",
    )
    mode: str = "sts"
    ttsText: Optional[str] = None  # mode=tts 时使用；缺省可用 shot.videoPrompt


class DubTaskItem(BaseModel):
    """配音任务列表中的一项。"""

    taskId: str
    shotId: str


class DubProcessResponse(BaseModel):
    """批量配音响应：每个分镜独立 taskId，供现有任务轮询使用。"""

    tasks: list[DubTaskItem] = Field(default_factory=list)


class AssetVoicePreviewRequest(BaseModel):
    """生成并持久化角色资产的试听音频。"""

    episodeId: str
    assetId: str
    voiceId: str = ""
    previewText: str = ""


class AssetVoicePreviewResponse(BaseModel):
    """角色资产试听生成结果。"""

    assetId: str
    voiceId: str
    previewText: str
    audioPath: str


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
    createdAt: Optional[float] = None
    updatedAt: Optional[float] = None
    completedAt: Optional[float] = None


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
