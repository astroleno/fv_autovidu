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
import { recomputeDialogueCharCountsInNormalizedPackage } from './lib/edit_map_v7_contract.mjs';
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
  /** @type {string[]} */
  const beatsWithEmptySegments = [];
  for (const beat of beatLedger) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    if (Array.isArray(b.key_visual_actions)) kvaTotal += b.key_visual_actions.length;
    if (Array.isArray(b.structure_hints)) structureHintTotal += b.structure_hints.length;
    const segs = Array.isArray(b.segments) ? b.segments : [];
    const rawExcerpt = typeof b.raw_excerpt === 'string' ? b.raw_excerpt.trim() : '';
    const beatId = typeof b.beat_id === 'string' ? b.beat_id : '';
    if (rawExcerpt && segs.length === 0 && beatId) {
      beatsWithEmptySegments.push(beatId);
    }
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
  if (beatsWithEmptySegments.length > 0) {
    out.push({
      code: 'beat_segments_empty_with_excerpt',
      severity: 'warn',
      actual: { beat_ids: beatsWithEmptySegments },
      message: `${beatsWithEmptySegments.length} 个 beat 的 raw_excerpt 非空但 segments 为空；下游 EditMap / Director 会丢失原文锚点`,
    });
  }

  return out;
}

/**
 * @param {Record<string, unknown>} pkg
 * @returns {Array<{ beatId: string, excerptPreview: string }>}
 */
function findBeatsNeedingSegmentRetry(pkg) {
  const beats = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : [];
  /** @type {Array<{ beatId: string, excerptPreview: string }>} */
  const out = [];
  for (const beat of beats) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    const beatId = typeof b.beat_id === 'string' ? b.beat_id : '';
    const rawExcerpt = typeof b.raw_excerpt === 'string' ? b.raw_excerpt.trim() : '';
    const segs = Array.isArray(b.segments) ? b.segments : [];
    if (beatId && rawExcerpt && segs.length === 0) {
      out.push({
        beatId,
        excerptPreview: rawExcerpt.slice(0, 120).replace(/\s+/g, ' '),
      });
    }
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeCoverageText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”"']/g, '')
    .trim();
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripBracketedText(text) {
  return String(text || '')
    .replace(/（[^（）]*）/g, '')
    .replace(/\([^()]*\)/g, '')
    .trim();
}

/**
 * 识别被错误标成 vo/dialogue 的纯音效提示。
 *
 * 典型误差：
 *   - `噔噔噔。（高跟鞋踩地面的声音）`
 *   - `咚咚咚。（敲门声）`
 * 这类内容不应进入对白硬门，否则下游会要求 Prompter 把 Foley 写进 [DIALOG]。
 *
 * @param {Record<string, unknown>} seg
 * @returns {boolean}
 */
function looksLikePureSoundCueSegment(seg) {
  const speaker = typeof seg.speaker === 'string' ? seg.speaker.trim() : '';
  if (speaker) return false;
  const text = typeof seg.text === 'string' ? seg.text.trim() : '';
  if (!text) return false;

  const hasSoundLexeme =
    /声音|声响|脚步声|高跟鞋|敲门声|铃声|电话铃|心跳声|呼吸声|回声|摩擦声|翻动声|轰鸣|嗡鸣|风声|雨声|水声/.test(
      text,
    );
  const stripped = stripBracketedText(text).replace(/[。！!？?，,、…\s]/g, '');
  const shortOnomatopoeia =
    stripped.length > 0 &&
    stripped.length <= 6 &&
    /^[噔咚啪哒嗒滴答叮铃嗡轰呼哈啊呀呜嗯哦诶欸嘭砰哐咔嚓哗啦莎唰咻噜]+$/.test(stripped);

  return hasSoundLexeme && (shortOnomatopoeia || stripped.length === 0);
}

/**
 * 把明显误标的纯音效段从对白类拉回 descriptive，并同步重算 beat_dialogue_char_count。
 *
 * @param {Record<string, unknown>} pkg
 * @returns {{ repaired_count: number, repaired_seg_ids: string[] }}
 */
function repairPureSoundCueSegments(pkg) {
  const beats = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : [];
  let repairedCount = 0;
  /** @type {string[]} */
  const repairedSegIds = [];

  for (const beat of beats) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    const segs = Array.isArray(b.segments) ? b.segments : [];
    let beatDialogueChars = 0;

    for (const seg of segs) {
      if (!seg || typeof seg !== 'object') continue;
      const s = /** @type {Record<string, unknown>} */ (seg);
      const type = typeof s.segment_type === 'string' ? s.segment_type : '';
      if ((type === 'dialogue' || type === 'monologue' || type === 'vo') && looksLikePureSoundCueSegment(s)) {
        s.segment_type = 'descriptive';
        s.dialogue_char_count = 0;
        repairedCount += 1;
        if (typeof s.seg_id === 'string' && s.seg_id.trim()) repairedSegIds.push(s.seg_id.trim());
      }
      const finalType = typeof s.segment_type === 'string' ? s.segment_type : '';
      if (finalType === 'dialogue' || finalType === 'monologue' || finalType === 'vo') {
        const chars = typeof s.dialogue_char_count === 'number' ? s.dialogue_char_count : 0;
        beatDialogueChars += chars;
      }
    }

    b.beat_dialogue_char_count = beatDialogueChars;
  }

  return { repaired_count: repairedCount, repaired_seg_ids: repairedSegIds };
}

/**
 * @param {string} scriptContent
 * @returns {{
 *   sceneHeaders: string[],
 *   cutMarkers: number,
 *   flashbackMarkers: number,
 *   flashbackEndMarkers: number,
 *   splitScreenMentions: number,
 *   expectedMinBeats: number,
 * }}
 */
function analyzeScriptStructure(scriptContent) {
  const lines = String(scriptContent || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sceneHeaders = lines.filter((line) => /^\d+-\d+/.test(line));
  const cutMarkers = lines.filter((line) => /^【?切镜】?$/i.test(line)).length;
  const flashbackMarkers = lines.filter((line) => /^【闪回】$/i.test(line)).length;
  const flashbackEndMarkers = lines.filter((line) => /^【闪回结束】$/i.test(line)).length;
  const splitScreenMentions = lines.filter((line) => /分屏|画面一分为二|定格/.test(line)).length;

  let expectedMinBeats = Math.max(sceneHeaders.length, 1);
  const hardBoundarySignals = cutMarkers + flashbackMarkers + flashbackEndMarkers;
  if (hardBoundarySignals >= 3) expectedMinBeats += 1;
  if (hardBoundarySignals >= 6 || (cutMarkers >= 2 && flashbackMarkers > 0)) {
    expectedMinBeats += 1;
  }
  expectedMinBeats = Math.min(expectedMinBeats, 8);

  return {
    sceneHeaders,
    cutMarkers,
    flashbackMarkers,
    flashbackEndMarkers,
    splitScreenMentions,
    expectedMinBeats,
  };
}

/**
 * @param {Record<string, unknown>} pkg
 * @param {string} scriptContent
 * @returns {{
 *   beatCount: number,
 *   expectedMinBeats: number,
 *   lowBeatCount: boolean,
 *   compressedBeats: Array<{ beatId: string, reason: string }>,
 * }}
 */
function assessStructureCoverage(pkg, scriptContent) {
  const beats = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : [];
  const structure = analyzeScriptStructure(scriptContent);
  /** @type {Array<{ beatId: string, reason: string }>} */
  const compressedBeats = [];
  for (const beat of beats) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    const beatId = typeof b.beat_id === 'string' ? b.beat_id : '';
    const rawExcerpt = typeof b.raw_excerpt === 'string' ? b.raw_excerpt.trim() : '';
    const segs = Array.isArray(b.segments) ? b.segments : [];
    if (!beatId || !rawExcerpt) continue;
    const markerCount = (rawExcerpt.match(/【切镜】|【闪回】|【闪回结束】|切镜/g) || []).length;
    const sceneHeaderCount = (rawExcerpt.match(/\d+-\d+/g) || []).length;
    if (segs.length === 0 && rawExcerpt.length > 80) {
      compressedBeats.push({ beatId, reason: 'raw_excerpt_non_empty_but_segments_empty' });
      continue;
    }
    if (segs.length <= 1 && rawExcerpt.length > 180 && (markerCount > 0 || sceneHeaderCount > 0)) {
      compressedBeats.push({ beatId, reason: 'long_excerpt_with_markers_but_too_few_segments' });
    }
  }
  return {
    beatCount: beats.length,
    expectedMinBeats: structure.expectedMinBeats,
    lowBeatCount: beats.length < structure.expectedMinBeats,
    compressedBeats,
  };
}

/**
 * 从原剧本尾部提取几条应当出现在 beat_ledger 中的尾部锚句。
 *
 * @param {string} scriptContent
 * @returns {string[]}
 */
function extractTailAnchors(scriptContent) {
  const lines = String(scriptContent || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^\d+-\d+/.test(line) &&
        !/^出场人物[:：]/.test(line) &&
        !/^办公室内$/.test(line) &&
        !/^[△【（(]/.test(line),
    )
    .filter((line) => line.length >= 10);
  return lines.slice(-5).map(normalizeCoverageText).filter(Boolean);
}

/**
 * @param {Record<string, unknown>} pkg
 * @param {string} scriptContent
 * @returns {string[]}
 */
function findMissingTailAnchors(pkg, scriptContent) {
  const anchors = extractTailAnchors(scriptContent);
  if (anchors.length === 0) return [];
  const beats = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : [];
  /** @type {string[]} */
  const haystackParts = [];
  for (const beat of beats) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    if (typeof b.raw_excerpt === 'string' && b.raw_excerpt.trim()) {
      haystackParts.push(b.raw_excerpt);
    }
    const segs = Array.isArray(b.segments) ? b.segments : [];
    for (const seg of segs) {
      if (!seg || typeof seg !== 'object') continue;
      const s = /** @type {Record<string, unknown>} */ (seg);
      if (typeof s.text === 'string' && s.text.trim()) {
        haystackParts.push(s.text);
      }
    }
  }
  const haystack = normalizeCoverageText(haystackParts.join('\n'));
  return anchors.filter((anchor) => !haystack.includes(anchor));
}

/**
 * @param {Record<string, unknown>} inputEcho
 * @param {string} sourceHash
 * @param {string} packageId
 * @param {string} mode
 * @param {string[]} extraNotes
 * @returns {string}
 */
function buildNormalizerUserMessage(inputEcho, sourceHash, packageId, mode, extraNotes = []) {
  const scriptStructure = analyzeScriptStructure(
    typeof inputEcho.scriptContent === 'string' ? inputEcho.scriptContent : '',
  );
  const lines = [
    '你是 SD2 Stage 0 · ScriptNormalizer v2。请严格按系统提示输出唯一一个 JSON 对象',
    '（符合 `normalizedScriptPackage v2` 契约，见 07_v6-schema-冻结.md §2），不要 Markdown 围栏。',
    '',
    '关键增量提醒（相对 v1）：',
    '  - 每个 beat 必须输出 `key_visual_actions[]`（KVA）与 `structure_hints[]`（可空数组）',
    '  - 每条 dialogue / monologue / vo 类 segment 必须计算 `dialogue_char_count`',
    '  - 若某个 beat 的 `raw_excerpt` 非空，则 `segments[]` 不得为空；必须按说话人切换 / 动作-对白切换 / 【切镜】/【闪回】等机械边界拆出 segment',
    '  - 若剧本显式标注了"（作者压缩：xxx）"之类注释，写入 `segments[].author_hint.shortened_text`',
    '  - `meta.genre_bias_inferred` 必填（enum 见 schema §2）',
    '',
    '机械结构先验（请显式遵守，不得把整场压成一个 beat 外壳）：',
    `  - 检测到场次头 ${scriptStructure.sceneHeaders.length} 个：${
      scriptStructure.sceneHeaders.length > 0 ? scriptStructure.sceneHeaders.join(' / ') : '无'
    }`,
    `  - 检测到结构标记：切镜=${scriptStructure.cutMarkers}，闪回=${scriptStructure.flashbackMarkers}，闪回结束=${scriptStructure.flashbackEndMarkers}，分屏/定格提示=${scriptStructure.splitScreenMentions}`,
    `  - 基于以上机械边界，beat_ledger 通常不应少于 ${scriptStructure.expectedMinBeats} 个 beat；每个场次头至少一个 beat，闪回必须单独成 beat`,
  ];
  if (extraNotes.length > 0) {
    lines.push('', '补充修正要求：', ...extraNotes);
  }
  lines.push(
    '',
    `输入 hash: ${sourceHash}`,
    `package_id 建议: ${packageId}`,
    `mode 建议: ${mode}（loose=有 scriptContent；strict=仅总纲）`,
    '',
    '【输入 JSON】',
    JSON.stringify(inputEcho, null, 2),
  );
  return lines.join('\n');
}

/**
 * @param {{
 *   useYunwu: boolean,
 *   systemPrompt: string,
 *   userMessage: string,
 *   args: Record<string, string | boolean>
 * }} params
 * @returns {Promise<string>}
 */
async function invokeNormalizerModel({ useYunwu, systemPrompt, userMessage, args, temperatureOverride }) {
  const temperature = typeof temperatureOverride === 'number' ? temperatureOverride : 0.1;
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
    return callYunwuChatCompletions({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      model: modelOverride,
      temperature,
      jsonObject: true,
      enableThinking: !noThinking,
      maxTokens: Math.max(
        16384,
        parseInt(process.env.YUNWU_NORMALIZER_MAX_TOKENS || '65536', 10),
      ),
    });
  }
  console.log(
    `[${SCRIPT_TAG}] 调用 LLM：model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()}`,
  );
  return callLLM({
    systemPrompt,
    userMessage,
    temperature,
    jsonObject: true,
  });
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

  const userMessage = buildNormalizerUserMessage(inputEcho, sourceHash, packageId, mode);

  const useYunwu = Boolean(args.yunwu);
  let raw = '';
  try {
    raw = await invokeNormalizerModel({
      useYunwu,
      systemPrompt,
      userMessage,
      args,
    });
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

  const segmentRetryBeats = findBeatsNeedingSegmentRetry(pkg);
  const scriptContentForCoverage =
    typeof inputEcho.scriptContent === 'string' ? inputEcho.scriptContent : '';
  const missingTailAnchors = findMissingTailAnchors(pkg, scriptContentForCoverage);
  const structureAudit = assessStructureCoverage(pkg, scriptContentForCoverage);
  if (
    segmentRetryBeats.length > 0 ||
    missingTailAnchors.length > 0 ||
    structureAudit.lowBeatCount ||
    structureAudit.compressedBeats.length > 0
  ) {
    const retryNotes = ['上一轮输出不完整，请重写整份 JSON。'];
    if (segmentRetryBeats.length > 0) {
      retryNotes.push(
        '以下 beat 的 `raw_excerpt` 非空，但 `segments[]` 被输出为空：',
        ...segmentRetryBeats.map(
          ({ beatId, excerptPreview }) => `  - ${beatId}: ${excerptPreview}`,
        ),
        '请确保每个非空 beat 都按机械边界完整列出 `segments[]`，不要把整段剧情只塞进 `raw_excerpt` 而不拆 segment。',
      );
    }
    if (missingTailAnchors.length > 0) {
      retryNotes.push(
        '当前 beat_ledger 没有覆盖剧本尾部关键内容，以下尾部锚句未出现在任何 raw_excerpt/segment 中：',
        ...missingTailAnchors.map((line) => `  - ${line}`),
        '请确保 beat_ledger 覆盖完整剧本，一直到最后一句对白和结尾定格为止。',
      );
    }
    if (structureAudit.lowBeatCount) {
      retryNotes.push(
        `当前 beat_ledger 只有 ${structureAudit.beatCount} 个 beat，但基于场次头/切镜/闪回等机械边界，通常不应少于 ${structureAudit.expectedMinBeats} 个 beat。`,
        '特别是不要把整个 `1-2副院长办公室` 场次压成一个 beat 外壳；门外偷听、办公室内出轨、闪回、挂电话后门外 OS、推门进入、离开后亲热/分屏定格，必须按机械边界拆开。',
      );
    }
    if (structureAudit.compressedBeats.length > 0) {
      retryNotes.push(
        '以下 beat 疑似被压扁：',
        ...structureAudit.compressedBeats.map(
          ({ beatId, reason }) => `  - ${beatId}: ${reason}`,
        ),
        '请把这些 beat 重拆，至少保证 scene 头 / 切镜 / 闪回 / 闪回结束 / 门外-门内切换不落在同一个空壳 beat 中。',
      );
    }
    console.warn(
      `[${SCRIPT_TAG}] 检测到 Stage 0 覆盖不完整（empty_segments=${segmentRetryBeats.length}, missing_tail_anchors=${missingTailAnchors.length}, low_beats=${structureAudit.lowBeatCount ? 1 : 0}, compressed_beats=${structureAudit.compressedBeats.length}），自动重试一次补齐。`,
    );
    try {
      const retryRaw = await invokeNormalizerModel({
        useYunwu,
        systemPrompt,
        userMessage: buildNormalizerUserMessage(
          inputEcho,
          sourceHash,
          packageId,
          mode,
          retryNotes,
        ),
        args,
        temperatureOverride: 0,
      });
      const retryParsed = parseJsonFromModelText(retryRaw);
      if (retryParsed && typeof retryParsed === 'object' && !Array.isArray(retryParsed)) {
        const retryPkg = /** @type {Record<string, unknown>} */ (retryParsed);
        const retryMissing = findBeatsNeedingSegmentRetry(retryPkg);
        const retryMissingTail = findMissingTailAnchors(
          retryPkg,
          scriptContentForCoverage,
        );
        const retryStructureAudit = assessStructureCoverage(
          retryPkg,
          scriptContentForCoverage,
        );
        const beforeScore =
          segmentRetryBeats.length +
          missingTailAnchors.length +
          (structureAudit.lowBeatCount ? 2 : 0) +
          structureAudit.compressedBeats.length;
        const afterScore =
          retryMissing.length +
          retryMissingTail.length +
          (retryStructureAudit.lowBeatCount ? 2 : 0) +
          retryStructureAudit.compressedBeats.length;
        if (afterScore < beforeScore) {
          console.log(
            `[${SCRIPT_TAG}] Stage 0 重试改善了完整性：score ${beforeScore} -> ${afterScore}（empty_segments ${segmentRetryBeats.length} -> ${retryMissing.length}; missing_tail ${missingTailAnchors.length} -> ${retryMissingTail.length}; beat_count ${structureAudit.beatCount} -> ${retryStructureAudit.beatCount}; compressed ${structureAudit.compressedBeats.length} -> ${retryStructureAudit.compressedBeats.length}）`,
          );
          parsed = retryParsed;
        } else {
          console.warn(
            `[${SCRIPT_TAG}] Stage 0 重试未改善完整性，保留首轮结果。`,
          );
        }
      }
    } catch (retryErr) {
      console.warn(
        `[${SCRIPT_TAG}] Stage 0 自动重试失败，保留首轮结果：${
          retryErr instanceof Error ? retryErr.message : String(retryErr)
        }`,
      );
    }
  }

  const finalPkg = /** @type {Record<string, unknown>} */ (parsed);
  if (typeof finalPkg.package_id !== 'string' || !finalPkg.package_id) {
    finalPkg.package_id = packageId;
  }
  if (typeof finalPkg.source_script_hash !== 'string' || !finalPkg.source_script_hash) {
    finalPkg.source_script_hash = sourceHash;
  }
  if (typeof finalPkg.mode !== 'string') {
    finalPkg.mode = mode;
  }
  if (!finalPkg.input_echo || typeof finalPkg.input_echo !== 'object') {
    finalPkg.input_echo = inputEcho;
  }
  if (!finalPkg.meta || typeof finalPkg.meta !== 'object') {
    finalPkg.meta = {};
  }
  const finalMetaObj = /** @type {Record<string, unknown>} */ (finalPkg.meta);
  if (typeof finalMetaObj.schema_version !== 'string') {
    finalMetaObj.schema_version = 'v2';
  }
  if (typeof finalMetaObj.generated_at !== 'string') {
    finalMetaObj.generated_at = new Date().toISOString();
  }

  const soundCueRepair = repairPureSoundCueSegments(finalPkg);
  if (soundCueRepair.repaired_count > 0) {
    console.warn(
      `[${SCRIPT_TAG}] 修正 ${soundCueRepair.repaired_count} 条被误标为对白类的纯音效 segment：${soundCueRepair.repaired_seg_ids.join(', ')}`,
    );
  }
  const dialogueCountReport = recomputeDialogueCharCountsInNormalizedPackage(finalPkg);
  if (dialogueCountReport.corrected_segments.length > 0) {
    console.warn(
      `[${SCRIPT_TAG}] 重算 dialogue_char_count 并修正 ${dialogueCountReport.corrected_segments.length} 条 segment（LLM 原值已移入 debug）。`,
    );
  }

  // ── v2 健康检查（含 KVA / structure_hints / dialogue_char_count 统计）──
  const healthWarnings = buildHealthWarningsV2(finalPkg);
  if (healthWarnings.length > 0) {
    if (!Array.isArray(finalMetaObj.health_warnings)) {
      finalMetaObj.health_warnings = [];
    }
    const hwArr = /** @type {Array<unknown>} */ (finalMetaObj.health_warnings);
    for (const w of healthWarnings) {
      hwArr.push(w);
      console.warn(`[${SCRIPT_TAG}] health ${w.severity} · ${w.code}: ${w.message}`);
    }
  }
  if (soundCueRepair.repaired_count > 0) {
    if (!Array.isArray(finalMetaObj.health_warnings)) {
      finalMetaObj.health_warnings = [];
    }
    /** @type {Array<unknown>} */ (finalMetaObj.health_warnings).push({
      code: 'pure_sound_cue_segment_retyped',
      severity: 'info',
      actual: {
        repaired_count: soundCueRepair.repaired_count,
        seg_ids: soundCueRepair.repaired_seg_ids,
      },
      message:
        '检测到被误标成对白类的纯音效段，已在调度器侧重写为 descriptive 以避免下游对白硬门误判。',
    });
  }
  if (dialogueCountReport.corrected_segments.length > 0) {
    if (!Array.isArray(finalMetaObj.health_warnings)) {
      finalMetaObj.health_warnings = [];
    }
    /** @type {Array<unknown>} */ (finalMetaObj.health_warnings).push({
      code: 'dialogue_char_count_recomputed',
      severity: 'info',
      actual: dialogueCountReport,
      message:
        'dialogue_char_count 已由编排层按 deterministic 口径重算；LLM 原值只保留在 segment.debug。',
    });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(finalPkg, null, 2) + '\n', 'utf8');
  console.log(
    `[${SCRIPT_TAG}] 已写入 ${outPath}（package_id=${finalPkg.package_id}, schema_version=${finalMetaObj.schema_version}）`,
  );
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error(`[${SCRIPT_TAG}]`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
