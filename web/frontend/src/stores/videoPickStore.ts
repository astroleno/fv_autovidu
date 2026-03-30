/**
 * VideoPick 双模式（overview / picking）专用 Zustand store
 *
 * 与 episodeStore / shotStore 分工：
 * - 本 store 仅管「当前页模式、当前镜头索引、激活候选、撤销栈、仅待选导航」等会话态
 * - 选定落库仍走 shotStore.selectCandidate + 服务端
 */
import { create } from "zustand"

/** 页面模式：列表总览 vs 单镜头选片工作台 */
export type VideoPickMode = "overview" | "picking"

/**
 * 撤销栈单条：一次「候选被写入」前的已选状态
 * 仅会话内有效，刷新即清空
 */
export interface VideoPickUndoEntry {
  shotId: string
  /**
   * 撤销后要恢复为已选的候选 id；
   * 为 null 表示撤销前无任何已选 → 恢复时调用 clearSelectedCandidate
   */
  previousCandidateId: string | null
}

const MAX_UNDO = 50

const LS_MODE_PREFIX = "fv_video_pick_mode_v1"

/** localStorage：按剧集 id 记住上次模式 */
export function readStoredVideoPickMode(episodeId: string): VideoPickMode | null {
  try {
    const raw = localStorage.getItem(LS_MODE_PREFIX)
    if (!raw) return null
    const o = JSON.parse(raw) as Record<string, VideoPickMode>
    const m = o[episodeId]
    return m === "overview" || m === "picking" ? m : null
  } catch {
    return null
  }
}

export function writeStoredVideoPickMode(
  episodeId: string,
  mode: VideoPickMode
): void {
  try {
    const raw = localStorage.getItem(LS_MODE_PREFIX)
    const o = raw ? (JSON.parse(raw) as Record<string, VideoPickMode>) : {}
    o[episodeId] = mode
    localStorage.setItem(LS_MODE_PREFIX, JSON.stringify(o))
  } catch {
    /* 隐私模式等失败时忽略 */
  }
}

interface VideoPickStore {
  mode: VideoPickMode
  /** 当前在 filteredFlatShots 中的索引 */
  currentShotIndex: number
  /** 当前镜头下 UI 激活的候选（播放、提交）；可能与列表刷新异步 */
  activeCandidateId: string | null
  /** 左右键是否仅在「待选」镜头间跳转 */
  pickingOnlyPending: boolean
  undoStack: VideoPickUndoEntry[]

  setMode: (mode: VideoPickMode) => void
  enterPicking: (shotIndex: number) => void
  exitPicking: () => void
  setCurrentShotIndex: (index: number) => void
  setActiveCandidateId: (id: string | null) => void
  setPickingOnlyPending: (v: boolean) => void
  pushUndo: (entry: VideoPickUndoEntry) => void
  /** 查看栈顶但不弹出（用于先请求成功再 pop） */
  peekUndo: () => VideoPickUndoEntry | undefined
  /** 弹出一条撤销记录（仅在恢复成功后调用） */
  popUndo: () => VideoPickUndoEntry | undefined
  clearUndo: () => void
  /**
   * 切换剧集时重置镜头索引、激活候选、撤销栈（不重置 mode，避免覆盖 localStorage 恢复）
   */
  resetSessionForEpisode: (options?: {
    preserveCurrentShotIndex?: boolean
  }) => void
}

export const useVideoPickStore = create<VideoPickStore>((set, get) => ({
  mode: "overview",
  currentShotIndex: 0,
  activeCandidateId: null,
  pickingOnlyPending: false,
  undoStack: [],

  setMode: (mode) => set({ mode }),

  enterPicking: (shotIndex) =>
    set({
      mode: "picking",
      currentShotIndex: Math.max(0, shotIndex),
    }),

  exitPicking: () => set({ mode: "overview" }),

  setCurrentShotIndex: (index) =>
    set({ currentShotIndex: Math.max(0, index) }),

  setActiveCandidateId: (id) => set({ activeCandidateId: id }),

  setPickingOnlyPending: (v) => set({ pickingOnlyPending: v }),

  pushUndo: (entry) =>
    set((s) => ({
      undoStack: [...s.undoStack, entry].slice(-MAX_UNDO),
    })),

  peekUndo: () => {
    const stack = get().undoStack
    if (stack.length === 0) return undefined
    return stack[stack.length - 1]
  },

  popUndo: () => {
    const stack = get().undoStack
    if (stack.length === 0) return undefined
    const last = stack[stack.length - 1]
    set({ undoStack: stack.slice(0, -1) })
    return last
  },

  clearUndo: () => set({ undoStack: [] }),

  resetSessionForEpisode: (options) =>
    set((state) => ({
      currentShotIndex: options?.preserveCurrentShotIndex
        ? state.currentShotIndex
        : 0,
      activeCandidateId: null,
      pickingOnlyPending: false,
      undoStack: [],
    })),
}))
