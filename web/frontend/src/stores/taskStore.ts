/**
 * Task Store
 * 进行中的任务 + 轮询逻辑；支持任务终态后刷新剧集、全部完成后回调
 */
import { create } from "zustand"
import type { TaskStatusResponse } from "@/types"
import { tasksApi } from "@/api/tasks"
import { useEpisodeStore } from "./episodeStore"

interface TaskState {
  taskId: string
  status: string
  progress?: number
}

/** 轮询选项：任一任务进入终态时刷新 episode；全部终态时停止轮询并回调 */
export interface TaskPollOptions {
  episodeId?: string
  /** 有任务在本轮轮询中首次变为 success/failed 时调用（通常用于刷新列表） */
  onAnyTerminal?: () => void
  /** 全部任务均为终态时调用（如 Toast） */
  onAllSettled?: () => void
}

interface TaskStore {
  activeTasks: Map<string, TaskState>
  /** 启动轮询；会停止上一轮轮询 */
  startPolling: (taskIds: string[], options?: TaskPollOptions) => void
  stopPolling: () => void
}

let pollInterval: ReturnType<typeof setInterval> | null = null
/** 记录每个 taskId 上一轮状态，用于检测「首次进入终态」 */
const previousStatus = new Map<string, string>()

export const useTaskStore = create<TaskStore>((set, get) => ({
  activeTasks: new Map(),

  startPolling: (taskIds, options) => {
    if (taskIds.length === 0) return
    get().stopPolling()
    const ids = [...new Set(taskIds)]
    ids.forEach((id) => previousStatus.set(id, "pending"))
    const next = new Map(get().activeTasks)
    ids.forEach((id) =>
      next.set(id, { taskId: id, status: "pending" })
    )
    set({ activeTasks: next })

    const pollOptions = options

    pollInterval = window.setInterval(async () => {
      try {
        const res = await tasksApi.batchStatus(ids)
        const data = res.data as TaskStatusResponse[]
        const taskMap = new Map(get().activeTasks)
        let anyNewTerminal = false
        data.forEach((t: TaskStatusResponse) => {
          const prev = previousStatus.get(t.taskId) ?? ""
          const st = t.status
          previousStatus.set(t.taskId, st)
          if (
            (st === "success" || st === "failed") &&
            prev !== "success" &&
            prev !== "failed"
          ) {
            anyNewTerminal = true
          }
          taskMap.set(t.taskId, {
            taskId: t.taskId,
            status: st,
            progress: t.progress,
          })
        })
        set({ activeTasks: taskMap })

        if (anyNewTerminal) {
          pollOptions?.onAnyTerminal?.()
          const epId = pollOptions?.episodeId
          if (epId) {
            void useEpisodeStore.getState().fetchEpisodeDetail(epId)
          }
        }

        const allTerminal = ids.every((id) => {
          const st = taskMap.get(id)?.status
          return st === "success" || st === "failed"
        })
        if (allTerminal && ids.length > 0) {
          pollOptions?.onAllSettled?.()
          get().stopPolling()
        }
      } catch {
        // 轮询失败静默
      }
    }, 3000)
  },

  stopPolling: () => {
    if (pollInterval !== null) {
      window.clearInterval(pollInterval)
      pollInterval = null
    }
    previousStatus.clear()
    set({ activeTasks: new Map() })
  },
}))
