#!/usr/bin/env node
/**
 * Stage 0 · ScriptNormalizer v1 调度器（stub · Phase 1）。
 *
 * 职责：
 *   - 读取 `edit_map_input.json`（与 EditMap 共用，契约见 prepare_editmap_input.mjs）；
 *   - 以 `prompt/1_SD2Workflow/0_ScriptNormalizer/ScriptNormalizer-v1.md` 为 system prompt；
 *   - 调用 LLM 产出 `normalizedScriptPackage.json`（契约见 docs/stage0-normalizer/01_schema.json）；
 *   - 写入 `--output` 指定路径；上游由 run_sd2_pipeline.mjs 透传给 EditMap v5
 *     的 `--normalized-package` 参数。
 *   - 默认走 DashScope（lib/llm_client · SD2_LLM_MODEL，如 qwen-plus），与 EditMap 云雾 Opus 解耦。
 *     编排层默认不传 `--yunwu`；若需 Stage 0 也走云雾，设 env SD2_NORMALIZER_USE_YUNWU=1 且流水线带 --yunwu。
 *
 * Phase 1 红线（00 计划 §五）：
 *   - 不引入严格 schema 校验（Phase 1.5 再加）；LLM 输出只做最小存在性检查；
 *   - 任何失败都以 **非零 exit** 结束；上游捕获后按"Stage 0 失败兜底"跳过（EditMap 按原 v5 跑）；
 *   - 不修改 edit_map_input.json，也不污染任何下游契约；Stage 0 的产物是**附加输入**。
 *
 * 用法：
 *   node scripts/sd2_pipeline/call_script_normalizer_v1.mjs \
 *     --input  output/sd2/<id>/edit_map_input.json \
 *     --output output/sd2/<id>/normalized_script_package.json \
 *     [--prompt-file /custom/ScriptNormalizer-v1.md] \
 *     [--yunwu]       # 可选：走云雾 OpenAI 兼容 API（默认走 DashScope llm_client）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash } from 'crypto';

import {
  callLLM,
  getResolvedLlmBaseUrl,
  getResolvedLlmModel,
  parseJsonFromModelText,
} from './lib/llm_client.mjs';
import {
  callYunwuChatCompletions,
  getYunwuResolvedDefaults,
} from './lib/yunwu_chat.mjs';
import { getScriptNormalizerV1PromptPath } from './lib/sd2_prompt_paths_v5.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_TAG = 'call_script_normalizer_v1';

/**
 * 解析轻量 `--key value` / `--flag` 形式的 CLI 参数。
 *
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * 从 edit_map_input.json 抽出 Stage 0 所需白名单字段。
 * 为什么要白名单：00 计划 §附录 A.2 明确要求 input_echo 只包含以下字段，
 * 避免把 CLI 风格字段（renderingStyle / artStyle 等）污染进 Stage 0 的输入回显。
 *
 * @param {Record<string, unknown>} src
 * @returns {Record<string, unknown>}
 */
function extractNormalizerInput(src) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of [
    'globalSynopsis',
    'scriptContent',
    'assetManifest',
    'referenceAssets',
    'episodeDuration',
    'shotHint',
    'motionBias',
    'genre',
    'targetBlockCount',
    'avgShotDuration',
    'workflowControls',
  ]) {
    if (key in src) {
      out[key] = src[key];
    }
  }
  return out;
}

/**
 * 以 scriptContent 为主、其余为辅，生成 source_script_hash（8 位 sha256 前缀）。
 * 为什么只取前 8 位：人眼可读、冲突率对 Phase 1 足够低；
 * Phase 2 引入 schema 校验后会切到完整 sha256。
 *
 * @param {Record<string, unknown>} input
 * @returns {string}
 */
function computeSourceHash(input) {
  const payload = JSON.stringify({
    scriptContent: input.scriptContent ?? '',
    globalSynopsis: input.globalSynopsis ?? '',
    episodeDuration: input.episodeDuration ?? null,
  });
  const h = createHash('sha256').update(payload).digest('hex');
  return h.slice(0, 8);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const inputPath =
    typeof args.input === 'string' ? path.resolve(process.cwd(), args.input) : '';
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error(`[${SCRIPT_TAG}] 请指定有效 --input edit_map_input.json`);
    process.exit(2);
  }

  const outPath =
    typeof args.output === 'string'
      ? path.resolve(process.cwd(), args.output)
      : path.join(path.dirname(inputPath), 'normalized_script_package.json');

  const promptPath =
    typeof args['prompt-file'] === 'string'
      ? path.resolve(process.cwd(), args['prompt-file'])
      : getScriptNormalizerV1PromptPath();

  if (!fs.existsSync(promptPath)) {
    console.error(
      `[${SCRIPT_TAG}] ScriptNormalizer-v1.md 不存在：${promptPath}\n` +
        '请从 feeling_video_prompt 同步 prompt/1_SD2Workflow/0_ScriptNormalizer/',
    );
    process.exit(3);
  }

  const systemPrompt = fs.readFileSync(promptPath, 'utf8');
  const rawInput = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!rawInput || typeof rawInput !== 'object') {
    console.error(`[${SCRIPT_TAG}] --input 不是合法 JSON 对象`);
    process.exit(2);
  }
  const inputEcho = extractNormalizerInput(
    /** @type {Record<string, unknown>} */ (rawInput),
  );

  const sourceHash = computeSourceHash(inputEcho);
  const packageId = `normpkg-${sourceHash}-${Date.now().toString(36)}`;

  /**
   * Phase 1 mode 判定：
   *   - 有 scriptContent → 'loose'（宽松模式，按剧本松紧度自适应，计算 tightness_score）；
   *   - 只有 globalSynopsis / 无剧本正文 → 'strict'（严格模式，禁止自行发明节拍）；
   *   - 详见 00 计划 §七。
   * 这里把 mode 塞进 user message 交给 LLM，最终写入 package 的 mode 字段。
   */
  const mode =
    typeof inputEcho.scriptContent === 'string' &&
    inputEcho.scriptContent.trim().length > 0
      ? 'loose'
      : 'strict';

  const userMessage = [
    '你是 SD2 Stage 0 · ScriptNormalizer。请严格按系统提示输出唯一一个 JSON 对象',
    '（符合 `normalizedScriptPackage` 契约），不要 Markdown 围栏。',
    '',
    `输入 hash: ${sourceHash}`,
    `package_id 建议: ${packageId}`,
    `mode 建议: ${mode}（Phase 1：loose=有 scriptContent；strict=仅总纲）`,
    '',
    '【输入 JSON】',
    JSON.stringify(inputEcho, null, 2),
  ].join('\n');

  const useYunwu = Boolean(args.yunwu);
  let raw = '';
  try {
    if (useYunwu) {
      const defaults = getYunwuResolvedDefaults();
      /**
       * v5.0 HOTFIX · H5：Stage 0 默认模型锁定到 claude-opus-4-6-thinking。
       *   起因：Yunwu 侧 claude-opus-4-7 在 2026-04 之后出现配额/可用性波动
       *   （v5d 日志里出现 HTTP 429 model_not_found），为避免 Stage 0 成为最脆弱的一环，
       *   优先级：`--model` CLI 覆盖 > `SD2_NORMALIZER_MODEL` 环境变量 > 硬编码 4.6 > Yunwu defaults。
       *   如需回到 4.7，请显式 `--model claude-opus-4-7-thinking`。
       */
      const modelOverride =
        typeof args.model === 'string'
          ? args.model
          : typeof process.env.SD2_NORMALIZER_MODEL === 'string' && process.env.SD2_NORMALIZER_MODEL.trim().length > 0
            ? process.env.SD2_NORMALIZER_MODEL.trim()
            : 'claude-opus-4-6-thinking';
      const noThinking = args['no-thinking'] === true;
      console.log(
        `[${SCRIPT_TAG}] 云雾 LLM：model=${modelOverride} (defaults.model=${defaults.model}) base=${defaults.baseUrl} thinking=${!noThinking}`,
      );
      raw = await callYunwuChatCompletions({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        model: modelOverride,
        temperature: 0.1,
        jsonObject: true,
        enableThinking: !noThinking,
        maxTokens: Math.max(
          16384,
          parseInt(process.env.YUNWU_NORMALIZER_MAX_TOKENS || '65536', 10),
        ),
      });
    } else {
      console.log(
        `[${SCRIPT_TAG}] 调用 LLM：model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()}`,
      );
      raw = await callLLM({
        systemPrompt,
        userMessage,
        temperature: 0.1,
        jsonObject: true,
      });
    }
  } catch (err) {
    console.error(
      `[${SCRIPT_TAG}] Stage 0 LLM 调用失败（上游按 Phase 1 兜底跳过）：`,
      err instanceof Error ? err.message : err,
    );
    process.exit(4);
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = parseJsonFromModelText(raw);
  } catch (err) {
    console.error(`[${SCRIPT_TAG}] JSON 解析失败，原始前 800 字：`);
    console.error(raw.slice(0, 800));
    process.exit(5);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error(`[${SCRIPT_TAG}] LLM 输出不是合法 JSON 对象，放弃。`);
    process.exit(6);
  }

  /**
   * Phase 1 最小字段回填：
   *   - 若 LLM 漏写 package_id / source_script_hash / mode / input_echo，
   *     调度器补上这些 deterministic 字段，避免 schema 最小契约被破坏。
   *   - meta.schema_version / meta.generated_at 同理。
   * 这里**只补缺**、不覆盖 LLM 的产出（LLM 可能按 tightness 重新选择了 mode）。
   */
  const pkg = /** @type {Record<string, unknown>} */ (parsed);
  if (typeof pkg.package_id !== 'string' || !pkg.package_id) {
    pkg.package_id = packageId;
  }
  if (typeof pkg.source_script_hash !== 'string' || !pkg.source_script_hash) {
    pkg.source_script_hash = sourceHash;
  }
  if (typeof pkg.mode !== 'string') {
    pkg.mode = mode;
  }
  if (!pkg.input_echo || typeof pkg.input_echo !== 'object') {
    pkg.input_echo = inputEcho;
  }
  if (!pkg.meta || typeof pkg.meta !== 'object') {
    pkg.meta = {};
  }
  const metaObj = /** @type {Record<string, unknown>} */ (pkg.meta);
  if (typeof metaObj.schema_version !== 'string') {
    metaObj.schema_version = 'v1';
  }
  if (typeof metaObj.generated_at !== 'string') {
    metaObj.generated_at = new Date().toISOString();
  }

  /**
   * v5.0-rev6 · Stage 0 产出健康检查（不阻塞，只 warn）
   *
   * 实测（leji-v5k）：qwen-plus / gemini 级别的 LLM 在复杂剧本下可能出现 schema 漂移，
   * 典型症状：`beat_ledger` 丢失 / 只给一条、内容被错塞进 `scene_timeline[*]` 导致后者
   * 膨胀到 30K+ 字符，user prompt 被打到 50K+。此处做独立健康检查，把诊断塞到
   * `meta.health_warnings[]`，下游 `editmap_slices_v5.trimNormalizedPackageForEditMap`
   * 再做溢出兜底。**不做阻塞式 ajv 校验**（Phase 1 仍走弱约束，上游按兜底跳过即可）。
   */
  /** @type {Array<{code: string, severity: string, actual: unknown, message: string}>} */
  const healthWarnings = [];
  const beatLedger = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : null;
  if (!beatLedger || beatLedger.length === 0) {
    healthWarnings.push({
      code: 'beat_ledger_missing_or_empty',
      severity: 'warn',
      actual: { present: Array.isArray(pkg.beat_ledger), length: beatLedger ? beatLedger.length : null },
      message: 'Stage 0 LLM 未输出 beat_ledger 或为空，下游 EditMap 的段落提示会退化到 scriptContent 原文',
    });
  }
  const sceneTimeline = Array.isArray(pkg.scene_timeline) ? pkg.scene_timeline : null;
  if (sceneTimeline && sceneTimeline.length > 0) {
    const sceneSize = JSON.stringify(sceneTimeline).length;
    if (sceneSize > 10000) {
      healthWarnings.push({
        code: 'scene_timeline_suspiciously_large',
        severity: 'warn',
        actual: { size_bytes: sceneSize, entry_count: sceneTimeline.length },
        message: `scene_timeline 序列化后 ${sceneSize} 字节（> 10K），疑似 beat_ledger 内容被错塞到此处；下游 trim 会做兜底裁剪`,
      });
    }
  }
  if (healthWarnings.length > 0) {
    if (!Array.isArray(metaObj.health_warnings)) {
      metaObj.health_warnings = [];
    }
    /** @type {Array<unknown>} */
    const hwArr = /** @type {Array<unknown>} */ (metaObj.health_warnings);
    for (const w of healthWarnings) {
      hwArr.push(w);
      console.warn(`[${SCRIPT_TAG}] health warning · ${w.code}: ${w.message}`);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`[${SCRIPT_TAG}] 已写入 ${outPath}（package_id=${pkg.package_id}）`);
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error(`[${SCRIPT_TAG}]`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
