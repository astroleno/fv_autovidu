/**
 * Shot Store
 * Shot 列表 + 筛选 + 视图模式 + selectCandidate
 */
import { create } from "zustand"
import type { Shot, ShotStatus } from "@/types"
import { shotsApi } from "@/api/shots"
import { useEpisodeStore } from "./episodeStore"

type StatusFilter = ShotStatus | "all"

interface ShotStore {
  shots: Shot[]
  statusFilter: StatusFilter
  viewMode: "grid" | "list"
  setFilter: (status: StatusFilter) => void
  setViewMode: (mode: "grid" | "list") => void
  setShots: (shots: Shot[]) => void
  selectCandidate: (episodeId: string, shotId: string, candidateId: string) => Promise<void>
  getFilteredShots: () => Shot[]
}

export const useShotStore = create<ShotStore>((set, get) => ({
  shots: [],
  statusFilter: "all",
  viewMode: "grid",

  setFilter: (status) => set({ statusFilter: status }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setShots: (shots) => set({ shots }),

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
