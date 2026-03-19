/**
 * 导出 API
 * POST /api/export/rough-cut
 */
import type {
  ExportRoughCutRequest,
  ExportRoughCutResponse,
} from "@/types"
import { apiClient } from "./client"

export const exportApi = {
  roughCut: (params: ExportRoughCutRequest) =>
    apiClient.post<ExportRoughCutResponse>("/export/rough-cut", params),
}
