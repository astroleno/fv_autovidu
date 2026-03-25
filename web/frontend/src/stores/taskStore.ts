/**
 * Task Store
 * 进行中的任务 + 轮询逻辑；支持任务终态后刷新剧集、全部完成后回调
 *
 * 轮询策略：
 * - 支持多批任务 **合并轮询**：后发起的 `startPolling` 不会取消已在进行的批量尾帧/视频任务，
 *   仅将新 taskId 并入同一次 `GET /tasks/batch` 查询（避免单帧重生顶掉批量进度）。
 * - 每批任务独立 `onAllSettled`：仅当该批 **全部** taskId 进入终态时触发该批回调。
 * - 启动时若带 episodeId：立即 fetchEpisodeDetail
 * - 有任务首次进入终态：按批次解析 episodeId 并 fetch（非仅首个 batch），完成后 bumpLocalMediaCache 以刷新图片 v=
 * - 每「轮询会话」首次请求延迟 0ms，之后成功间隔 3s
 * - 请求失败：指数退避（3s 起乘 2，上限 30s），连续失败 3 次提示 Toast
 * - 连续失败满 10 次：停止轮询并对**尚未结束**的各批调用 `onPollAborted`
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

/** 单批轮询的选项 */
export interface TaskPollOptions {
  episodeId?: string
  /** 本批中有任务在本轮首次变为 success/failed 时调用 */
  onAnyTerminal?: () => void
  /**
   * 本批任务**全部**终态时调用；传入本批 taskId 对应的状态列表（顺序与接口返回一致）
   */
  onAllSettled?: (results: TaskStatusResponse[]) => void
  /**
   * 连续拉取任务状态失败达到上限而停止轮询时调用（本批未正常结束）
   */
  onPollAborted?: () => void
}

/** 内部：一批待跟踪的任务及其回调 */
interface PollingBatch {
  taskIds: string[]
  options: TaskPollOptions
}

interface TaskStore {
  activeTasks: Map<string, TaskState>
  /**
   * 启动/追加轮询：不会清空已在队列中的其它批次（与旧版「每次先 stop」不同）
   */
  startPolling: (taskIds: string[], options?: TaskPollOptions) => void
  /** 强制停止所有批次并清空状态 */
  stopPolling: () => void
}

/** 当前正在轮询的所有批次（模块级，与单例 timer 对应） */
let pollingBatches: PollingBatch[] = []
let pollTimeout: ReturnType<typeof setTimeout> | null = null
/** 记录每个 taskId 上一轮状态，用于检测「首次进入终态」 */
const previousStatus = new Map<string, string>()
/** 本轮会话连续请求失败次数 */
let consecutiveFailures = 0
/** 下一次 executeTick 的延迟；新会话首包为 0 */
let nextTickDelayMs = 3000

const INITIAL_DELAY_MS = 3000
const FIRST_POLL_DELAY_MS = 0
const MAX_DELAY_MS = 30000
const TOAST_AFTER_CONSECUTIVE_FAILURES = 3
const STOP_AFTER_CONSECUTIVE_FAILURES = 10

function unionTaskIds(): string[] {
  const s = new Set<string>()
  for (const b of pollingBatches) {
    for (const id of b.taskIds) s.add(id)
  }
  return [...s]
}

/**
 * 任务首次进入终态后：按 **批次** 找到对应 episodeId（支持多剧并行轮询），
 * 拉最新 episode.json，再 bump 图片缓存世代，避免「只刷第一个 batch 的 episode」或「pulledAt 不变导致缩略图不更新」。
 */
function refreshEpisodesForNewlyTerminalTasks(newlyTerminalIds: Set<string>): void {
  const episodeIds = new Set<string>()
  for (const batch of pollingBatches) {
    const ep = batch.options.episodeId
    if (!ep) continue
    if (batch.taskIds.some((id) => newlyTerminalIds.has(id))) {
      episodeIds.add(ep)
    }
  }
  if (episodeIds.size === 0) {
    const fallback = pollingBatches.map((b) => b.options.episodeId).find(Boolean)
    if (fallback) episodeIds.add(fallback)
  }
  const epStore = useEpisodeStore.getState()
  void Promise.all([...episodeIds].map((id) => epStore.fetchEpisodeDetail(id)))
    .catch(() => undefined)
    .finally(() => {
      epStore.bumpLocalMediaCache()
    })
}

function clearTimer(): void {
  if (pollTimeout !== null) {
    window.clearTimeout(pollTimeout)
    pollTimeout = null
  }
}

/**
 * 停止轮询并清空模块状态（不触发 onPollAborted，用于正常收尾或用户显式 stop）
 */
function finishPollingInternal(
  set: (partial: Partial<{ activeTasks: Map<string, TaskState> }>) => void
): void {
  clearTimer()
  pollingBatches = []
  previousStatus.clear()
  consecutiveFailures = 0
  nextTickDelayMs = FIRST_POLL_DELAY_MS
  set({ activeTasks: new Map() })
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  activeTasks: new Map(),

  startPolling: (taskIds, options) => {
    if (taskIds.length === 0) return
    const uniq = [...new Set(taskIds)]
    const opts = options ?? {}
    pollingBatches.push({ taskIds: uniq, options: opts })

    uniq.forEach((id) => {
      if (!previousStatus.has(id)) previousStatus.set(id, "pending")
    })
    const next = new Map(get().activeTasks)
    uniq.forEach((id) => next.set(id, { taskId: id, status: "pending" }))
    set({ activeTasks: next })

    const epId = opts.episodeId
    if (epId) {
      void useEpisodeStore.getState().fetchEpisodeDetail(epId)
    }

    const wasIdle = pollTimeout === null && pollingBatches.length === 1
    /** 全新会话（此前无任何批次在跑）时首包 0ms */
    if (wasIdle) {
      nextTickDelayMs = FIRST_POLL_DELAY_MS
      consecutiveFailures = 0
    }

    const scheduleNext = (delay: number) => {
      clearTimer()
      pollTimeout = window.setTimeout(() => void executeTick(), delay)
    }

    const executeTick = async () => {
      const ids = unionTaskIds()
      if (ids.length === 0) {
        finishPollingInternal(set)
        return
      }

      try {
        const res = await tasksApi.batchStatus(ids)
        const data = res.data as TaskStatusResponse[]
        consecutiveFailures = 0
        nextTickDelayMs = INITIAL_DELAY_MS

        const taskMap = new Map(get().activeTasks)
        /** 本轮首次进入终态的 taskId（用于按批触发 onAnyTerminal） */
        const newlyTerminalIds = new Set<string>()

        data.forEach((t: TaskStatusResponse) => {
          const prev = previousStatus.get(t.taskId) ?? ""
          const st = t.status
          previousStatus.set(t.taskId, st)
          if (
            (st === "success" || st === "failed") &&
            prev !== "success" &&
            prev !== "failed"
          ) {
            newlyTerminalIds.add(t.taskId)
          }
          taskMap.set(t.taskId, {
            taskId: t.taskId,
            status: st,
            progress: t.progress,
          })
        })

        /** 仅保留仍属于未结束批次的 taskId，避免已完成批的 id 长期留在地图上 */
        const stillTracked = new Set(unionTaskIds())
        const pruned = new Map<string, TaskState>()
        stillTracked.forEach((id) => {
          const row = taskMap.get(id)
          if (row) pruned.set(id, row)
        })
        set({ activeTasks: pruned })

        if (newlyTerminalIds.size > 0) {
          refreshEpisodesForNewlyTerminalTasks(newlyTerminalIds)
        }

        /** 按批检查是否全部终态 */
        const remaining: PollingBatch[] = []
        for (const batch of pollingBatches) {
          const allTerminal = batch.taskIds.every((id) => {
            const st = pruned.get(id)?.status
            return st === "success" || st === "failed"
          })
          if (allTerminal && batch.taskIds.length > 0) {
            if (batch.taskIds.some((id) => newlyTerminalIds.has(id))) {
              batch.options.onAnyTerminal?.()
            }
            const idSet = new Set(batch.taskIds)
            const batchResults = data.filter((row) => idSet.has(row.taskId))
            batch.options.onAllSettled?.(batchResults)
          } else {
            remaining.push(batch)
            /** 本批若有任务刚进入终态，触发该批 onAnyTerminal */
            const batchNew = batch.taskIds.some((id) => newlyTerminalIds.has(id))
            if (batchNew) {
              batch.options.onAnyTerminal?.()
            }
          }
        }
        pollingBatches = remaining

        if (pollingBatches.length === 0) {
          finishPollingInternal(set)
          return
        }

        scheduleNext(nextTickDelayMs)
      } catch {
        consecutiveFailures += 1
        nextTickDelayMs = Math.min(
          MAX_DELAY_MS,
          Math.max(INITIAL_DELAY_MS, nextTickDelayMs * 2)
        )
        const pushToast = useToastStore.getState().push
        if (consecutiveFailures === TOAST_AFTER_CONSECUTIVE_FAILURES) {
          pushToast("任务状态查询失败，将自动重试", "error")
        }
        if (consecutiveFailures >= STOP_AFTER_CONSECUTIVE_FAILURES) {
          pushToast("轮询已停止，请手动刷新页面后重试", "error")
          pollingBatches.forEach((b) => b.options.onPollAborted?.())
          finishPollingInternal(set)
          return
        }
        scheduleNext(nextTickDelayMs)
      }
    }

    if (pollTimeout === null) {
      scheduleNext(nextTickDelayMs)
    }
  },

  stopPolling: () => {
    finishPollingInternal(set)
  },
}))
