/**
 * Episode API
 * GET /api/episodes, GET /api/episodes/:id, PATCH /api/episodes/:id, POST /api/episodes/pull
 */
import type { Episode } from "@/types"
import type { PullEpisodeRequest } from "@/types"
import { apiClient, LONG_REQUEST_TIMEOUT_MS } from "./client"

/** PATCH body：仅剧集根级本地化字段（与后端白名单一致） */
export type EpisodeLocalePatch = Partial<
  Pick<Episode, "dubTargetLocale" | "sourceLocale">
>

export const episodesApi = {
  list: () => apiClient.get<Episode[]>("/episodes"),
  detail: (id: string) => apiClient.get<Episode>(`/episodes/${id}`),
  patch: (id: string, data: EpisodeLocalePatch) =>
    apiClient.patch<Episode>(`/episodes/${id}`, data),
  pull: (params: {
    episodeId: string
    forceRedownload?: boolean
    projectId?: string
    skipImages?: boolean
    skipFrames?: boolean
    skipAssets?: boolean
  }) =>
    apiClient.post<Episode>(
      "/episodes/pull",
      {
        episodeId: params.episodeId,
        forceRedownload: params.forceRedownload ?? false,
        projectId: params.projectId,
        skipImages: params.skipImages ?? false,
        skipFrames: params.skipFrames ?? false,
        skipAssets: params.skipAssets ?? false,
      } as PullEpisodeRequest,
      { timeout: LONG_REQUEST_TIMEOUT_MS }
    ),
}
