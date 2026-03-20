/**
 * Episode Store
 * Episode 列表 + 当前 Episode + fetchEpisodes / fetchEpisodeDetail / pullNewEpisode / updateShot
 */
import { create } from "zustand"
import type { Episode } from "@/types"
import { episodesApi } from "@/api/episodes"
import { shotsApi } from "@/api/shots"

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
    projectId?: string,
    /** 仅同步文案（画面描述等），不下载首帧/资产图 */
    skipImages?: boolean
  ) => Promise<void>
  /** 更新 Shot 字段（如 visualDescription/imagePrompt/videoPrompt），同步到 currentEpisode */
  updateShot: (
    episodeId: string,
    shotId: string,
    updates: Partial<{ visualDescription: string; imagePrompt: string; videoPrompt: string }>
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
      // 同一 episodeId 只保留一条（后端已择优，此处防御性去重，避免异常响应）
      const seen = new Set<string>()
      const deduped = res.data.filter((ep) => {
        if (seen.has(ep.episodeId)) return false
        seen.add(ep.episodeId)
        return true
      })
      set({ episodes: deduped })
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
      set((s) => ({
        currentEpisode: res.data,
        // 列表里若已有该剧集，同步为最新详情（含 visualDescription 等字段）
        episodes: s.episodes.some((e) => e.episodeId === id)
          ? s.episodes.map((e) => (e.episodeId === id ? res.data : e))
          : s.episodes,
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "获取详情失败" })
    } finally {
      set({ loading: false })
    }
  },

  pullNewEpisode: async (
    episodeId: string,
    forceRedownload = false,
    projectId?: string,
    skipImages = false
  ) => {
    set({ loading: true, error: null })
    try {
      const res = await episodesApi.pull(
        episodeId,
        forceRedownload,
        projectId,
        skipImages
      )
      set((s) => {
        // 再次拉取同一剧集时去掉旧项，否则列表里会出现两个相同 episodeId，
        // React key 重复会导致卡片/行渲染错乱（终端里 “duplicate key” 警告）
        const rest = s.episodes.filter((e) => e.episodeId !== res.data.episodeId)
        return {
          episodes: [res.data, ...rest],
          currentEpisode: res.data,
        }
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "拉取失败" })
      throw e
    } finally {
      set({ loading: false })
    }
  },

  updateShot: async (episodeId, shotId, updates) => {
    const res = await shotsApi.update(episodeId, shotId, updates)
    set((s) => {
      if (!s.currentEpisode || s.currentEpisode.episodeId !== episodeId)
        return s
      const newScenes = s.currentEpisode.scenes.map((scene) => ({
        ...scene,
        shots: scene.shots.map((shot) =>
          shot.shotId === shotId ? { ...shot, ...res.data } : shot
        ),
      }))
      return { currentEpisode: { ...s.currentEpisode, scenes: newScenes } }
    })
  },
}))
