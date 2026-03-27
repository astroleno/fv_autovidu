/**
 * Episode Store
 * Episode 列表 + 当前 Episode + fetchEpisodes / fetchEpisodeDetail / pullNewEpisode / updateShot / updateEpisodeLocales
 *
 * 竞态说明（与 taskStore 轮询配合）：
 * - startPolling(episodeId) 会立刻 fetchEpisodeDetail，任务完成时 onAnyTerminal 也会再次 fetch。
 * - 若「较早发起的 GET」比「较晚发起的 GET」更晚返回，旧响应会覆盖新数据，界面仍显示「尾帧生成中」等，
 *   手动刷新只发一次请求故表现正常。
 * - 通过 _detailFetchGeneration：每次发起详情请求自增序号，仅当响应返回时序号仍为「当前最新」才写入 store。
 */
import { create } from "zustand"
import type { Episode, Shot } from "@/types"
import { episodesApi } from "@/api/episodes"
import { shotsApi } from "@/api/shots"

/** 单调递增：仅最后一次 fetchEpisodeDetail 的结果允许落盘，避免并发请求乱序覆盖 */
let _detailFetchGeneration = 0

interface EpisodeStore {
  episodes: Episode[]
  currentEpisode: Episode | null
  loading: boolean
  error: string | null
  /**
   * 本地尾帧 / 视频 / 重生等写入磁盘后递增，用于与 pulledAt 组合成图片 URL 的 v=，打破浏览器缓存。
   * 不参与持久化；详见 utils/episodeCacheBust.ts 与 hooks/useEpisodeMediaCacheBust.ts。
   */
  localMediaEpoch: number
  fetchEpisodes: () => Promise<void>
  fetchEpisodeDetail: (id: string) => Promise<void>
  /** 重新拉取当前正在查看的剧集详情（任务完成后刷新分镜状态） */
  refreshEpisode: () => Promise<void>
  /** 任务落盘并刷新详情后调用，使 getFileUrl 使用新的查询串加载最新缩略图 */
  bumpLocalMediaCache: () => void
  pullNewEpisode: (
    episodeId: string,
    options?: {
      forceRedownload?: boolean
      projectId?: string
      skipImages?: boolean
      skipFrames?: boolean
      skipAssets?: boolean
    }
  ) => Promise<void>
  /**
   * 更新 Shot 字段，PATCH 后按响应合并进 currentEpisode。
   * 文案类供分镜表台词/提示词列；`duration` 供分镜表与镜头详情可编辑时长（写入后影响后续视频生成默认秒数）。
   */
  updateShot: (
    episodeId: string,
    shotId: string,
    updates: Partial<
      Pick<
        Shot,
        | "visualDescription"
        | "imagePrompt"
        | "videoPrompt"
        | "dialogue"
        | "dialogueTranslation"
        | "duration"
      >
    >
  ) => Promise<void>
  /**
   * PATCH 剧集 dubTargetLocale / sourceLocale，用接口返回的完整 Episode 替换 store 中同 id 项。
   */
  updateEpisodeLocales: (
    episodeId: string,
    data: { dubTargetLocale?: string; sourceLocale?: string }
  ) => Promise<void>
}

export const useEpisodeStore = create<EpisodeStore>((set, get) => ({
  episodes: [],
  currentEpisode: null,
  loading: false,
  error: null,
  localMediaEpoch: 0,

  bumpLocalMediaCache: () =>
    set((s) => ({ localMediaEpoch: s.localMediaEpoch + 1 })),

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
    const generation = ++_detailFetchGeneration
    set((s) => ({
      loading: true,
      error: null,
      /**
       * 切换到另一剧集时清空 current，避免 URL 已是新集仍短暂显示旧集数据。
       * 若已为同一 id（例如项目页拉取成功后已写入内存），保留以便 GET 失败时仍能展示。
       */
      currentEpisode:
        s.currentEpisode?.episodeId === id ? s.currentEpisode : null,
    }))
    try {
      const res = await episodesApi.detail(id)
      // 防御：路径与 body 不一致时不写入
      if (res.data.episodeId !== id) return
      set((s) => {
        if (generation !== _detailFetchGeneration) return s
        return {
          currentEpisode: res.data,
          // 列表里若已有该剧集，同步为最新详情（含 visualDescription 等字段）
          episodes: s.episodes.some((e) => e.episodeId === id)
            ? s.episodes.map((e) => (e.episodeId === id ? res.data : e))
            : s.episodes,
        }
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "获取详情失败"
      set((s) => {
        if (generation !== _detailFetchGeneration) return s
        return {
          error: msg,
          /**
           * GET 404 时：若内存中已有同 episodeId（刚 POST /pull 成功写入 store），保留之，
           * 避免「拉取成功但读盘路径短暂不一致」时整页空白。
           */
          currentEpisode:
            s.currentEpisode?.episodeId === id ? s.currentEpisode : null,
        }
      })
    } finally {
      set((s) => {
        if (generation !== _detailFetchGeneration) return s
        return { loading: false }
      })
    }
  },

  refreshEpisode: async () => {
    const id = get().currentEpisode?.episodeId
    if (!id) return
    await get().fetchEpisodeDetail(id)
  },

  pullNewEpisode: async (episodeId, options = {}) => {
    const {
      forceRedownload = false,
      projectId,
      skipImages = false,
      skipFrames = false,
      skipAssets = false,
    } = options
    set({ loading: true, error: null })
    try {
      const res = await episodesApi.pull({
        episodeId,
        forceRedownload,
        projectId,
        skipImages,
        skipFrames,
        skipAssets,
      })
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

  updateEpisodeLocales: async (episodeId, data) => {
    const res = await episodesApi.patch(episodeId, data)
    set((s) => {
      const next = res.data
      return {
        currentEpisode:
          s.currentEpisode?.episodeId === episodeId ? next : s.currentEpisode,
        episodes: s.episodes.some((e) => e.episodeId === episodeId)
          ? s.episodes.map((e) => (e.episodeId === episodeId ? next : e))
          : s.episodes,
      }
    })
  },
}))
