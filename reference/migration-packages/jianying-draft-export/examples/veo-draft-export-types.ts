/**
 * 剪映草稿导出相关 TypeScript 类型（从 UGCFlow frontend/types/veo.ts 摘录）
 * 迁移到其他项目时可单独保留本文件或合并进你的类型定义。
 */

/** 后端 manifest.draftExport 在成功导出后的形态（字段可能随版本扩展） */
export interface VeoDraftExportState {
  status: "idle" | "exporting" | "success" | "error";
  draftId: string | null;
  draftDir: string | null;
  zipPath: string | null;
  exportedAt: string | null;
  mode: string;
  targetPath: string | null;
  missingShots: string[];
  error?: string | null;
  warning?: string | null;
}

export interface ExportJianyingDraftRequest {
  /** 剪映草稿根目录绝对路径；仅打 ZIP 时可省略 */
  draftPath?: string;
  /** 是否生成 ZIP（可与 draftPath 组合或单独使用） */
  createZip?: boolean;
}

export interface ExportJianyingDraftResponse {
  data: VeoDraftExportState | null;
  meta?: {
    message?: string;
  };
}

/** 服务端 GET /api/system/jianying-draft-path 返回 */
export interface JianyingDraftPathDetectionResponse {
  data: {
    os: "macos" | "windows" | "unknown";
    detectedPath: string | null;
    exists: boolean;
  };
}
