/**
 * 项目 API：GET /api/projects*、POST pull-all
 */
import type {
  ProjectEpisodeListResponse,
  ProjectSummary,
  PullProjectResponse,
} from "@/types/project"
import { apiClient } from "./client"

export const projectsApi = {
  list: () => apiClient.get<ProjectSummary[]>("/projects"),

  detail: (projectId: string) =>
    apiClient.get<ProjectSummary>(`/projects/${encodeURIComponent(projectId)}`),

  episodes: (projectId: string) =>
    apiClient.get<ProjectEpisodeListResponse>(
      `/projects/${encodeURIComponent(projectId)}/episodes`
    ),

  pullAll: (
    projectId: string,
    opts?: { forceRedownload?: boolean; skipImages?: boolean }
  ) =>
    apiClient.post<PullProjectResponse>(
      `/projects/${encodeURIComponent(projectId)}/pull-all`,
      {
        forceRedownload: opts?.forceRedownload ?? false,
        skipImages: opts?.skipImages ?? false,
      }
    ),
}
