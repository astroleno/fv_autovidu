/**
 * 剪映草稿导出 — Express 路由接入示例（节选思路）
 *
 * 本文件不是可独立运行的路由模块，而是说明在 UGCFlow 中这些端点如何与
 * veoShotPipelineService、jianyingDraftExportService 协作。
 *
 * 迁移步骤：
 * 1. 在目标项目中实现与 veoShotPipelineService 等价的：
 *    - getRuntimeManifest(projectId, variantId)
 *    - saveRuntimeManifest(projectId, variantId, manifest)
 *    - getRuntimeDir(projectId, variantId)  // variant 运行时根目录，内含 clips/raw 等
 * 2. 将下方逻辑合并到你的 variant 路由，或单独 router 并挂载到 /api/projects/...
 * 3. 保留 buildApiData / buildApiErrorResponse / classifyDraftExportError 与主仓库一致，避免前端解析差异
 */

// const express = require("express");
// const fs = require("fs");
// const path = require("path");
// const jianyingDraftExportService = require("../services/jianyingDraftExportService");
// const veoShotPipelineService = require("../services/veoShotPipelineService");
// const { buildApiErrorResponse } = require("../utils/apiErrors");
// const variantDAO = require("../db/variantDAO");

/*
function buildApiData(data, message = undefined) {
  return {
    data,
    ...(message ? { meta: { message } } : {}),
  };
}

function translateDraftTargetPathError(rawMessage) {
  if (rawMessage.includes("is required")) return "draftPath 不能为空";
  if (rawMessage.includes("contains invalid characters"))
    return "draftPath 包含非法字符";
  if (rawMessage.includes("must be absolute")) return "draftPath 必须是绝对路径";
  if (rawMessage.includes("cannot be a filesystem root"))
    return "draftPath 不能是文件系统根目录";
  if (rawMessage.includes("cannot be in a system directory"))
    return "draftPath 不能位于系统目录";
  if (rawMessage.includes("cannot be a symbolic link"))
    return "draftPath 及其父目录不能是符号链接";
  return "draftPath 非法";
}

function classifyDraftExportError(error, options = {}) {
  const rawMessage = error?.message || "未知错误";
  const isZipOnly = Boolean(options.createZip) && !options.draftPath;

  if (rawMessage.includes("没有可导出的已完成 shots")) {
    return {
      status: 422,
      payload: buildApiErrorResponse(
        "no_exportable_shots",
        "没有可导出的已完成镜头",
      ),
    };
  }

  if (rawMessage.includes("Draft target path")) {
    return {
      status: 400,
      payload: buildApiErrorResponse("validation_error", "请求验证失败", [
        { field: "draftPath", message: translateDraftTargetPathError(rawMessage) },
      ]),
    };
  }

  return {
    status: 500,
    payload: buildApiErrorResponse(
      "export_failed",
      isZipOnly ? "视频打包失败" : "剪映草稿导出失败",
    ),
  };
}

// GET .../jianying-draft  -> 返回 manifest.draftExport
// GET .../jianying-draft/download-zip -> res.download(zipPath) 并校验路径落在 draft-export 下
// POST .../jianying-draft -> 调用 jianyingDraftExportService.exportDraft({ manifest, baseDir, draftPath, createZip })
*/

module.exports = {
  // 将上述函数复制到你的路由文件后实现具体 handler
};
