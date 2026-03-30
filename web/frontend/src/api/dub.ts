/**
 * 配音 API：ElevenLabs STS / TTS
 */
import type {
  AssetVoicePreviewRequest,
  AssetVoicePreviewResponse,
  DubProcessRequest,
  DubProcessResponse,
  DubProcessShotRequest,
  DubTaskItem,
} from "@/types"
import { apiClient } from "./client"

/** GET /dub/configured */
export interface DubConfiguredResponse {
  configured: boolean
}

/** GET /dub/voices */
export interface DubVoicesResponse {
  voices: Array<{ voiceId: string; name: string; labels: Record<string, unknown> }>
}

/** GET /dub/status/:episodeId */
export interface DubStatusRow {
  shotId: string
  dub: Record<string, unknown> | null
}

export interface DubEpisodeStatusApiResponse {
  episodeId: string
  shots: DubStatusRow[]
}

export const dubApi = {
  configured: () =>
    apiClient.get<DubConfiguredResponse>("/dub/configured"),

  voices: () => apiClient.get<DubVoicesResponse>("/dub/voices"),

  status: (episodeId: string) =>
    apiClient.get<DubEpisodeStatusApiResponse>(`/dub/status/${episodeId}`),

  process: (body: DubProcessRequest) =>
    apiClient.post<DubProcessResponse>("/dub/process", body),

  processShot: (body: DubProcessShotRequest) =>
    apiClient.post<DubTaskItem>("/dub/process-shot", body),

  previewAssetVoice: (body: AssetVoicePreviewRequest) =>
    apiClient.post<AssetVoicePreviewResponse>("/dub/asset-preview", body),
}
