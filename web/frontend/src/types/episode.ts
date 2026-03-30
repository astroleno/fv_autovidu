/**
 * FV Studio 核心数据类型定义
 * 基于 episode.json 结构，与后台 API 响应一致
 */

/** Shot 状态：从拉取到选定终版的完整生命周期 */
export type ShotStatus =
  | "pending" // 刚拉取，未开始
  | "endframe_generating" // 尾帧生成中
  | "endframe_done" // 尾帧已生成
  | "video_generating" // 视频生成中
  | "video_done" // 视频已生成（有候选）
  | "selected" // 已选定最终视频
  | "error" // 出错

/** 资产类型：角色/场景/道具 */
export type AssetType = "character" | "location" | "prop" | "other"

/** 视频生成模式 */
export type VideoMode = "first_frame" | "first_last_frame" | "reference"

/** 任务状态（Vidu 侧） */
export type TaskStatus = "pending" | "processing" | "success" | "failed"

/**
 * Shot 关联的资产
 * 用于尾帧生成、单帧重生时作为参考图
 */
export interface ShotAsset {
  assetId: string
  name: string
  type: AssetType
  localPath: string // 本地路径 "assets/达里尔.png"
  prompt: string // 资产描述文本
}

/**
 * 视频候选
 * 同一 Shot 可能有多个候选（不同 seed、模式），用户选定其一
 */
export interface VideoCandidate {
  id: string
  videoPath: string // "videos/S01/v1.mp4"
  thumbnailPath: string
  seed: number
  model: string
  mode: VideoMode
  /** 与 Vidu 请求一致，如 540p / 720p / 1080p */
  resolution?: string
  selected: boolean
  createdAt: string
  taskId: string
  taskStatus: TaskStatus
  /** 低成本预览候选；精出后新候选为 false */
  isPreview?: boolean
  /** 精出来源预览候选 id */
  promotedFrom?: string | null
}

/** 分镜配音状态（与当前 selected 候选绑定） */
export interface DubStatus {
  status: "pending" | "processing" | "completed" | "failed" | "stale"
  sourceCandidateId?: string
  mode?: "sts" | "tts"
  voiceId?: string
  audioPath?: string
  originalAudioPath?: string
  taskId?: string
  error?: string
  processedAt?: string
}

export interface CharacterVoiceBinding {
  voiceId: string
  previewText?: string
  previewAudioPath?: string
  updatedAt?: string
}

/**
 * Feeling 平台结构化对白（与 episode.json / Pydantic AssociatedDialogue 对齐）
 */
export interface AssociatedDialogue {
  /** 说话角色名 */
  role: string
  /** 该角色台词正文 */
  content: string
}

/**
 * Shot：单镜头
 * 包含首帧、尾帧、视频候选、资产、prompt 等完整信息
 */
export interface Shot {
  shotId: string
  shotNumber: number // 全局编号，1-based
  /** 画面描述：平台 visualDescription，简洁场景/动作描述 */
  visualDescription?: string
  imagePrompt: string
  videoPrompt: string
  duration: number // 秒
  cameraMovement: string
  aspectRatio: string // "9:16" / "16:9"
  firstFrame: string // 本地路径 "frames/S01.png"
  assets: ShotAsset[]
  status: ShotStatus
  endFrame: string | null
  videoCandidates: VideoCandidate[]
  dub?: DubStatus
  /** 平台原文台词行（字幕/编剧语言） */
  dialogue?: string
  /** 结构化对白；无有效内容时可省略 */
  associatedDialogue?: AssociatedDialogue | null
  /** 目标语译文，供提示词与 TTS */
  dialogueTranslation?: string
  /** 一期 STS：镜头级音色覆盖；空表示回退剧集默认音色 */
  dubVoiceIdOverride?: string
  /** 角色级 STS：显式指定本镜说话角色对应的资产 id；空表示按 associatedDialogue.role 自动匹配 */
  dubSpeakerAssetId?: string
  /**
   * 生成视频（Vidu）时是否将台词块拼入 composed prompt；默认 true。
   * false 时仍保留台词字段供字幕/配音/剪映，仅不注入 Vidu。
   */
  includeDialogueInVideoPrompt?: boolean
}

/**
 * Scene：场景
 * 一个 Episode 下多个 Scene，每个 Scene 包含多个 Shot
 */
export interface Scene {
  sceneId: string
  sceneNumber: number
  title: string
  shots: Shot[]
}

/**
 * Episode：剧集
 * 从平台拉取后的完整数据，episode.json 根结构
 */
/** 最近一次剪映草稿导出记录 */
export interface JianyingExportRecord {
  lastExportedAt: string
  draftId: string
  zipPath?: string
  draftDirRelative?: string
}

export interface Episode {
  projectId: string
  episodeId: string
  episodeTitle: string
  episodeNumber: number
  pulledAt: string // ISO 8601
  scenes: Scene[]
  /** 剧集级全量资产库，供资产库页面 / RegenPage 使用 */
  assets?: ShotAsset[]
  jianyingExport?: JianyingExportRecord
  /** 一期 STS：剧集级默认音色 */
  dubDefaultVoiceId?: string
  /** 角色资产绑定音色：key = assetId */
  characterVoices?: Record<string, CharacterVoiceBinding>
  /** 配音目标语（BCP-47 或项目约定），空表示未设置 */
  dubTargetLocale?: string
  /** 台词原文语言，供 UI 标签 */
  sourceLocale?: string
}

/**
 * 扁平化 Shot 列表：叙事顺序 = 场景按 sceneNumber 升序 → 每场内 shots 数组顺序。
 * 不可按 shotNumber 全局排序（多场均为 1,2,3 时会乱序）。
 */
export function flattenShots(episode: Episode): Shot[] {
  return [...episode.scenes]
    .sort((a, b) => a.sceneNumber - b.sceneNumber)
    .flatMap((scene) => scene.shots)
}
