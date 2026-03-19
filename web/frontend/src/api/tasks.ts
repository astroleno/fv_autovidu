/**
 * 任务状态 API
 * GET /api/tasks/:taskId, GET /api/tasks/batch?ids=...
 */
import type { TaskStatusResponse } from "@/types"
import { apiClient } from "./client"

export const tasksApi = {
  status: (taskId: string) =>
    apiClient.get<TaskStatusResponse>(`/tasks/${taskId}`),
  batchStatus: (ids: string[]) =>
    apiClient.get<TaskStatusResponse[]>(
      `/tasks/batch?ids=${ids.join(",")}`
    ),
}
