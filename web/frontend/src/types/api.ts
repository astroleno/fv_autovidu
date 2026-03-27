/**
 * FV Studio API 请求/响应类型定义
 * 与后台 FastAPI 接口一一对应
 */

import type { TaskStatus } from "./episode"

/** 拉取 Episode 请求体 */
export interface PullEpisodeRequest {
  episodeId: string
  /** 项目 ID，拉资产必需；剧集页拉取时可自动带上传入 */
  projectId?: string
  /** 强制覆盖本地已有首帧与资产文件 */
  forceRedownload?: boolean
  /** 兼容：为 true 时首帧与资产图均不下载，只写 episode.json */
  skipImages?: boolean
  /** 不下载首帧图（与 skipAssets 可组合） */
  skipFrames?: boolean
  /** 不下载资产图（与 skipFrames 可组合） */
  skipAssets?: boolean
}

/** 批量生成尾帧请求体 */
export interface GenerateEndframeRequest {
  episodeId: string
  shotIds: string[]
}

/** 单条尾帧任务（兼容旧版单任务响应可单独使用 taskId/shotId） */
export interface EndframeTaskItem {
  taskId: string
  shotId: string
}

/** 批量生成尾帧响应 */
export interface BatchEndframeResponse {
  tasks: EndframeTaskItem[]
}

/** 生成尾帧响应 */
export interface GenerateEndframeResponse {
  taskId: string
  shotId: string
}

/** 批量生成视频请求体 */
export interface GenerateVideoRequest {
  episodeId: string
  shotIds: string[]
  mode: "first_frame" | "first_last_frame" | "reference"
  model?: string
  duration?: number
  resolution?: string
  /** 多参考图模式：限定使用的资产 id；不传则使用各 shot 下全部可用资产图 */
  referenceAssetIds?: string[]
  /** 0 或未传表示随机 */
  seed?: number
  /** 每镜头提交次数；仅 isPreview=true 时后端允许多于 1 */
  candidateCount?: number
  isPreview?: boolean
}

/** 锁种精出：单镜头项 */
export interface PromoteVideoItem {
  shotId: string
  candidateId: string
}

/** 基于预览候选 seed 发起精出 */
export interface PromoteVideoRequest {
  episodeId: string
  items: PromoteVideoItem[]
  model?: string
  resolution?: string
}

/** 生成视频响应 */
export interface GenerateVideoResponse {
  tasks: Array<{ taskId: string; shotId: string }>
}

/** 单帧重生请求体 */
export interface RegenFrameRequest {
  episodeId: string
  shotId: string
  imagePrompt: string
  assetIds: string[]
}

/** 单帧重生响应 */
export interface RegenFrameResponse {
  taskId: string
  shotId: string
  newFramePath: string
}

/** 选定候选视频请求体 */
export interface SelectCandidateRequest {
  candidateId: string
}

/** 导出粗剪请求体 */
export interface ExportRoughCutRequest {
  episodeId: string
  shotIds?: string[]
}

/** 导出粗剪响应 */
export interface ExportRoughCutResponse {
  exportPath: string
}

/** 剪映草稿导出请求（必填 draftPath；不生成 ZIP） */
export interface JianyingExportRequest {
  episodeId: string
  shotIds?: string[]
  draftPath: string
  /** 默认由服务端设为 1080p；一般无需传 */
  canvasSize?: "720p" | "1080p"
}

/** 剪映草稿导出响应 */
export interface JianyingExportResponse {
  draftId: string
  draftDir: string
  zipPath?: string | null
  /** 填写了 draftPath 时：复制到剪映目录后的草稿文件夹绝对路径 */
  jianyingCopyPath?: string | null
  exportedShots: number
  missingShots: string[]
  exportedAt: string
}

/** GET /export/jianying-draft/path */
export interface JianyingDraftPathResponse {
  detectedPath: string | null
  candidates: string[]
}

/** 配音：批量处理请求 */
export interface DubProcessRequest {
  episodeId: string
  shotIds?: string[]
  voiceId: string
  mode?: "sts" | "tts"
  concurrency?: number
}

/** 配音：单镜头请求 */
export interface DubProcessShotRequest {
  episodeId: string
  shotId: string
  voiceId: string
  mode?: "sts" | "tts"
  ttsText?: string
}

export interface DubTaskItem {
  taskId: string
  shotId: string
}

export interface DubProcessResponse {
  tasks: DubTaskItem[]
}

/** 任务状态响应 */
export interface TaskStatusResponse {
  taskId: string
  status: TaskStatus
  progress?: number
  result?: Record<string, unknown>
  error?: string
}
