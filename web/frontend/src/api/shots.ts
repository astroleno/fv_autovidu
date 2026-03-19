/**
 * Shot API
 * GET /api/episodes/:id/shots, PATCH /api/episodes/:id/shots/:shotId
 * POST /api/shots/:shotId/select
 */
import type { Shot } from "@/types"
import type { SelectCandidateRequest } from "@/types"
import { apiClient } from "./client"

export const shotsApi = {
  list: (episodeId: string) =>
    apiClient.get<Shot[]>(`/episodes/${episodeId}/shots`),
  detail: (episodeId: string, shotId: string) =>
    apiClient.get<Shot>(`/episodes/${episodeId}/shots/${shotId}`),
  update: (episodeId: string, shotId: string, data: Partial<Shot>) =>
    apiClient.patch<Shot>(`/episodes/${episodeId}/shots/${shotId}`, data),
  select: (episodeId: string, shotId: string, candidateId: string) =>
    apiClient.post<Shot>(`/episodes/${episodeId}/shots/${shotId}/select`, {
      candidateId,
    } as SelectCandidateRequest),
}
