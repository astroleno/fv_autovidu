/**
 * 导出 API
 * - POST /api/export/rough-cut — 粗剪拼接
 * - POST /api/export/jianying-draft — 剪映草稿（复制到 draftPath，不生成 ZIP）
 * - GET /api/export/jianying-draft/path — 本机剪映目录候选
 * - GET /api/system/jianying-draft-path — 与 reference/packages/ugc-export-integrations README 约定路径一致（同义）
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

  /** 与 GET /api/system/jianying-draft-path 返回一致（见 reference/packages/ugc-export-integrations） */
  jianyingDraftPathHints: () =>
    apiClient.get<JianyingDraftPathResponse>("/export/jianying-draft/path"),
}
