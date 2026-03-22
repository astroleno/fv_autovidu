/**
 * =============================================================================
 * UGCFlow 剪映草稿导出 + ElevenLabs（含 STS）统一接入入口
 * =============================================================================
 *
 * 【设计目的】
 * - 为第三方脚本、自动化或文档提供「单一入口」，从本文件即可 require 到
 *   与线上一致的后端实现（`server/services/jianyingDraftExportService.js`、
 *   `server/services/elevenLabsService.js`）。
 * - 不在此文件内复制业务逻辑，避免与主仓库分叉；仅做路径解析与聚合导出。
 *
 * 【使用前提】
 * - 从 UGCFlow 仓库根目录运行 Node，或保证 `__dirname` 相对路径能解析到
 *   `server/services/`，否则请改用 HTTP API（见同目录 README.md）。
 * - ElevenLabs 需配置环境变量（见 README）。
 *
 * 【示例】
 * ```js
 * const { jianying, elevenLabs } = require('./packages/ugc-export-integrations');
 * const { exportDraft } = jianying;
 * const { speechToSpeech, isConfigured } = elevenLabs;
 * ```
 *
 * @module @ugcflow/export-integrations
 */

"use strict";

const path = require("path");

/**
 * 仓库根目录（假定本包位于 `packages/ugc-export-integrations/`）
 * @type {string}
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * 解析 server 下服务模块的绝对路径
 * @param {string} relativeFromServer - 例如 `services/jianyingDraftExportService.js`
 * @returns {string}
 */
function resolveServerModule(relativeFromServer) {
  return path.join(REPO_ROOT, "server", relativeFromServer);
}

// ---------------------------------------------------------------------------
// ElevenLabs：STS / TTS / Voice Design / 音色列表（依赖 server/config 环境变量）
// 优先同步加载：体量小、无重依赖，适合仅做 STS 的脚本
// ---------------------------------------------------------------------------

/**
 * ElevenLabs 服务（含 STS speech-to-speech）
 *
 * 主要导出：
 * - `speechToSpeech(voiceId, audioBuffer, options?)`
 * - `textToSpeech`, `designVoice`, `createVoiceFromPreview`, `listVoices`, `deleteVoice`
 * - `isConfigured()`, `ELEVENLABS_CONFIG_ERROR`
 */
const elevenLabsService = require(
  resolveServerModule("services/elevenLabsService.js"),
);

// ---------------------------------------------------------------------------
// 剪映草稿：懒加载（顶层 require 会拉取 DB 等重依赖，可能阻塞数秒）
// 仅在访问 jianying / jianyingDraftExportService / INTEGRATION.jianyingExportMode 时加载
// ---------------------------------------------------------------------------

/** @type {import('./types').JianyingDraftExportServiceModule | null} */
let _jianyingDraftExportServiceCache = null;

/**
 * 加载剪映草稿导出服务（单例缓存）
 * @returns {import('./types').JianyingDraftExportServiceModule}
 */
function loadJianyingDraftExportService() {
  if (!_jianyingDraftExportServiceCache) {
    _jianyingDraftExportServiceCache = require(
      resolveServerModule("services/jianyingDraftExportService.js"),
    );
  }
  return _jianyingDraftExportServiceCache;
}

/**
 * 集成元数据（便于客户端记录版本）
 * `jianyingExportMode` 为 getter，避免在仅使用 ElevenLabs 时强制加载剪映模块
 */
const INTEGRATION = {
  /** 固定标识，用于日志或遥测 */
  id: "ugc-export-integrations",
  /** 与本 package.json 版本对齐，升级时请同步修改 */
  version: "1.0.0",
  /** 剪映导出模式常量（首次访问时加载 jianying 服务） */
  get jianyingExportMode() {
    return loadJianyingDraftExportService().EXPORT_MODE;
  },
};

module.exports = {
  INTEGRATION,
  /** 仓库根路径，供调试或自定义路径拼接 */
  REPO_ROOT,
  /** 懒加载：首次访问时 require 剪映服务 */
  get jianying() {
    return loadJianyingDraftExportService();
  },
  elevenLabs: elevenLabsService,
  /** 懒加载，同 `jianying` */
  get jianyingDraftExportService() {
    return loadJianyingDraftExportService();
  },
  /**
   * 兼容旧命名：与 `elevenLabs` 指向同一对象
   */
  elevenLabsService,
};
