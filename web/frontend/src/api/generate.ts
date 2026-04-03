/**
 * 生成操作 API
 * POST /api/generate/endframe, /video, /video/promote, /regen-frame, /regen-batch-wan27
 */
import type {
  BatchEndframeResponse,
  GenerateEndframeRequest,
  GenerateVideoRequest,
  GenerateVideoResponse,
  PromoteVideoRequest,
  RegenBatchWan27Request,
  RegenBatchWan27Response,
  RegenFrameRequest,
  RegenFrameResponse,
} from "@/types"
import { apiClient } from "./client"

export const generateApi = {
  endframe: (params: GenerateEndframeRequest) =>
    apiClient.post<BatchEndframeResponse>("/generate/endframe", params),
  video: (params: GenerateVideoRequest) =>
    apiClient.post<GenerateVideoResponse>("/generate/video", params),
  promote: (params: PromoteVideoRequest) =>
    apiClient.post<GenerateVideoResponse>("/generate/video/promote", params),
  regenFrame: (params: RegenFrameRequest) =>
    apiClient.post<RegenFrameResponse>("/generate/regen-frame", params),
  /** 万相 2.7 异步组图：按序写回各镜首帧 */
  regenBatchWan27: (params: RegenBatchWan27Request) =>
    apiClient.post<RegenBatchWan27Response>(
      "/generate/regen-batch-wan27",
      params
    ),
}
