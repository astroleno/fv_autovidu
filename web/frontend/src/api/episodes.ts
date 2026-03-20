/**
 * Episode API
 * GET /api/episodes, GET /api/episodes/:id, POST /api/episodes/pull
 */
import type { Episode } from "@/types"
import type { PullEpisodeRequest } from "@/types"
import { apiClient } from "./client"

export const episodesApi = {
  list: () => apiClient.get<Episode[]>("/episodes"),
  detail: (id: string) => apiClient.get<Episode>(`/episodes/${id}`),
  pull: (
    episodeId: string,
    forceRedownload = false,
    projectId?: string,
    skipImages = false
  ) =>
    apiClient.post<Episode>("/episodes/pull", {
      episodeId,
      forceRedownload,
      projectId,
      skipImages,
    } as PullEpisodeRequest),
}
