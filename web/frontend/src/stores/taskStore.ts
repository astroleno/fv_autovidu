/**
 * Task Store
 * 进行中的任务 + 轮询逻辑；支持任务终态后刷新剧集、全部完成后回调
 *
 * 轮询策略：
 * - 成功拿到 batch 结果：下次间隔重置为 3s，连续失败计数清零
 * - 请求失败：指数退避（3s 起乘 2，上限 30s），连续失败 3 次提示 Toast
 * - 连续失败满 10 次：停止轮询并提示用户手动刷新
 */
import { create } from "zustand"
import type { TaskStatusResponse } from "@/types"
import { tasksApi } from "@/api/tasks"
import { useEpisodeStore } from "./episodeStore"
import { useToastStore } from "./toastStore"

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
  /**
   * 全部任务均为终态时调用；传入最后一次成功拉取到的任务状态列表，便于批量结果汇总
   */
  onAllSettled?: (results: TaskStatusResponse[]) => void
}

interface TaskStore {
  activeTasks: Map<string, TaskState>
  /** 启动轮询；会停止上一轮轮询 */
  startPolling: (taskIds: string[], options?: TaskPollOptions) => void
  stopPolling: () => void
}

let pollTimeout: ReturnType<typeof setTimeout> | null = null
/** 记录每个 taskId 上一轮状态，用于检测「首次进入终态」 */
const previousStatus = new Map<string, string>()

const INITIAL_DELAY_MS = 3000
const MAX_DELAY_MS = 30000
const TOAST_AFTER_CONSECUTIVE_FAILURES = 3
const STOP_AFTER_CONSECUTIVE_FAILURES = 10

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
    let consecutiveFailures = 0
    let nextDelayMs = INITIAL_DELAY_MS

    const scheduleNext = () => {
      pollTimeout = window.setTimeout(async () => {
        try {
          const res = await tasksApi.batchStatus(ids)
          const data = res.data as TaskStatusResponse[]
          consecutiveFailures = 0
          nextDelayMs = INITIAL_DELAY_MS

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
            pollOptions?.onAllSettled?.(data)
            get().stopPolling()
            return
          }
          scheduleNext()
        } catch {
          consecutiveFailures += 1
          nextDelayMs = Math.min(
            MAX_DELAY_MS,
            Math.max(INITIAL_DELAY_MS, nextDelayMs * 2)
          )
          const pushToast = useToastStore.getState().push
          if (consecutiveFailures === TOAST_AFTER_CONSECUTIVE_FAILURES) {
            pushToast("任务状态查询失败，将自动重试", "error")
          }
          if (consecutiveFailures >= STOP_AFTER_CONSECUTIVE_FAILURES) {
            pushToast("轮询已停止，请手动刷新页面后重试", "error")
            get().stopPolling()
            return
          }
          scheduleNext()
        }
      }, nextDelayMs)
    }

    scheduleNext()
  },

  stopPolling: () => {
    if (pollTimeout !== null) {
      window.clearTimeout(pollTimeout)
      pollTimeout = null
    }
    previousStatus.clear()
    set({ activeTasks: new Map() })
  },
}))
