/**
 * 项目（Project）相关类型，与后端 web/server/models/schemas.py 对齐
 */

/** 项目列表 / 详情摘要 */
export interface ProjectSummary {
  projectId: string
  title: string
  description: string
  coverImage: string | null
  episodeCount: number
  pulledEpisodeCount: number
  createdAt: string | null
  updatedAt: string | null
}

/** 远端与本地合并后的剧集来源 */
export type ProjectEpisodeSource = "remote_and_local" | "remote_only" | "local_only"

/** 项目详情页中单集行 */
export interface ProjectEpisodeItem {
  episodeId: string
  title: string
  episodeNumber: number
  source: ProjectEpisodeSource
  pulledLocally: boolean
  localProjectId: string | null
  pulledAt: string | null
}

/** GET /projects/:id/episodes */
export interface ProjectEpisodeListResponse {
  project: { projectId: string; title: string }
  episodes: ProjectEpisodeItem[]
}

/** 一键拉取失败项 */
export interface PullProjectFailedItem {
  episodeId: string
  message: string
}

/** POST /projects/:id/pull-all */
export interface PullProjectResponse {
  projectId: string
  requested: number
  successCount: number
  failedCount: number
  failedEpisodes: PullProjectFailedItem[]
}
