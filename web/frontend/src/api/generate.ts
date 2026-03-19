/**
 * 生成操作 API
 * POST /api/generate/endframe, /api/generate/video, /api/generate/regen-frame
 */
import type {
  GenerateEndframeRequest,
  GenerateEndframeResponse,
  GenerateVideoRequest,
  GenerateVideoResponse,
  RegenFrameRequest,
  RegenFrameResponse,
} from "@/types"
import { apiClient } from "./client"

export const generateApi = {
  endframe: (params: GenerateEndframeRequest) =>
    apiClient.post<GenerateEndframeResponse>("/generate/endframe", params),
  video: (params: GenerateVideoRequest) =>
    apiClient.post<GenerateVideoResponse>("/generate/video", params),
  regenFrame: (params: RegenFrameRequest) =>
    apiClient.post<RegenFrameResponse>("/generate/regen-frame", params),
}
