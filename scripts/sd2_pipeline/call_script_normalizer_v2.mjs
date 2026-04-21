#!/usr/bin/env node
/**
 * Stage 0 · ScriptNormalizer v2 调度器（v6 配套）。
 *
 * 与 v1 的差异（职责层面）：
 *   - system prompt 切到 `ScriptNormalizer-v2.md`（v6 升级版）；
 *   - 产出 `normalizedScriptPackage v2`，新增字段：
 *       · beat_ledger[].key_visual_actions[]  （KVA · 关键视觉动作）
 *       · beat_ledger[].structure_hints[]     （高亮结构提示：split_screen / montage / freeze_frame 等）
 *       · beat_ledger[].segments[].dialogue_char_count（对白字数，Prompter 硬门源数据）
 *       · beat_ledger[].segments[].author_hint.shortened_text（作者授权的对白压缩）
 *       · meta.genre_bias_inferred            （体裁偏向推断，供 EditMap v6 的 style_inference 参考）
 *   - meta.schema_version = 'v2'（下游按 schema_version 做版本分流）；
 *   - 健康检查追加 KVA / structure_hints 计数（不阻塞，只 warn）。
 *
 * 与 v1 完全保留的：
 *   - 调度器 IO 契约：`--input edit_map_input.json` / `--output normalized_script_package.json`；
 *   - Phase 1 红线：LLM 失败非零 exit，上游按"Stage 0 失败兜底"跳过；
 *   - mode 判定（loose / strict）与 source_script_hash 计算方式；
 *   - 默认走 DashScope；`--yunwu` 切云雾；Stage 0 专用 model 优先级同 v1。
 *
 * 契约源：
 *   - `prompt/1_SD2Workflow/0_ScriptNormalizer/ScriptNormalizer-v2.md`
 *   - `prompt/1_SD2Workflow/docs/v6/07_v6-schema-冻结.md` §2 （Normalizer v2 schema）
 *   - `prompt/1_SD2Workflow/docs/v6/02_v6-对白保真与beat硬锚.md`  author_hint / dialogue_char_count
 *   - `prompt/1_SD2Workflow/docs/v6/04_v6-并发链路剧本透传.md`    KVA / structure_hints 用法
 *
 * 用法（与 v1 等价，只是 prompt 文件不同）：
 *   node scripts/sd2_pipeline/call_script_normalizer_v2.mjs \
 *     --input  output/sd2/<id>/edit_map_input.json \
 *     --output output/sd2/<id>/normalized_script_package.json \
 *     [--prompt-file /custom/ScriptNormalizer-v2.md] \
 *     [--yunwu]  [--model claude-opus-4-7-thinking]  [--no-thinking]
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
import { getScriptNormalizerV2PromptPath } from './lib/sd2_prompt_paths_v6.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_TAG = 'call_script_normalizer_v2';

/**
 * 解析 `--key value` / `--flag` 形式的 CLI 参数（与 v1 等价）。
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
 * 从 `edit_map_input.json` 白名单挑出 Stage 0 所需字段（与 v1 等价）。
 *
 * 00 计划 §附录 A.2 的白名单在 v2 下不变 —— v6 的增量字段由 LLM 自行推断，
 * 不需要额外的输入字段（meta.genre_bias_inferred 从 scriptContent + genre 计算）。
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
 * 以 scriptContent 为主生成 source_script_hash（与 v1 完全一致，保证 v5 / v6 并行
 * 同一份 edit_map_input.json 时 hash 相同）。
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

/**
 * v2 专属健康检查：
 *   - beat_ledger 缺失 / 为空
 *   - scene_timeline 体积异常（疑似 beat_ledger 错塞）
 *   - KVA 全剧本为 0 条（v6 下极不正常：EditMap 节奏推断会全链路退化）
 *   - structure_hints 全剧本为 0 条（softer warning：有些剧本确实没有高亮结构）
 *   - dialogue segment 缺 dialogue_char_count（v6 Prompter 硬门源数据）
 *
 * @param {Record<string, unknown>} pkg
 * @returns {Array<{ code: string, severity: 'warn'|'info', actual: unknown, message: string }>}
 */
function buildHealthWarningsV2(pkg) {
  /** @type {Array<{ code: string, severity: 'warn'|'info', actual: unknown, message: string }>} */
  const out = [];

  const beatLedger = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : null;
  if (!beatLedger || beatLedger.length === 0) {
    out.push({
      code: 'beat_ledger_missing_or_empty',
      severity: 'warn',
      actual: {
        present: Array.isArray(pkg.beat_ledger),
        length: beatLedger ? beatLedger.length : null,
      },
      message:
        'Stage 0 LLM 未输出 beat_ledger 或为空，下游 EditMap v6 的 KVA / 节奏 / segment_coverage 全部退化',
    });
    return out;
  }

  const sceneTimeline = Array.isArray(pkg.scene_timeline) ? pkg.scene_timeline : null;
  if (sceneTimeline && sceneTimeline.length > 0) {
    const sceneSize = JSON.stringify(sceneTimeline).length;
    if (sceneSize > 10000) {
      out.push({
        code: 'scene_timeline_suspiciously_large',
        severity: 'warn',
        actual: { size_bytes: sceneSize, entry_count: sceneTimeline.length },
        message: `scene_timeline 序列化后 ${sceneSize} 字节（> 10K），疑似 beat_ledger 内容被错塞到此处；下游 trim 会做兜底裁剪`,
      });
    }
  }

  let kvaTotal = 0;
  let structureHintTotal = 0;
  let dialogueTotal = 0;
  let dialogueMissingCharCount = 0;
  for (const beat of beatLedger) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    if (Array.isArray(b.key_visual_actions)) kvaTotal += b.key_visual_actions.length;
    if (Array.isArray(b.structure_hints)) structureHintTotal += b.structure_hints.length;
    const segs = Array.isArray(b.segments) ? b.segments : [];
    for (const seg of segs) {
      if (!seg || typeof seg !== 'object') continue;
      const s = /** @type {Record<string, unknown>} */ (seg);
      const type = typeof s.segment_type === 'string' ? s.segment_type : '';
      if (type === 'dialogue' || type === 'monologue' || type === 'vo') {
        dialogueTotal += 1;
        if (typeof s.dialogue_char_count !== 'number') {
          dialogueMissingCharCount += 1;
        }
      }
    }
  }

  if (kvaTotal === 0) {
    out.push({
      code: 'kva_total_zero',
      severity: 'warn',
      actual: { kva_total: 0, beat_count: beatLedger.length },
      message:
        'Stage 0 v2 未输出任何 KVA（key_visual_actions），EditMap v6 的节奏模板匹配会退化为 filler',
    });
  }
  if (structureHintTotal === 0) {
    out.push({
      code: 'structure_hints_total_zero',
      severity: 'info',
      actual: { structure_hints_total: 0, beat_count: beatLedger.length },
      message:
        'Stage 0 v2 未输出任何 structure_hints（split_screen / montage / freeze_frame 等）——若剧本确实没有高亮结构，可忽略',
    });
  }
  if (dialogueTotal > 0 && dialogueMissingCharCount > 0) {
    out.push({
      code: 'dialogue_char_count_missing',
      severity: 'warn',
      actual: { missing: dialogueMissingCharCount, total_dialogue_segments: dialogueTotal },
      message: `${dialogueMissingCharCount}/${dialogueTotal} 条对白缺 dialogue_char_count，Prompter v6 的 dialogue_char_per_second_max 硬门无法严格校验`,
    });
  }

  return out;
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
      : getScriptNormalizerV2PromptPath();

  if (!fs.existsSync(promptPath)) {
    console.error(
      `[${SCRIPT_TAG}] ScriptNormalizer-v2.md 不存在：${promptPath}\n` +
        '请确认 v6 prompt 已同步到 prompt/1_SD2Workflow/0_ScriptNormalizer/',
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
  const packageId = `normpkg-v2-${sourceHash}-${Date.now().toString(36)}`;

  const mode =
    typeof inputEcho.scriptContent === 'string' &&
    inputEcho.scriptContent.trim().length > 0
      ? 'loose'
      : 'strict';

  const userMessage = [
    '你是 SD2 Stage 0 · ScriptNormalizer v2。请严格按系统提示输出唯一一个 JSON 对象',
    '（符合 `normalizedScriptPackage v2` 契约，见 07_v6-schema-冻结.md §2），不要 Markdown 围栏。',
    '',
    '关键增量提醒（相对 v1）：',
    '  - 每个 beat 必须输出 `key_visual_actions[]`（KVA）与 `structure_hints[]`（可空数组）',
    '  - 每条 dialogue / monologue / vo 类 segment 必须计算 `dialogue_char_count`',
    '  - 若剧本显式标注了"（作者压缩：xxx）"之类注释，写入 `segments[].author_hint.shortened_text`',
    '  - `meta.genre_bias_inferred` 必填（enum 见 schema §2）',
    '',
    `输入 hash: ${sourceHash}`,
    `package_id 建议: ${packageId}`,
    `mode 建议: ${mode}（loose=有 scriptContent；strict=仅总纲）`,
    '',
    '【输入 JSON】',
    JSON.stringify(inputEcho, null, 2),
  ].join('\n');

  const useYunwu = Boolean(args.yunwu);
  let raw = '';
  try {
    if (useYunwu) {
      const defaults = getYunwuResolvedDefaults();
      const modelOverride =
        typeof args.model === 'string'
          ? args.model
          : typeof process.env.SD2_NORMALIZER_MODEL === 'string' &&
              process.env.SD2_NORMALIZER_MODEL.trim().length > 0
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
      `[${SCRIPT_TAG}] Stage 0 LLM 调用失败（上游按兜底跳过）：`,
      err instanceof Error ? err.message : err,
    );
    process.exit(4);
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = parseJsonFromModelText(raw);
  } catch {
    console.error(`[${SCRIPT_TAG}] JSON 解析失败，原始前 800 字：`);
    console.error(raw.slice(0, 800));
    process.exit(5);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error(`[${SCRIPT_TAG}] LLM 输出不是合法 JSON 对象，放弃。`);
    process.exit(6);
  }

  /**
   * v2 最小字段回填（与 v1 语义一致，只是 schema_version 固定为 'v2'）：
   *   - package_id / source_script_hash / mode / input_echo / meta.schema_version /
   *     meta.generated_at —— 缺失时补，LLM 已给的不覆盖。
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
  // v2 强制 schema_version —— 用户可以通过 prompt 要求 LLM 自己写，此处保留 LLM 的值；
  // 但 LLM 未写时锁到 'v2'（而不是 v1）。
  if (typeof metaObj.schema_version !== 'string') {
    metaObj.schema_version = 'v2';
  }
  if (typeof metaObj.generated_at !== 'string') {
    metaObj.generated_at = new Date().toISOString();
  }

  // ── v2 健康检查（含 KVA / structure_hints / dialogue_char_count 统计）──
  const healthWarnings = buildHealthWarningsV2(pkg);
  if (healthWarnings.length > 0) {
    if (!Array.isArray(metaObj.health_warnings)) {
      metaObj.health_warnings = [];
    }
    const hwArr = /** @type {Array<unknown>} */ (metaObj.health_warnings);
    for (const w of healthWarnings) {
      hwArr.push(w);
      console.warn(`[${SCRIPT_TAG}] health ${w.severity} · ${w.code}: ${w.message}`);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(
    `[${SCRIPT_TAG}] 已写入 ${outPath}（package_id=${pkg.package_id}, schema_version=${metaObj.schema_version}）`,
  );
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error(`[${SCRIPT_TAG}]`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
