/**
 * 导出 API
 * - POST /api/export/rough-cut — 粗剪拼接
 * - POST /api/export/jianying-draft — 剪映草稿
 * - GET /api/export/jianying-draft/path — 本机剪映目录候选
 */
import type {
  ExportRoughCutRequest,
  ExportRoughCutResponse,
  JianyingExportRequest,
  JianyingExportResponse,
  JianyingDraftPathResponse,
} from "@/types"
import { apiClient } from "./client"

export const exportApi = {
  roughCut: (params: ExportRoughCutRequest) =>
    apiClient.post<ExportRoughCutResponse>("/export/rough-cut", params),

  jianyingDraft: (params: JianyingExportRequest) =>
    apiClient.post<JianyingExportResponse>("/export/jianying-draft", params),

  jianyingDraftPathHints: () =>
    apiClient.get<JianyingDraftPathResponse>("/export/jianying-draft/path"),
}
