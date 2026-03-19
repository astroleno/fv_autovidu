/**
 * UI Store
 * 侧边栏折叠、弹窗状态
 */
import { create } from "zustand"

export const MODAL_PULL_EPISODE = "pull-episode"

interface UIStore {
  sidebarCollapsed: boolean
  activeModal: string | null
  toggleSidebar: () => void
  openModal: (id: string) => void
  closeModal: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: false,
  activeModal: null,

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
}))
