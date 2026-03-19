/**
 * Task Store
 * 进行中的任务 + 轮询逻辑
 */
import { create } from "zustand"
import type { TaskStatusResponse } from "@/types"
import { tasksApi } from "@/api/tasks"

interface TaskState {
  taskId: string
  status: string
  progress?: number
}

interface TaskStore {
  activeTasks: Map<string, TaskState>
  startPolling: (taskIds: string[]) => void
  stopPolling: () => void
}

let pollInterval: ReturnType<typeof setInterval> | null = null

export const useTaskStore = create<TaskStore>((set, get) => ({
  activeTasks: new Map(),

  startPolling: (taskIds: string[]) => {
    if (taskIds.length === 0) return
    get().stopPolling()
    const ids = [...new Set(taskIds)]
    ids.forEach((id) =>
      get().activeTasks.set(id, { taskId: id, status: "pending" })
    )
    set({ activeTasks: new Map(get().activeTasks) })

    pollInterval = setInterval(async () => {
      try {
        const res = await tasksApi.batchStatus(ids)
        const data = res.data as TaskStatusResponse[]
        const next = new Map(get().activeTasks)
        data.forEach((t: TaskStatusResponse) => {
          next.set(t.taskId, {
            taskId: t.taskId,
            status: t.status,
            progress: t.progress,
          })
        })
        set({ activeTasks: next })
      } catch {
        // 轮询失败静默，避免刷屏
      }
    }, 3000)
  },

  stopPolling: () => {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
    set({ activeTasks: new Map() })
  },
}))
