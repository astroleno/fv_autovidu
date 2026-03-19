/**
 * Episode Store
 * Episode 列表 + 当前 Episode + fetchEpisodes / fetchEpisodeDetail / pullNewEpisode
 */
import { create } from "zustand"
import type { Episode } from "@/types"
import { episodesApi } from "@/api/episodes"

interface EpisodeStore {
  episodes: Episode[]
  currentEpisode: Episode | null
  loading: boolean
  error: string | null
  fetchEpisodes: () => Promise<void>
  fetchEpisodeDetail: (id: string) => Promise<void>
  pullNewEpisode: (
    episodeId: string,
    forceRedownload?: boolean,
    projectId?: string
  ) => Promise<void>
}

export const useEpisodeStore = create<EpisodeStore>((set) => ({
  episodes: [],
  currentEpisode: null,
  loading: false,
  error: null,

  fetchEpisodes: async () => {
    set({ loading: true, error: null })
    try {
      const res = await episodesApi.list()
      set({ episodes: res.data })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "获取列表失败" })
    } finally {
      set({ loading: false })
    }
  },

  fetchEpisodeDetail: async (id: string) => {
    set({ loading: true, error: null })
    try {
      const res = await episodesApi.detail(id)
      set({ currentEpisode: res.data })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "获取详情失败" })
    } finally {
      set({ loading: false })
    }
  },

  pullNewEpisode: async (
    episodeId: string,
    forceRedownload = false,
    projectId?: string
  ) => {
    set({ loading: true, error: null })
    try {
      const res = await episodesApi.pull(episodeId, forceRedownload, projectId)
      set((s) => ({
        episodes: [res.data, ...s.episodes],
        currentEpisode: res.data,
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "拉取失败" })
      throw e
    } finally {
      set({ loading: false })
    }
  },
}))
