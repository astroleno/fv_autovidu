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
  /** 强制重新下载资产图（修复拉成风格图时使用） */
  forceRedownload?: boolean
}

/** 批量生成尾帧请求体 */
export interface GenerateEndframeRequest {
  episodeId: string
  shotIds: string[]
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

/** 任务状态响应 */
export interface TaskStatusResponse {
  taskId: string
  status: TaskStatus
  progress?: number
  result?: Record<string, unknown>
  error?: string
}
