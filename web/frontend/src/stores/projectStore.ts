/**
 * 项目 Store：平台项目列表、当前项目详情页剧集合并列表
 *
 * 列表与详情使用独立的 loading / error，避免进入项目详情时清掉首页错误、或互相覆盖。
 * projectEpisodesForProjectId 与路由 projectId 一致时才展示剧集数据，避免切换项目时串台。
 */
import { create } from "zustand"
import type { ProjectEpisodeListResponse, ProjectSummary } from "@/types/project"
import { projectsApi } from "@/api/projects"

/** 详情接口失败时记录所属项目，便于与当前路由比对 */
export interface ProjectDetailError {
  projectId: string
  message: string
}

interface ProjectStore {
  projects: ProjectSummary[]
  projectsLoading: boolean
  projectsError: string | null

  /** 当前项目详情页的剧集数据（含 project 头） */
  projectEpisodes: ProjectEpisodeListResponse | null
  /** 与 projectEpisodes 对应的项目 ID；与 URL 中 projectId 不一致时不展示内容，防止切换路由时短暂显示上一项目 */
  projectEpisodesForProjectId: string | null
  projectEpisodesLoading: boolean
  /** 最近一次项目详情接口失败（按 projectId 作用域在页面内判断） */
  projectDetailError: ProjectDetailError | null

  fetchProjects: () => Promise<void>
  fetchProjectEpisodes: (projectId: string) => Promise<void>
  clearProjectEpisodes: () => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  projectsLoading: false,
  projectsError: null,

  projectEpisodes: null,
  projectEpisodesForProjectId: null,
  projectEpisodesLoading: false,
  projectDetailError: null,

  fetchProjects: async () => {
    set({ projectsLoading: true, projectsError: null })
    try {
      const res = await projectsApi.list()
      set({ projects: res.data })
    } catch (e) {
      set({
        projectsError: e instanceof Error ? e.message : "加载项目列表失败",
        /** 失败时不保留旧列表，避免与「暂无项目」混淆；重试成功后再展示 */
        projects: [],
      })
    } finally {
      set({ projectsLoading: false })
    }
  },

  fetchProjectEpisodes: async (projectId: string) => {
    set({
      projectEpisodesLoading: true,
      projectDetailError: null,
      projectEpisodes: null,
      projectEpisodesForProjectId: null,
    })
    try {
      const res = await projectsApi.episodes(projectId)
      set({
        projectEpisodes: res.data,
        projectEpisodesForProjectId: projectId,
        projectEpisodesLoading: false,
      })
    } catch (e) {
      set({
        projectEpisodes: null,
        projectEpisodesForProjectId: null,
        projectEpisodesLoading: false,
        projectDetailError: {
          projectId,
          message: e instanceof Error ? e.message : "加载剧集列表失败",
        },
      })
    }
  },

  clearProjectEpisodes: () =>
    set({
      projectEpisodes: null,
      projectEpisodesForProjectId: null,
      projectDetailError: null,
    }),
}))
