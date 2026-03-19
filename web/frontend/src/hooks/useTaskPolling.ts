/**
 * useTaskPolling 任务状态轮询
 * 每 3 秒轮询 GET /api/tasks/batch
 * 状态变化时回调 onUpdate
 */
import { useEffect, useRef } from "react"
import { useTaskStore } from "@/stores"

export function useTaskPolling(
  taskIds: string[],
  onUpdate?: () => void
) {
  const { startPolling, stopPolling, activeTasks } = useTaskStore()
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  useEffect(() => {
    if (taskIds.length === 0) return
    startPolling(taskIds)
    return () => stopPolling()
  }, [taskIds.join(","), startPolling, stopPolling])

  // 当 activeTasks 变化时触发 onUpdate
  useEffect(() => {
    if (activeTasks.size > 0 && onUpdateRef.current) {
      onUpdateRef.current()
    }
  }, [activeTasks])

  return { activeTasks }
}
