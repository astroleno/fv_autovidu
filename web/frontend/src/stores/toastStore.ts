/**
 * Toast 全局状态
 * 与 components/ui/Toast 配合，在 AppLayout 中挂载一次即可全站调用
 */
import { create } from "zustand"
import type { ToastItem, ToastType } from "@/components/ui/Toast"

let _toastSeq = 0

interface ToastStore {
  toasts: ToastItem[]
  /** 推入一条通知，默认 4s 后自动移除 */
  push: (message: string, type?: ToastType, durationMs?: number) => void
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  push: (message, type = "info", durationMs = 4000) => {
    const id = `toast-${++_toastSeq}`
    const item: ToastItem = { id, type, message, duration: durationMs }
    set((s) => ({ toasts: [...s.toasts, item] }))
    if (durationMs > 0) {
      window.setTimeout(() => {
        get().dismiss(id)
      }, durationMs)
    }
  },

  dismiss: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
}))
