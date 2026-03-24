/**
 * Shot Store
 * Shot 列表 + 筛选 + 视图模式 + selectCandidate
 *
 * 批量框选：batchPickMode 为 manual 时，批量尾帧 / 批量视频仅处理 batchPickedShotIds 与「符合条件」的交集。
 */
import { create } from "zustand"
import type { Shot, ShotStatus } from "@/types"
import { shotsApi } from "@/api/shots"
import { useEpisodeStore } from "./episodeStore"

type StatusFilter = ShotStatus | "all"

/** 批量操作范围：全部符合筛选条件的镜头，或仅用户勾选（框选）的镜头 */
export type BatchPickMode = "all_eligible" | "manual"

interface ShotStore {
  shots: Shot[]
  statusFilter: StatusFilter
  viewMode: "grid" | "list"
  /** 批量尾帧 / 批量视频：默认全量符合条件，或仅已勾选 */
  batchPickMode: BatchPickMode
  /** manual 模式下已勾选的 shotId（与当前状态筛选无关，交集在分镜页计算） */
  batchPickedShotIds: string[]
  setFilter: (status: StatusFilter) => void
  setViewMode: (mode: "grid" | "list") => void
  setShots: (shots: Shot[]) => void
  setBatchPickMode: (mode: BatchPickMode) => void
  toggleBatchPickShot: (shotId: string) => void
  /** 将一批 id 并入勾选（去重），用于「全选当前筛选」或 Alt 框选 */
  addBatchPickShots: (shotIds: string[]) => void
  clearBatchPicks: () => void
  selectCandidate: (episodeId: string, shotId: string, candidateId: string) => Promise<void>
  getFilteredShots: () => Shot[]
}

export const useShotStore = create<ShotStore>((set, get) => ({
  shots: [],
  statusFilter: "all",
  viewMode: "grid",
  batchPickMode: "all_eligible",
  batchPickedShotIds: [],

  setFilter: (status) => set({ statusFilter: status }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setShots: (shots) => set({ shots }),

  setBatchPickMode: (mode) =>
    set((s) => ({
      batchPickMode: mode,
      /** 切回「全部符合条件」时清空勾选，避免误以为仍按勾选生效 */
      batchPickedShotIds: mode === "all_eligible" ? [] : s.batchPickedShotIds,
    })),

  toggleBatchPickShot: (shotId) =>
    set((s) => {
      const has = s.batchPickedShotIds.includes(shotId)
      return {
        batchPickedShotIds: has
          ? s.batchPickedShotIds.filter((id) => id !== shotId)
          : [...s.batchPickedShotIds, shotId],
      }
    }),

  addBatchPickShots: (shotIds) =>
    set((s) => ({
      batchPickedShotIds: [...new Set([...s.batchPickedShotIds, ...shotIds])],
    })),

  clearBatchPicks: () => set({ batchPickedShotIds: [] }),

  selectCandidate: async (episodeId, shotId, candidateId) => {
    const res = await shotsApi.select(episodeId, shotId, candidateId)
    set((s) => ({
      shots: s.shots.map((shot) =>
        shot.shotId === shotId ? res.data : shot
      ),
    }))
    // 详情页从 currentEpisode 读数据，需同步刷新 episode.json
    await useEpisodeStore.getState().fetchEpisodeDetail(episodeId)
  },

  getFilteredShots: () => {
    const { shots, statusFilter } = get()
    if (statusFilter === "all") return shots
    return shots.filter((s) => s.status === statusFilter)
  },
}))
