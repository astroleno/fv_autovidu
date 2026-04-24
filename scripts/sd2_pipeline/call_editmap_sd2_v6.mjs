#!/usr/bin/env node
/**
 * EditMap-SD2 v6 调度器：模型侧**默认**输出纯 Markdown，脚本编译为落盘的 `{ markdown_body, appendix }`（契约见
 * `1_EditMap-SD2-v6b.md` §八 / `docs/v6/07_v6-schema-冻结.md`）。
 *
 * 与 v5 的差异（仅限编排层）：
 *   1. system prompt 切到 `1_EditMap-SD2-v6.md`（delta 文档，内部引用 v5 原文）；
 *   2. editmap/ 静态挂载切片由 6 → 7（末尾追加 `v6_rhythm_templates.md`），token 硬限 14k；
 *   3. 新增 v6 软门（EditMap 层）：
 *        · segment_coverage_check.ratio ≥ 0.95（L1 软门，只 warn）
 *        · rhythm_timeline 基础结构校验（golden_open / major_climax / closing_hook 至少命中一项）
 *        · style_inference 三轴存在性校验（rendering_style / tone_bias / genre_bias 都要有值）
 *   4. v5.0 HOTFIX H1 的 maxBlock 校验：**软门**（超限时只 warn，仍落盘 + exit 0；见 normalize v3 与 diagnosis）。
 *
 * Stage 0 输入（必填 · v6 默认路径）：
 *   - `--normalized-package <path>` 指向 ScriptNormalizer v2 产物；
 *     缺失时按 v5 行为执行（v6 字段降级，但不阻塞 · 00 计划 §九 兜底契约）。
 *
 * 保留 v5 行为：
 *   - LLM 默认走 DashScope（`callLLM`）；编排层如需云雾，用 Yunwu 版调度器（v6 暂不实现）；
 *   - `--prompt-file` 可覆盖 system prompt 路径；
 *   - normalize 后处理（`normalizeEditMapSd2V5`）对 v6 字段不做修改（v5 级兜底）。
 *
 * 契约源：
 *   - `prompt/1_SD2Workflow/docs/v6/04_v6-并发链路剧本透传.md` §5.1.1（L1 ≥ 0.95 软门）
 *   - `prompt/1_SD2Workflow/docs/v6/07_v6-schema-冻结.md` §3.2/§3.3
 *
 * 用法：
 *   node scripts/sd2_pipeline/call_editmap_sd2_v6.mjs \
 *     --input  output/sd2/<id>/edit_map_input.json \
 *     --output output/sd2/<id>/edit_map_sd2.json \
 *     --normalized-package output/sd2/<id>/normalized_script_package.json
 *
 * **默认**产出：**纯 Markdown**（首行声明 + 三节结构，无 JSON/围栏；见 `lib/editmap_v6_pure_md.mjs`）。
 * 关纯 MD、改回**整段 JSON**（旧管线）：`--legacy-json-output` 或 `SD2_EDITMAP_LEGACY_JSON=1` 或 `SD2_EDITMAP_OUTPUT_PURE_MD=0`。
 * 与默认纯 MD 互斥的其它模态：
 *   - **MD + 文末 json 围栏**：`--md-appendix-output` 等（自动视为非纯 MD，无需再写 legacy）；
 *   - **整段长键/缩写键 JSON**：`--legacy-json-output` 或 `SD2_EDITMAP_ABBREV_JSON=1` 等，见同目录 lib。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import {
  callLLM,
  getResolvedLlmBaseUrl,
  getResolvedLlmModel,
  parseJsonFromModelText,
} from './lib/llm_client.mjs';
/** jsonrepair 仅用于 tryParse，与 llm_client 中 parseJsonFromModelText 的兜底一致。 */
import { jsonrepair } from 'jsonrepair';
import {
  callApimartChatCompletions,
  getApimartResolvedDefaults,
} from './lib/apimart_chat.mjs';
import {
  callApimartMessages,
  getApimartMessagesDefaults,
} from './lib/apimart_messages_chat.mjs';
import { applyArkEnvForSd2Pipeline } from './lib/doubao_ark_chat.mjs';
import {
  annotateNormalizerRef,
  estimateTokens,
  loadEditMapSlicesV6,
  loadNormalizedPackage,
  logEditMapSlicesSummaryV6,
  mergeNormalizedPackageIntoPayload,
} from './lib/editmap_slices_v6.mjs';
import { expandAbbrevEditMapKeys } from './lib/editmap_v6_abbrev_json.mjs';
import { detectEditMapPureMdMode } from './lib/editmap_pure_md_mode.mjs';
import { tryParseEditMapPureMd } from './lib/editmap_v6_pure_md.mjs';
import { compileEditMapV7LedgerPureMd } from './lib/editmap_v7_ledger_pure_md.mjs';
import { validateEditMapV7Canonical } from './lib/edit_map_v7_contract.mjs';
import { normalizeEditMapSd2V5 } from './lib/normalize_edit_map_sd2_v5.mjs';
import {
  getEditMapSd2V6PromptPath,
  getEditMapTranslatorPromptPath,
} from './lib/sd2_prompt_paths_v6.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_TAG =
  typeof process.env.EDITMAP_SCRIPT_TAG === 'string' &&
  process.env.EDITMAP_SCRIPT_TAG.trim().length > 0
    ? process.env.EDITMAP_SCRIPT_TAG.trim()
    : 'call_editmap_sd2_v6';

/**
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
 * 判断一段解析后的 JSON 是否像 v6 的 `appendix` 载荷（与围栏内两种合法形状对齐）。
 *
 * @param {unknown} j
 * @returns {j is Record<string, unknown>}
 */
function looksLikeAppendixJson(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  const o = /** @type {Record<string, unknown>} */ (j);
  if (o.appendix && typeof o.appendix === 'object' && !Array.isArray(o.appendix)) {
    return true;
  }
  if (Array.isArray(o.block_index)) return true;
  if (o.meta && typeof o.meta === 'object') return true;
  if (o.diagnosis && typeof o.diagnosis === 'object') return true;
  return false;
}

/**
 * 从围栏内字串解析 JSON，失败时尝试 jsonrepair（与 llm_client 一致）。
 *
 * @param {string} inner
 * @returns {unknown}
 */
function parseJsonFenceInner(inner) {
  const s = String(inner).trim();
  try {
    return JSON.parse(s);
  } catch {
    return JSON.parse(jsonrepair(s));
  }
}

/**
 * 从「Markdown 正文 + 文末 \`\`\`json …\`\`\` 仅含 appendix」的模型输出拼回
 * v6 契约：{ markdown_body, appendix }。正文**不再**放进 JSON 字符串，避免大段反斜杠/引号问题。
 *
 * 规则：取**最后一个**以 \`\`\`json 开头的围栏（大小写不敏感），其内为 JSON；
 * 支持 `{ "appendix": { … } }` 或扁平 `{ "meta", "block_index", "diagnosis" }`。
 *
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
function tryParseEditMapMdAppendixFence(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const re = /```json\s*([\s\S]*?)```/gi;
  let m;
  let lastOpenIdx = -1;
  let lastInner = '';
  while ((m = re.exec(text)) !== null) {
    lastOpenIdx = m.index;
    lastInner = m[1];
  }
  if (lastOpenIdx < 0 || !String(lastInner).trim()) {
    return null;
  }
  let parsed;
  try {
    parsed = parseJsonFenceInner(String(lastInner));
  } catch {
    return null;
  }
  if (!looksLikeAppendixJson(parsed)) {
    return null;
  }
  const p = /** @type {Record<string, unknown>} */ (parsed);
  /** @type {Record<string, unknown>} */
  let appendix;
  if (p.appendix && typeof p.appendix === 'object' && !Array.isArray(p.appendix)) {
    appendix = /** @type {Record<string, unknown>} */ (p.appendix);
  } else {
    appendix = p;
  }
  const mdSliceEnd = lastOpenIdx;
  const markdown_body = text.slice(0, mdSliceEnd).trim();
  return { markdown_body, appendix };
}

/**
 * 合并解析策略：md 模式优先尝试围栏；否则先整段 JSON，失败再试围栏兜底。
 *
 * @param {string} raw
 * @param {boolean} preferMdFence
 * @returns {Record<string, unknown>}
 */
function parseEditMapV6ModelOutput(raw, preferMdFence) {
  if (preferMdFence) {
    const fenced = tryParseEditMapMdAppendixFence(raw);
    if (fenced) {
      return fenced;
    }
  }
  try {
    const v = parseJsonFromModelText(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return /** @type {Record<string, unknown>} */ (v);
    }
    throw new Error('EditMap 顶层不是 JSON 对象');
  } catch (e) {
    if (!preferMdFence) {
      const fenced = tryParseEditMapMdAppendixFence(raw);
      if (fenced) {
        console.warn(
          `[${SCRIPT_TAG}] 整段 JSON 解析失败，已用「Markdown 正文 + 文末 json 代码块（仅 appendix）」兜底解析。`,
        );
        return fenced;
      }
    }
    throw e;
  }
}

/**
 * L2 Translator 输出解析：必须是 canonical EditMap JSON 对象。
 *
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
function parseEditMapTranslatorOutput(raw) {
  const v = parseJsonFromModelText(raw);
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('EditMap Translator 顶层不是 JSON 对象');
  }
  return /** @type {Record<string, unknown>} */ (v);
}

/**
 * HOTFIX D · 从 Stage 0 产物里抽取 segment universe（有序 seg_id 列表）。
 *
 * 口径（与 04_v6-并发链路.md §5.1.1 完全一致）：
 *   - 遍历 beat_ledger[].segments[].seg_id，按出场顺序去重；
 *   - tail_seg_id 取遍历到的最后一个 seg_id（时间轴上最后一场戏）；
 *   - 若 Stage 0 缺失 / 无 seg，返回空集合（下游按 'skip' 处理）。
 *
 * @param {unknown | null} normalizedPackage Stage 0 产物
 * @returns {{ ordered: string[], universe: Set<string>, tailSegId: string | null }}
 */
function computeSegmentUniverseFromPackage(normalizedPackage) {
  if (!normalizedPackage || typeof normalizedPackage !== 'object') {
    return { ordered: [], universe: new Set(), tailSegId: null };
  }
  const pkg = /** @type {Record<string, unknown>} */ (normalizedPackage);
  const ledger = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : [];
  /** @type {Set<string>} */
  const universe = new Set();
  /** @type {string[]} */
  const ordered = [];
  for (const beat of ledger) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    const segs = Array.isArray(b.segments) ? b.segments : [];
    for (const seg of segs) {
      if (!seg || typeof seg !== 'object') continue;
      const sid = /** @type {Record<string, unknown>} */ (seg).seg_id;
      if (typeof sid === 'string' && sid && !universe.has(sid)) {
        universe.add(sid);
        ordered.push(sid);
      }
    }
  }
  const tailSegId = ordered.length > 0 ? ordered[ordered.length - 1] : null;
  return { ordered, universe, tailSegId };
}

/**
 * 给 L2 translator 提供一个轻量的 beat→segment 权威上下文，避免它把 BT_xxx 直接落到
 * covered_segment_ids / lead_seg_id / tail_seg_id。
 *
 * @param {unknown | null} normalizedPackage
 * @returns {{
 *   ordered_segment_ids: string[],
 *   beat_to_segments: Record<string, string[]>,
 *   beats_with_zero_segments: string[],
 *   seg_to_beat: Record<string, string>
 * }}
 */
function buildNormalizedSegmentContext(normalizedPackage) {
  /** @type {Record<string, string[]>} */
  const beatToSegments = {};
  /** @type {Record<string, string>} */
  const segToBeat = {};
  /** @type {string[]} */
  const orderedSegmentIds = [];
  /** @type {string[]} */
  const beatsWithZeroSegments = [];
  if (!normalizedPackage || typeof normalizedPackage !== 'object') {
    return {
      ordered_segment_ids: orderedSegmentIds,
      beat_to_segments: beatToSegments,
      beats_with_zero_segments: beatsWithZeroSegments,
      seg_to_beat: segToBeat,
    };
  }
  const pkg = /** @type {Record<string, unknown>} */ (normalizedPackage);
  const ledger = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : [];
  for (const beat of ledger) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    const beatId = typeof b.beat_id === 'string' ? b.beat_id : '';
    if (!beatId) continue;
    const segs = Array.isArray(b.segments) ? b.segments : [];
    /** @type {string[]} */
    const ids = [];
    for (const seg of segs) {
      if (!seg || typeof seg !== 'object') continue;
      const sid = /** @type {Record<string, unknown>} */ (seg).seg_id;
      if (typeof sid === 'string' && sid) {
        ids.push(sid);
        segToBeat[sid] = beatId;
        orderedSegmentIds.push(sid);
      }
    }
    beatToSegments[beatId] = ids;
    if (ids.length === 0) {
      beatsWithZeroSegments.push(beatId);
    }
  }
  return {
    ordered_segment_ids: orderedSegmentIds,
    beat_to_segments: beatToSegments,
    beats_with_zero_segments: beatsWithZeroSegments,
    seg_to_beat: segToBeat,
  };
}

/**
 * v7 需要比 v5/v6 更细的 Stage 0 锚点：保留 beat_ledger 的 segments / KVA /
 * structure_hints，但继续裁掉 input_echo 与 segment/text 级大字段，避免 prompt 体积失控。
 *
 * @param {unknown} inputObj
 * @param {unknown | null} normalizedPackage
 * @returns {unknown}
 */
function mergeNormalizedPackageIntoPayloadForV7(inputObj, normalizedPackage) {
  if (!normalizedPackage || typeof normalizedPackage !== 'object' || Array.isArray(normalizedPackage)) {
    return inputObj;
  }
  const src = /** @type {Record<string, unknown>} */ (normalizedPackage);
  /** @type {Record<string, unknown>} */
  const pkg = {};
  for (const [key, val] of Object.entries(src)) {
    if (key === 'input_echo') continue;
    if (key === 'beat_ledger' && Array.isArray(val)) {
      pkg.beat_ledger = val.map((beat) => {
        if (!beat || typeof beat !== 'object' || Array.isArray(beat)) return beat;
        const b = /** @type {Record<string, unknown>} */ (beat);
        const segs = Array.isArray(b.segments) ? b.segments : [];
        const kvas = Array.isArray(b.key_visual_actions) ? b.key_visual_actions : [];
        const hints = Array.isArray(b.structure_hints) ? b.structure_hints : [];
        return {
          beat_id: b.beat_id,
          display_order: b.display_order,
          story_order: b.story_order,
          time_mode: b.time_mode,
          scene_id: b.scene_id,
          scene_name: b.scene_name,
          participants: b.participants,
          core_action: b.core_action,
          beat_type_hint: b.beat_type_hint,
          beat_dialogue_char_count: b.beat_dialogue_char_count,
          segments: segs.map((seg) => {
            if (!seg || typeof seg !== 'object' || Array.isArray(seg)) return seg;
            const s = /** @type {Record<string, unknown>} */ (seg);
            return {
              seg_id: s.seg_id,
              segment_type: s.segment_type,
              speaker: s.speaker,
              dialogue_char_count: s.dialogue_char_count,
            };
          }),
          key_visual_actions: kvas.map((kva) => {
            if (!kva || typeof kva !== 'object' || Array.isArray(kva)) return kva;
            const k = /** @type {Record<string, unknown>} */ (kva);
            return {
              kva_id: k.kva_id,
              source_seg_id: k.source_seg_id,
              action_type: k.action_type,
              priority: k.priority,
              required_shot_count_min: k.required_shot_count_min,
              required_structure_hints: k.required_structure_hints,
            };
          }),
          structure_hints: hints.map((hint) => {
            if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return hint;
            const h = /** @type {Record<string, unknown>} */ (hint);
            return {
              hint_id: h.hint_id,
              type: h.type,
              source_seg_id: h.source_seg_id,
              replaceable: h.replaceable,
            };
          }),
        };
      });
      continue;
    }
    pkg[key] = val;
  }
  if (inputObj && typeof inputObj === 'object' && !Array.isArray(inputObj)) {
    return { ...inputObj, __NORMALIZED_SCRIPT_PACKAGE__: pkg };
  }
  return { __INPUT__: inputObj, __NORMALIZED_SCRIPT_PACKAGE__: pkg };
}

/**
 * HOTFIX D · 从 EditMap 产物里抽取 covered_segment_ids 去重并集（过滤仅保留 universe 内）。
 *
 * @param {Record<string, unknown>} parsed
 * @param {Set<string>} universe
 * @returns {Set<string>}
 */
function collectCoveredSegmentIds(parsed, universe) {
  /** @type {Set<string>} */
  const covered = new Set();
  const appendix =
    parsed.appendix && typeof parsed.appendix === 'object'
      ? /** @type {Record<string, unknown>} */ (parsed.appendix)
      : {};
  const rows = Array.isArray(appendix.block_index) ? appendix.block_index : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const ids = Array.isArray(r.covered_segment_ids) ? r.covered_segment_ids : [];
    for (const sid of ids) {
      if (typeof sid === 'string' && sid && universe.has(sid)) {
        covered.add(sid);
      }
    }
  }
  return covered;
}

/**
 * HOTFIX G · 收集 EditMap 中**所有被引用的 seg_id**（不过滤 universe）。
 *
 * 动机：v6f 暴露出 LLM 会在 `appendix.block_index[].covered_segment_ids` 里伪造
 * 超出真实 Normalizer 范围的 seg_id（例：真实池只到 SEG_062，LLM 却自造
 * SEG_063–SEG_072）。`collectCoveredSegmentIds` 用 universe 过滤伪段，
 * 所以伪段不会影响 L1 计数——但**也不会触发任何警报**。
 *
 * 本函数**不做过滤**，把 `covered_segment_ids` + `must_cover_segment_ids` +
 * `script_chunk_hint.{lead_seg_id, tail_seg_id, must_cover_segment_ids}` 中所有
 * 字符串形态的 seg_id 都扫出来，供下游做"是否全部 ∈ universe"判定。
 *
 * @param {Record<string, unknown>} parsed
 * @returns {Set<string>}  所有被 EditMap 引用过的 seg_id
 */
function collectAllReferencedSegIds(parsed) {
  /** @type {Set<string>} */
  const referenced = new Set();
  const appendix =
    parsed.appendix && typeof parsed.appendix === 'object'
      ? /** @type {Record<string, unknown>} */ (parsed.appendix)
      : {};
  const rows = Array.isArray(appendix.block_index) ? appendix.block_index : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const arrays = [
      Array.isArray(r.covered_segment_ids) ? r.covered_segment_ids : [],
      Array.isArray(r.must_cover_segment_ids) ? r.must_cover_segment_ids : [],
    ];
    const hint =
      r.script_chunk_hint && typeof r.script_chunk_hint === 'object'
        ? /** @type {Record<string, unknown>} */ (r.script_chunk_hint)
        : null;
    if (hint) {
      if (typeof hint.lead_seg_id === 'string' && hint.lead_seg_id) {
        referenced.add(hint.lead_seg_id);
      }
      if (typeof hint.tail_seg_id === 'string' && hint.tail_seg_id) {
        referenced.add(hint.tail_seg_id);
      }
      if (Array.isArray(hint.must_cover_segment_ids)) {
        arrays.push(hint.must_cover_segment_ids);
      }
    }
    for (const arr of arrays) {
      for (const sid of arr) {
        if (typeof sid === 'string' && sid) referenced.add(sid);
      }
    }
  }
  return referenced;
}

/**
 * HOTFIX G · source_integrity_check：EditMap 引用的所有 seg_id 必须 ∈ Normalizer universe。
 *
 * 返回 status：
 *   - 'skip'：Stage 0 未挂载或 universe 为空
 *   - 'pass'：所有被引用的 seg_id 都在真实 universe 里
 *   - 'fail'：存在 seg_id ∉ universe（LLM 伪造），附带 `outOfUniverseIds`
 *
 * @param {Record<string, unknown>} parsed
 * @param {unknown | null} normalizedPackage
 * @returns {{ status: 'pass'|'fail'|'skip', outOfUniverseIds: string[], totalReferenced: number, reason: string }}
 */
function runSourceIntegrityCheck(parsed, normalizedPackage) {
  const { universe } = computeSegmentUniverseFromPackage(normalizedPackage);
  if (universe.size === 0) {
    return {
      status: 'skip',
      outOfUniverseIds: [],
      totalReferenced: 0,
      reason: 'no_universe_from_package',
    };
  }
  const referenced = collectAllReferencedSegIds(parsed);
  const outOfUniverse = [...referenced].filter((sid) => !universe.has(sid));
  outOfUniverse.sort();
  if (outOfUniverse.length === 0) {
    return {
      status: 'pass',
      outOfUniverseIds: [],
      totalReferenced: referenced.size,
      reason: 'all_ids_in_universe',
    };
  }
  return {
    status: 'fail',
    outOfUniverseIds: outOfUniverse,
    totalReferenced: referenced.size,
    reason: `fabricated seg_ids detected: ${outOfUniverse.slice(0, 8).join(',')}${outOfUniverse.length > 8 ? ',…' : ''}`,
  };
}

/**
 * v6 EditMap 层 segment_coverage_check · L1 阈值 ≥ 0.95。
 *
 * HOTFIX D（2026-04）：本检查默认**升级为硬门**（由调用层按 `--allow-v6-soft`
 * 降级为 warn）。Stage 0 未提供时保持 'skip'。
 *
 * @param {Record<string, unknown>} parsed      LLM 已解析的 EditMap 产物
 * @param {unknown | null} normalizedPackage    Stage 0 产物
 * @returns {{ ratio: number, covered: number, total: number, status: 'pass'|'fail'|'skip', missingIds: string[] }}
 */
function runSegmentCoverageL1Check(parsed, normalizedPackage) {
  const { ordered, universe } = computeSegmentUniverseFromPackage(normalizedPackage);
  const totalCount = universe.size;
  if (totalCount === 0) {
    return { ratio: 1, covered: 0, total: 0, status: 'skip', missingIds: [] };
  }

  const covered = collectCoveredSegmentIds(parsed, universe);
  const ratio = covered.size / totalCount;

  // 未命中 seg 列表，用于报告和 directorBrief 回注（截取前 12 条避免刷屏）
  const missing = ordered.filter((sid) => !covered.has(sid));

  return {
    ratio,
    covered: covered.size,
    total: totalCount,
    status: ratio >= 0.95 ? 'pass' : 'fail',
    missingIds: missing,
  };
}

/**
 * HOTFIX D · last_seg_covered_check：时间轴上最后一个 seg_id 必须被任一 block 覆盖。
 *
 * 动机（v6e_pass2 review 观察）：EditMap 经常只"送前半段"，后半场关键戏（撞破、
 * 怀孕反转、结尾钩子）被整段丢弃。单看 ratio ≥ 0.95 可能仍然漏掉关键尾段，
 * 因此追加一个"末段必进"的几何约束——在 closing_hook 落地前强制把 tail_seg
 * 塞进最后一个 block 的 covered_segment_ids。
 *
 * 返回 status：
 *   - 'skip'：Stage 0 缺失或无 seg（不适用）
 *   - 'pass'：tail_seg_id 被至少一个 block 覆盖
 *   - 'fail'：tail_seg_id 存在但未进任何 block.covered_segment_ids
 *
 * @param {Record<string, unknown>} parsed
 * @param {unknown | null} normalizedPackage
 * @returns {{ status: 'pass'|'fail'|'skip', tailSegId: string | null, reason: string }}
 */
function runLastSegCoveredCheck(parsed, normalizedPackage) {
  const { universe, tailSegId } = computeSegmentUniverseFromPackage(normalizedPackage);
  if (!tailSegId) {
    return { status: 'skip', tailSegId: null, reason: 'no_tail_seg_in_package' };
  }
  const covered = collectCoveredSegmentIds(parsed, universe);
  if (covered.has(tailSegId)) {
    return { status: 'pass', tailSegId, reason: 'covered_by_some_block' };
  }
  return {
    status: 'fail',
    tailSegId,
    reason: `tail_seg ${tailSegId} not found in any block.covered_segment_ids`,
  };
}

/**
 * HOTFIX D · 用 pipeline 真实算出的 ratio 覆盖 LLM 自报的
 * `diagnosis.segment_coverage_check` / `segment_coverage_ratio_estimated`
 * 字段（常见幻觉：LLM 自填 0.97，但 pipeline 实算 0.42）。
 *
 * 保留 LLM 原值到 `diagnosis.segment_coverage_ratio_llm_self_reported`
 * 字段下，便于回归审计。
 *
 * @param {Record<string, unknown>} parsed
 * @param {{ ratio: number, covered: number, total: number, status: string, missingIds: string[] }} segCheck
 * @param {{ status: string, tailSegId: string | null, reason: string }} tailCheck
 * @returns {void}
 */
function backfillDiagnosisAuthoritativeMetrics(parsed, segCheck, tailCheck) {
  if (!parsed || typeof parsed !== 'object') return;
  const appendix =
    parsed.appendix && typeof parsed.appendix === 'object'
      ? /** @type {Record<string, unknown>} */ (parsed.appendix)
      : null;
  if (!appendix) return;
  const diag =
    appendix.diagnosis && typeof appendix.diagnosis === 'object'
      ? /** @type {Record<string, unknown>} */ (appendix.diagnosis)
      : (appendix.diagnosis = {});
  const d = /** @type {Record<string, unknown>} */ (diag);

  // 留底 LLM 原值（仅首次回填时记录）
  if (d.segment_coverage_ratio_estimated !== undefined) {
    d.segment_coverage_ratio_llm_self_reported = d.segment_coverage_ratio_estimated;
  }
  if (d.segment_coverage_check !== undefined) {
    d.segment_coverage_check_llm_self_reported = d.segment_coverage_check;
  }

  // 覆盖：以 pipeline 算值为准
  d.segment_coverage_ratio_estimated = Number(segCheck.ratio.toFixed(3));
  d.segment_coverage_check = segCheck.status === 'pass';
  d.last_seg_covered_check = tailCheck.status === 'pass';
  d.pipeline_authoritative = true;
  d.pipeline_authoritative_note =
    'HOTFIX D · segment_coverage_* 与 last_seg_covered_check 由 pipeline 实算覆盖，LLM 自报字段另存 *_llm_self_reported。';
}

/**
 * HOTFIX F · 动态硬下限生成器：根据 segs_count 构造"镜头 / block / tail_seg"硬下限文案，
 * 追加到 userPayload.directorBrief 文末，覆盖 prepare_editmap_input 默认的"参考区间"软措辞。
 *
 * 公式（用户落地决策 2026-04-21）：
 *   - 镜头硬下限 = max(50, segs_count)         // 保 120s 快节奏的 ≥ 50 shots，或 1 shot/seg
 *   - Block 硬下限 = max(15, ceil(segs_count/4)) // 保 ≥ 15 blocks，或每 4 seg 1 block
 *   - tail_seg 硬约束：最后一个 seg_id 必须进最后一个 block.covered_segment_ids
 *
 * @param {number} segsCount
 * @param {string | null} tailSegId
 * @param {number} episodeDuration
 * @returns {string}  追加到 directorBrief 尾部的硬下限段落
 */
function composeDynamicHardFloorBrief(segsCount, tailSegId, episodeDuration) {
  const shotFloor = Math.max(50, segsCount);
  const blockFloor = Math.max(15, Math.ceil(segsCount / 4));
  const tailClause = tailSegId
    ? `最后一个 seg（${tailSegId}）必须进入最后一个 block.covered_segment_ids，否则流水线会用 last_seg_covered_check 硬门拦截。`
    : '';

  return [
    '──（HOTFIX F · pipeline 注入 · 最高优先级硬约束，覆盖上方"参考区间"软措辞）──',
    `本集目标：${episodeDuration} 秒 × 高密度快节奏；剧本共 ${segsCount} 个 segment。`,
    `【硬下限 · 镜头】shots.length ≥ ${shotFloor}（max(50, segs_count)）。达不到就继续拆，不要省略后半场。`,
    `【硬下限 · Block】blocks.length ≥ ${blockFloor}（max(15, ceil(segs_count/4))），且每块 4–16s（或 env SD2_MAX_BLOCK_DURATION_SEC）、总时长守恒。`,
    `【硬下限 · Segment 覆盖】⋃ covered_segment_ids ⊇ 全集 segs × 0.95，L1 覆盖率 < 0.95 → 硬门失败。`,
    tailClause,
    '如果剧本体量 > 目标时长，请通过"每 block 镜头数↑ + 每镜头时长↓"的方式压缩，而不是丢弃后半段 segment。',
    '禁止 LLM 自填 appendix.diagnosis.segment_coverage_check / segment_coverage_ratio_estimated，此两字段由 pipeline 回填（HOTFIX D）。',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * HOTFIX F · 把动态硬下限文案 append 到 userPayload.directorBrief 文末。
 *
 * @param {unknown} userPayload
 * @param {string} appendText
 * @returns {unknown}
 */
function appendHardFloorToDirectorBrief(userPayload, appendText) {
  if (!userPayload || typeof userPayload !== 'object' || Array.isArray(userPayload)) {
    return userPayload;
  }
  const payload = /** @type {Record<string, unknown>} */ (userPayload);
  const existing = typeof payload.directorBrief === 'string' ? payload.directorBrief : '';
  const patched = existing ? `${existing}\n\n${appendText}` : appendText;
  return { ...payload, directorBrief: patched };
}

/**
 * v6 EditMap 层软门：rhythm_timeline 基础结构校验。
 *
 * 只检查"存在性 + 受控词表"，不做 block_id 指向性校验（后者由 Director/Prompter 硬门接管）。
 *
 * @param {Record<string, unknown>} parsed
 * @returns {{ status: 'pass'|'fail'|'skip', missing: string[] }}
 */
function runRhythmTimelineShapeCheck(parsed) {
  const meta =
    parsed.meta && typeof parsed.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (parsed.meta)
      : null;
  if (!meta) {
    return { status: 'skip', missing: ['meta_missing'] };
  }
  const rt = meta.rhythm_timeline;
  if (!rt || typeof rt !== 'object') {
    return { status: 'fail', missing: ['meta.rhythm_timeline'] };
  }
  const r = /** @type {Record<string, unknown>} */ (rt);
  const missing = [];
  if (!r.golden_open_3s || typeof r.golden_open_3s !== 'object') {
    missing.push('golden_open_3s');
  }
  if (!Array.isArray(r.mini_climaxes) || r.mini_climaxes.length === 0) {
    missing.push('mini_climaxes');
  }
  if (!r.major_climax || typeof r.major_climax !== 'object') {
    missing.push('major_climax');
  }
  if (!r.closing_hook || typeof r.closing_hook !== 'object') {
    missing.push('closing_hook');
  }
  return { status: missing.length === 0 ? 'pass' : 'fail', missing };
}

/**
 * v6 EditMap 层软门：style_inference 三轴存在性。
 *
 * @param {Record<string, unknown>} parsed
 * @returns {{ status: 'pass'|'fail'|'skip', missing: string[] }}
 */
function runStyleInferenceShapeCheck(parsed) {
  const meta =
    parsed.meta && typeof parsed.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (parsed.meta)
      : null;
  if (!meta) {
    return { status: 'skip', missing: ['meta_missing'] };
  }
  const si = meta.style_inference;
  if (!si || typeof si !== 'object') {
    return { status: 'fail', missing: ['meta.style_inference'] };
  }
  const s = /** @type {Record<string, unknown>} */ (si);
  const missing = [];
  for (const axis of ['rendering_style', 'tone_bias', 'genre_bias']) {
    const v = s[axis];
    if (axis === 'genre_bias') {
      const ok =
        typeof v === 'string' ||
        (v &&
          typeof v === 'object' &&
          (typeof /** @type {Record<string, unknown>} */ (v).primary === 'string' ||
            typeof /** @type {Record<string, unknown>} */ (v).value === 'string'));
      if (!ok) {
        missing.push('meta.style_inference.genre_bias.primary');
      }
    } else if (
      !v ||
      typeof v !== 'object' ||
      typeof /** @type {Record<string, unknown>} */ (v).value !== 'string'
    ) {
      missing.push(`meta.style_inference.${axis}.value`);
    }
  }
  return { status: missing.length === 0 ? 'pass' : 'fail', missing };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath =
    typeof args.input === 'string' ? path.resolve(process.cwd(), args.input) : '';
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error(`[${SCRIPT_TAG}] 请指定有效 --input edit_map_input.json`);
    process.exit(2);
  }

  // ── HOTFIX D/G · v6 EditMap 硬门降级开关 ──
  //   - --allow-v6-soft：一键降级（所有 v6 硬门 → warn，保留审计轨迹）
  //   - --skip-editmap-coverage-hard：仅 segment_coverage L1 降级
  //   - --skip-last-seg-hard：仅 last_seg_covered_check 降级
  //   - --skip-source-integrity-hard：仅 source_integrity_check 降级（HOTFIX G）
  const allowV6Soft = args['allow-v6-soft'] === true;
  const skipCoverageHard = args['skip-editmap-coverage-hard'] === true || allowV6Soft;
  const skipLastSegHard = args['skip-last-seg-hard'] === true || allowV6Soft;
  const skipSourceIntegrityHard = args['skip-source-integrity-hard'] === true || allowV6Soft;

  const outPath =
    typeof args.output === 'string'
      ? path.resolve(process.cwd(), args.output)
      : path.join(path.dirname(inputPath), 'edit_map_sd2.json');

  const promptPath =
    typeof args['prompt-file'] === 'string'
      ? path.resolve(process.cwd(), args['prompt-file'])
      : getEditMapSd2V6PromptPath();

  if (!fs.existsSync(promptPath)) {
    console.error(`[${SCRIPT_TAG}] EditMap prompt 不存在：${promptPath}`);
    process.exit(3);
  }

  const basePrompt = fs.readFileSync(promptPath, 'utf8');
  const useLedgerPureMdV7Prompt =
    /<editmap\s+v7="ledger_pure_md"\s*\/>/i.test(basePrompt) ||
    /1_EditMap(?:-SD2)?-v7\.md$/i.test(promptPath);
  const translatorPromptPath =
    typeof args['translator-prompt-file'] === 'string'
      ? path.resolve(process.cwd(), args['translator-prompt-file'])
      : getEditMapTranslatorPromptPath();
  if (useLedgerPureMdV7Prompt && !fs.existsSync(translatorPromptPath)) {
    console.error(`[${SCRIPT_TAG}] EditMap Translator prompt 不存在：${translatorPromptPath}`);
    process.exit(3);
  }
  const translatorPrompt = useLedgerPureMdV7Prompt
    ? fs.readFileSync(translatorPromptPath, 'utf8')
    : '';

  const { text: slicesText, slices: sliceInfo } = loadEditMapSlicesV6();
  const systemPrompt = `${basePrompt}\n${slicesText}`;
  logEditMapSlicesSummaryV6(SCRIPT_TAG, sliceInfo, estimateTokens(basePrompt));

  const inputObj = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  const normalizedPackagePath =
    typeof args['normalized-package'] === 'string'
      ? path.resolve(process.cwd(), args['normalized-package'])
      : '';
  const normalizedPackage = normalizedPackagePath
    ? loadNormalizedPackage(normalizedPackagePath)
    : null;
  if (normalizedPackage) {
    console.log(
      `[${SCRIPT_TAG}] 已挂载 Stage 0 产物: ${normalizedPackagePath}（冲突以原文为准）`,
    );
  } else if (normalizedPackagePath) {
    console.log(
      `[${SCRIPT_TAG}] Stage 0 产物读取失败，v6 字段降级为 null: ${normalizedPackagePath}`,
    );
  } else {
    console.warn(
      `[${SCRIPT_TAG}] 未提供 --normalized-package，v6 KVA / structure_hints / scriptChunk 将降级为 null`,
    );
  }

  let userPayload = useLedgerPureMdV7Prompt
    ? mergeNormalizedPackageIntoPayloadForV7(inputObj, normalizedPackage)
    : mergeNormalizedPackageIntoPayload(inputObj, normalizedPackage);

  // ── HOTFIX F · 动态硬下限注入 ──
  //   v6 legacy JSON / v6b 链路仍保留原硬下限逻辑；
  //   v7 ledger pure_md 链路改回让上游模型自行判断 block / shot 密度，不再注入“至少 N block”。
  if (normalizedPackage && !useLedgerPureMdV7Prompt) {
    const { universe, tailSegId } = computeSegmentUniverseFromPackage(normalizedPackage);
    const segsCount = universe.size;
    if (segsCount > 0) {
      const episodeDuration =
        (inputObj && typeof inputObj === 'object' && !Array.isArray(inputObj) &&
          typeof /** @type {Record<string, unknown>} */ (inputObj).episodeDuration === 'number')
          ? /** @type {number} */ (/** @type {Record<string, unknown>} */ (inputObj).episodeDuration)
          : 120;
      const hardFloorText = composeDynamicHardFloorBrief(segsCount, tailSegId, episodeDuration);
      userPayload = appendHardFloorToDirectorBrief(userPayload, hardFloorText);
      console.log(
        `[${SCRIPT_TAG}] HOTFIX F · 动态硬下限已注入 directorBrief：shot≥${Math.max(50, segsCount)} / block≥${Math.max(15, Math.ceil(segsCount / 4))} / tail=${tailSegId || 'N/A'}`,
      );
    }
  } else if (normalizedPackage && useLedgerPureMdV7Prompt) {
    console.log(
      `[${SCRIPT_TAG}] v7 ledger pure_md：跳过 HOTFIX F 动态硬下限，block/shot 密度交由上游模型判断。`,
    );
  }

  const useMdAppendixWanted =
    args['md-appendix-output'] === true ||
    process.env.APIMART_EDITMAP_MD_APPENDIX === '1' ||
    process.env.SD2_EDITMAP_AB_TEST_MD === '1';
  // 默认纯 MD。关断方式：--legacy-json-output / LEGACY_JSON / OUTPUT_PURE_MD=0；**或**选用文末 json 围栏（与纯 MD 互斥）。
  const useLegacyJson =
    args['legacy-json-output'] === true ||
    process.env.SD2_EDITMAP_LEGACY_JSON === '1' ||
    process.env.SD2_EDITMAP_OUTPUT_PURE_MD === '0' ||
    useMdAppendixWanted;
  const usePureMd = !useLegacyJson;
  const useMdAppendix = useMdAppendixWanted;
  const useAbbrevJson =
    args['abbrev-json'] === true || process.env.SD2_EDITMAP_ABBREV_JSON === '1';
  if (usePureMd && useAbbrevJson) {
    console.warn(
      `[${SCRIPT_TAG}] 当前为默认纯 MD 模式，忽略 abbrev-json（整段 JSON 请用 --legacy-json-output）。`,
    );
  }

  /**
   * MD+appendix 围栏：已选时自动从默认纯 MD 切走；OpenAI 兼容与 DashScope 会关 json_object。
   */
  if (useMdAppendix) {
    const abTag =
      process.env.SD2_EDITMAP_AB_TEST_MD === '1' ? ' [A/B·文末 json 围栏·非纯 MD]' : '';
    console.log(
      `[${SCRIPT_TAG}] MD+appendix 围栏${abTag}：正文/JSON 分栏；` +
        'DashScope 与 APIMart OpenAI-compat 不请求 json_object',
    );
  }
  if (usePureMd) {
    console.log(
      `[${SCRIPT_TAG}] 纯 Markdown 模态：全文无 JSON；机读行仅在「# 分块机读」内；` +
        '不请求 response_format: json_object',
    );
  }

  const v6OutputHints = useLedgerPureMdV7Prompt
    ? [
        'v7 ledger 输出强提醒：',
        '  - 只输出 pure Markdown，不要 JSON、不要 appendix、不要 diagnosis verdict',
        '  - 必须保留并发下游需要的锚点：beats / covered / must / lead / tail / overflow / scene_run',
        '  - beats 只写 BT_xxx；covered / must / lead / tail 若存在 SEG_xxx 必须优先写 SEG_xxx',
        '  - Global / Block / Rhythm Ledger 是 authoritative；Narrative Notes 只能解释，不能改事实',
        '  - 不得伪造 SEG / BT / block；未知信息写到 Open Issues',
      ]
    : [
        'v6 输出强提醒：',
        '  - appendix.meta.style_inference（三轴：rendering_style / tone_bias / genre_bias）必填',
        '  - appendix.meta.rhythm_timeline（golden_open_3s / mini_climaxes[] / major_climax / closing_hook）必填',
        '  - appendix.meta.rhythm_timeline.info_density_contract.max_none_ratio 按 genre 定档（0.10–0.30）',
        '  - 每条 block_index[i].covered_segment_ids[] 必填，且并集 ≥ 95% Normalizer seg 总数（L1 软门）',
        '  - block_index[i].must_cover_segment_ids ⊆ covered_segment_ids（见 §3.3）',
      ];
  const formatInstructionLines = usePureMd
    ? useLedgerPureMdV7Prompt
      ? [
          '**输出为 pure Markdown，禁止出现 JSON、禁止 ```json 围栏、禁止输出 appendix / diagnosis verdict。**',
          '首行必须恰好：`<editmap v7="ledger_pure_md" />`',
          '然后按顺序输出一级标题（标题文字需一致）：',
          '  `# Global Ledger`',
          '  `# Block Ledger`',
          '  `# Rhythm Ledger`',
          '  `# Narrative Notes`',
          '  `# Open Issues`',
          'Block Ledger 中每个 block 用 `## B01` 形式，并按 prompt 要求写固定键值行。',
          'Rhythm Ledger 中只写 open / mini_x / major / closing 的权威键值，不要自检结论。',
          'Narrative Notes 负责导演说明；不得改写 Ledger 里的时间、seg、beat、block 事实。',
        ]
      : [
          '**输出为纯 Markdown，禁止出现 JSON、禁止 ```json 围栏、禁止用字符串包裹长正文。**',
          '首行必须恰好：`<sd2_editmap v6="pure_md" />`',
          '然后按顺序用一级标题组织（标题文字需一致）：',
          '  `# 分镜叙事` — 写全部分镜叙事、组骨架、`### B01`…`### Bn` 子标题，与 v6b 教程一致，自然语言可任意发挥；',
          '  `# 分块机读` — 每行一条 block，**仅**四列用 `|` 或 Tab 分隔：`block_id | covered 的 seg 列表 | must 的 seg 列表(可空) | 单块建议秒数(可空)`；',
          '    例：`B01 | SEG_001,SEG_002 | SEG_001 | 12`',
          '  `# 风格与节奏` — 先写大段自然语言；可选在段内用短行补充：',
          '    `@rsv:…` 渲染/影像风格文案；`@tb:…` tone 受控词；`@gbp:…` genre 主类；`@g3:…` 开场钩子摘要；`@ch:…` 收尾钩子等。',
          'pipeline 会把上述 MD **编译**为内部 `{ markdown_body, appendix }`；`appendix` 的复杂 JSON 你不必手抄。',
        ]
    : useMdAppendix
      ? [
          '请按系统提示生成分镜叙事与衔接说明：先写 **Markdown 正文**（等价于旧版里 markdown_body 的可见内容，**不要**把正文再嵌进 JSON 字符串）。',
          '在回复**最末尾**只输出**一个**以 ```json 起首的 fenced 块；**块内仅** meta / block_index / diagnosis 的结构化 JSON。',
          '  合法结构：`{ "appendix": { "meta", "block_index", "diagnosis" } }` 或三者顶层的扁平对象。',
          '  fenced 内**不得**出现 markdown_body 键。',
        ]
      : useAbbrevJson
        ? [
            '请按系统提示与 schema 组织答案，**输出唯一一个 JSON 对象**；为节省 token，**键名使用缩写**',
            '（顶层 `mb`=markdown_body，`a`=appendix；`a.m`=meta，`a.bi`=block_index，块内 `bid`=block_id，`cs`/`ms`=covered/must 分段数组；`si`/`rt` 等见 runner 同目录 lib/editmap_v6_abbrev_json.mjs 注释）。',
            '值、枚举、长文本仍用完整信息。',
          ]
        : [
            '请严格按系统提示输出唯一一个 JSON 对象（含 markdown_body 与 appendix），不要 Markdown 围栏。',
          ];

  const userMessage = [
    '以下为 globalSynopsis、scriptContent、assetManifest、episodeDuration、referenceAssets 等输入。',
    normalizedPackage
      ? '另附 __NORMALIZED_SCRIPT_PACKAGE__ 字段，为 Stage 0 · ScriptNormalizer v2 的事实归一化产物（KVA / structure_hints / segments 详情在此；冲突以原文为准）。'
      : '',
    ...formatInstructionLines,
    '',
    ...v6OutputHints,
    '',
    JSON.stringify(userPayload, null, 2),
  ]
    .filter(Boolean)
    .join('\n');

  // ── 网关选择 ──
  //   默认：SD2_LLM_*（豆包/qwen/通义，OpenAI 兼容）
  //   --apimart：APIMart /v1/messages（Anthropic 原生端点）
  //     - 默认模型 claude-opus-4-6-thinking（APIMart 上 4-7 不存在，只有 4-6）
  //     - 可用 --model 覆盖 / --apimart-openai-compat 退到老的 /chat/completions 分支
  const useApimart = args.apimart === true;
  const useApimartOpenAiCompat = args['apimart-openai-compat'] === true;
  const translatorBackendArg =
    typeof args['translator-backend'] === 'string'
      ? args['translator-backend'].trim().toLowerCase()
      : 'auto';
  if (!['auto', 'apimart', 'llm', 'doubao', 'local'].includes(translatorBackendArg)) {
    throw new Error(
      `不支持的 --translator-backend=${translatorBackendArg}；可用值：auto / apimart / llm / doubao / local`,
    );
  }
  if (translatorBackendArg === 'doubao') {
    applyArkEnvForSd2Pipeline();
  }

  const defaultEditMapMaxTokens = Math.max(
    16384,
    Math.min(
      128000,
      parseInt(process.env.APIMART_EDITMAP_MAX_TOKENS || '36000', 10),
    ),
  );
  const defaultTranslatorMaxTokens = Math.max(
    8192,
    Math.min(
      64000,
      parseInt(process.env.APIMART_EDITMAP_TRANSLATOR_MAX_TOKENS || '24000', 10),
    ),
  );

  /**
   * @param {{
   *   phaseLabel: string,
   *   systemPrompt: string,
   *   userMessage: string,
   *   modelOverride?: string,
   *   temperature?: number,
   *   jsonObject?: boolean,
   *   maxTokens?: number,
   *   enableThinking?: boolean,
   *   backend?: 'auto' | 'apimart' | 'llm',
   *   forceApimartOpenAiCompat?: boolean,
   * }} opts
   * @returns {Promise<string>}
   */
  async function callTextModel(opts) {
    const {
      phaseLabel,
      systemPrompt: sys,
      userMessage: usr,
      modelOverride,
      temperature = 0.25,
      jsonObject = false,
      maxTokens = defaultEditMapMaxTokens,
      enableThinking = args['no-thinking'] !== true,
      backend = 'auto',
      forceApimartOpenAiCompat = false,
    } = opts;

    const effectiveBackend = backend === 'auto' ? (useApimart ? 'apimart' : 'llm') : backend;

    if (effectiveBackend === 'apimart') {
      const useOpenAiCompatBackend = useApimartOpenAiCompat || forceApimartOpenAiCompat;
      if (useOpenAiCompatBackend) {
        const defaults = getApimartResolvedDefaults();
        const effectiveModel = modelOverride || defaults.model;
        console.log(
          `[${SCRIPT_TAG}] 调用 APIMart (OpenAI-compat${forceApimartOpenAiCompat ? ' forced' : ''})：phase=${phaseLabel} model=${effectiveModel} base=${defaults.baseUrl} max_tokens=${maxTokens}`,
        );
        const chatOpts = {
          messages: [
            { role: /** @type {'system'} */ ('system'), content: sys },
            { role: /** @type {'user'} */ ('user'), content: usr },
          ],
          model: modelOverride,
          temperature,
          jsonObject,
          enableThinking,
          maxTokens,
        };
        try {
          return await callApimartChatCompletions(chatOpts);
        } catch (firstErr) {
          const fr = /** @type {Error & { finishReason?: string }} */ (firstErr);
          if (fr.finishReason === 'length') {
            const cap = Math.max(
              maxTokens,
              Math.min(
                128000,
                parseInt(process.env.APIMART_EDITMAP_MAX_RETRY_CAP || '128000', 10),
              ),
            );
            const bumped = Math.min(Math.floor(maxTokens * 1.5), cap);
            if (bumped > maxTokens) {
              console.warn(
                `[${SCRIPT_TAG}] ${phaseLabel} finish_reason=length，max_tokens ${maxTokens}→${bumped} 重试…`,
              );
              return callApimartChatCompletions({ ...chatOpts, maxTokens: bumped });
            }
          }
          throw firstErr;
        }
      }

      const msgDefaults = getApimartMessagesDefaults();
      const effectiveModel = modelOverride || msgDefaults.model;
      console.log(
        `[${SCRIPT_TAG}] 调用 APIMart (Anthropic /messages)：phase=${phaseLabel} model=${effectiveModel} ` +
          `base=${msgDefaults.baseUrl} anthropic-version=${msgDefaults.anthropicVersion} max_tokens=${maxTokens}`,
      );
      const msgOpts = {
        messages: [
          { role: /** @type {'system'} */ ('system'), content: sys },
          { role: /** @type {'user'} */ ('user'), content: usr },
        ],
        model: effectiveModel,
        temperature,
        maxTokens,
      };
      try {
        return await callApimartMessages(msgOpts);
      } catch (firstErr) {
        const fr = /** @type {Error & { finishReason?: string }} */ (firstErr);
        if (fr.finishReason === 'length') {
          const cap = Math.max(
            maxTokens,
            Math.min(
              128000,
              parseInt(process.env.APIMART_EDITMAP_MAX_RETRY_CAP || '128000', 10),
            ),
          );
          const bumped = Math.min(Math.floor(maxTokens * 1.5), cap);
          if (bumped > maxTokens) {
            console.warn(
              `[${SCRIPT_TAG}] ${phaseLabel} stop_reason=max_tokens，max_tokens ${maxTokens}→${bumped} 重试…`,
            );
            return callApimartMessages({ ...msgOpts, maxTokens: bumped });
          }
        }
        throw firstErr;
      }
    }

    console.log(
      `[${SCRIPT_TAG}] 调用 LLM：phase=${phaseLabel} model=${modelOverride || getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()}`,
    );
    return callLLM({
      systemPrompt: sys,
      userMessage: usr,
      model: modelOverride,
      temperature,
      jsonObject,
    });
  }

  const reuseL1PureMdPath =
    typeof args['reuse-l1-pure-md'] === 'string'
      ? path.resolve(process.cwd(), args['reuse-l1-pure-md'])
      : '';
  let raw = '';
  if (reuseL1PureMdPath) {
    if (!fs.existsSync(reuseL1PureMdPath)) {
      throw new Error(`--reuse-l1-pure-md 文件不存在: ${reuseL1PureMdPath}`);
    }
    raw = fs.readFileSync(reuseL1PureMdPath, 'utf8');
    console.log(`[${SCRIPT_TAG}] 复用既有 EditMap L1 pure_md：${reuseL1PureMdPath}`);
  } else {
    console.log(`[${SCRIPT_TAG}] 生成 EditMap：phase=l1_source …`);
    raw = await callTextModel({
      phaseLabel: 'l1_source',
      systemPrompt,
      userMessage,
      modelOverride: typeof args.model === 'string' ? args.model : undefined,
      temperature: 0.25,
      jsonObject: !useMdAppendix && !usePureMd,
      maxTokens: defaultEditMapMaxTokens,
    });
  }

  /** @type {Record<string, unknown>} */
  let parsed;
  try {
    if (usePureMd) {
      const pureMdMode = detectEditMapPureMdMode(raw);
      if (pureMdMode === 'v7_ledger_pure_md') {
        const l1DumpPath = outPath.replace(/\.json$/i, '.l1_pure_md.md');
        fs.writeFileSync(l1DumpPath, raw, 'utf8');
        console.log(`[${SCRIPT_TAG}] v7 ledger pure_md 已保存：${l1DumpPath}`);

        if (translatorBackendArg === 'local') {
          const compiled = compileEditMapV7LedgerPureMd(raw, { sourcePath: l1DumpPath });
          if (!compiled) {
            throw new Error('v7 ledger pure_md 本地编译失败：无法解析 Global/Block/Rhythm Ledger');
          }
          parsed = compiled;
        } else {

        /** @type {Record<string, unknown>} */
        const translatorCtx = {
          globalSynopsis:
            inputObj && typeof inputObj === 'object' && !Array.isArray(inputObj)
              ? /** @type {Record<string, unknown>} */ (inputObj).globalSynopsis || null
              : null,
          directorBrief:
            inputObj && typeof inputObj === 'object' && !Array.isArray(inputObj)
              ? /** @type {Record<string, unknown>} */ (inputObj).directorBrief || null
              : null,
          episodeDuration:
            inputObj && typeof inputObj === 'object' && !Array.isArray(inputObj)
              ? /** @type {Record<string, unknown>} */ (inputObj).episodeDuration || null
              : null,
          assetManifest:
            inputObj && typeof inputObj === 'object' && !Array.isArray(inputObj)
              ? /** @type {Record<string, unknown>} */ (inputObj).assetManifest || null
              : null,
          referenceAssets:
            inputObj && typeof inputObj === 'object' && !Array.isArray(inputObj)
              ? /** @type {Record<string, unknown>} */ (inputObj).referenceAssets || null
              : null,
          normalizedSegmentContext: buildNormalizedSegmentContext(normalizedPackage),
        };
        const translatorUserMessage = [
          '以下是需要转译的 ledger-first pure_md editmap，请把它转成 canonical JSON。',
          '要求：输出唯一一个 JSON 对象，形状为 `{ markdown_body, appendix }`。',
          '不得发明新 seg / beat / block；不得改写 ledger 中已给出的事实。',
          '',
          '# Source Pure MD',
          raw,
          '',
          '# Context JSON',
          JSON.stringify(translatorCtx, null, 2),
        ].join('\n');
        /** @type {'auto' | 'apimart' | 'llm'} */
        const translatorBackend =
          translatorBackendArg === 'doubao' || translatorBackendArg === 'llm'
            ? 'llm'
            : translatorBackendArg === 'apimart'
              ? 'apimart'
              : 'auto';
        const translatorUsesApimart =
          translatorBackend === 'apimart' || (translatorBackend === 'auto' && useApimart);
        const translatorModelOverride =
          typeof args['translator-model'] === 'string'
            ? args['translator-model']
            : translatorUsesApimart && typeof args.model === 'string'
              ? args.model
              : undefined;
        /** @type {'llm_v1_messages' | 'llm_v1_openai_compat' | 'llm_v1_openai_compat_fallback' | 'llm_v1_doubao'} */
        let translatorMode =
          translatorUsesApimart && !useApimartOpenAiCompat ? 'llm_v1_messages' : 'llm_v1_openai_compat';
        if (!translatorUsesApimart) {
          translatorMode = translatorBackendArg === 'doubao' ? 'llm_v1_doubao' : 'llm_v1_openai_compat';
        }
        /**
         * @param {{
         *   phaseLabel: string,
         *   userMessage: string,
         *   temperature: number,
         *   forceOpenAiCompat?: boolean,
         * }} translatorOpts
         */
        const callTranslatorModel = (translatorOpts) =>
          callTextModel({
            phaseLabel: translatorOpts.phaseLabel,
            systemPrompt: translatorPrompt,
            userMessage: translatorOpts.userMessage,
            modelOverride: translatorModelOverride,
            temperature: translatorOpts.temperature,
            jsonObject:
              translatorOpts.forceOpenAiCompat === true || useApimartOpenAiCompat || !translatorUsesApimart,
            maxTokens: defaultTranslatorMaxTokens,
            enableThinking: false,
            backend: translatorBackend,
            forceApimartOpenAiCompat: translatorOpts.forceOpenAiCompat === true,
          });

        let translatorRaw = await callTranslatorModel({
          phaseLabel: 'l2_translator',
          userMessage: translatorUserMessage,
          temperature: 0.05,
        });
        const l2DumpPath = outPath.replace(/\.json$/i, '.l2_translator_raw.txt');
        try {
          parsed = parseEditMapTranslatorOutput(translatorRaw);
        } catch (firstParseErr) {
          const retryDumpPath = outPath.replace(/\.json$/i, '.l2_translator_raw_attempt1.txt');
          fs.writeFileSync(retryDumpPath, translatorRaw, 'utf8');
          console.warn(
            `[${SCRIPT_TAG}] L2 translator 首次输出不是合法 JSON，自动重试一次：${
              firstParseErr instanceof Error ? firstParseErr.message : String(firstParseErr)
            }`,
          );
          const retryUserMessage = [
            '上一轮输出不合格：你输出了非 JSON 内容。',
            '这一次只能输出唯一一个合法 JSON 对象。',
            '禁止输出 pure Markdown，禁止复述源文，禁止代码块，禁止解释。',
            '如果某字段无法确定，请保守填 `null`、`[]` 或空对象，但整体必须是合法 JSON。',
            '',
            '# Source Pure MD',
            raw,
            '',
            '# Context JSON',
            JSON.stringify(translatorCtx, null, 2),
          ].join('\n');
          translatorRaw = await callTranslatorModel({
            phaseLabel: 'l2_translator_retry',
            userMessage: retryUserMessage,
            temperature: 0,
          });
          try {
            parsed = parseEditMapTranslatorOutput(translatorRaw);
          } catch (secondParseErr) {
            const retryDumpPath2 = outPath.replace(/\.json$/i, '.l2_translator_raw_attempt2.txt');
            fs.writeFileSync(retryDumpPath2, translatorRaw, 'utf8');
            if (translatorUsesApimart && !useApimartOpenAiCompat) {
              console.warn(
                `[${SCRIPT_TAG}] L2 translator /messages 第二次输出仍不是合法 JSON，自动切到 OpenAI-compat json_object 再试一次：${
                  secondParseErr instanceof Error ? secondParseErr.message : String(secondParseErr)
                }`,
              );
              const compatUserMessage = [
                '上一轮输出仍不合格：你输出了非 JSON 内容。',
                '这一次后端已切到 json_object，必须只输出唯一一个合法 JSON 对象。',
                '禁止输出 pure Markdown，禁止复述源文，禁止代码块，禁止解释。',
                '如果某字段无法确定，请保守填 `null`、`[]` 或空对象，但整体必须是合法 JSON。',
                '',
                '# Source Pure MD',
                raw,
                '',
                '# Context JSON',
                JSON.stringify(translatorCtx, null, 2),
              ].join('\n');
              translatorRaw = await callTranslatorModel({
                phaseLabel: 'l2_translator_retry_compat',
                userMessage: compatUserMessage,
                temperature: 0,
                forceOpenAiCompat: true,
              });
              translatorMode = 'llm_v1_openai_compat_fallback';
              parsed = parseEditMapTranslatorOutput(translatorRaw);
            } else {
              throw secondParseErr;
            }
          }
        }
        fs.writeFileSync(l2DumpPath, translatorRaw, 'utf8');
        const app =
          parsed.appendix && typeof parsed.appendix === 'object'
            ? /** @type {Record<string, unknown>} */ (parsed.appendix)
            : null;
        if (app) {
          if (!app.diagnosis || typeof app.diagnosis !== 'object') {
            app.diagnosis = {};
          }
          const diag = /** @type {Record<string, unknown>} */ (app.diagnosis);
          diag.editmap_output_mode = 'ledger_pure_md_v7';
          diag.translator_mode = translatorMode;
          diag.source_pure_md_path = l1DumpPath;
          diag.translator_raw_path = l2DumpPath;
        }
        }
      } else {
        const fromMd = tryParseEditMapPureMd(raw);
        if (!fromMd) {
          throw new Error(
            '纯 Markdown 默认模态下解析失败：v6 需首行 `<sd2_editmap v6="pure_md" />`；' +
              'v7 需首行 `<editmap v7="ledger_pure_md" />`。改走 JSON 请用 --legacy-json-output。',
          );
        }
        parsed = /** @type {Record<string, unknown>} */ (fromMd);
      }
    } else {
      parsed = parseEditMapV6ModelOutput(raw, useMdAppendix);
      if (useAbbrevJson) {
        parsed = /** @type {Record<string, unknown>} */ (expandAbbrevEditMapKeys(parsed));
      }
    }
  } catch (e) {
    // HOTFIX R · 解析失败时把完整 raw 落盘以便诊断（流式 thinking 模型易出现
    // "推理文本 + JSON + 可能截断"的混合输出）。
    const rawDumpPath = outPath.replace(/\.json$/i, '.raw.txt');
    try {
      fs.writeFileSync(rawDumpPath, raw, 'utf8');
      console.error(
        `[${SCRIPT_TAG}] JSON 解析失败，已保存完整 raw 到 ${rawDumpPath}（${raw.length} chars）。前 800 字：`,
      );
    } catch {
      console.error(`[${SCRIPT_TAG}] JSON 解析失败，原始前 800 字：`);
    }
    console.error(raw.slice(0, 800));
    throw e;
  }

  /**
   * v5 级 normalize（target_shot_count / parsed_brief / video 兜底）。
   * v6 新增字段（style_inference / rhythm_timeline / covered_segment_ids / script_chunk_hint）
   * 在此**不做兜底**——LLM 缺就缺，由下游软门 + Director/Prompter 的降级链路处理。
   */
  normalizeEditMapSd2V5(parsed);

  annotateNormalizerRef(parsed, normalizedPackage, normalizedPackagePath);

  // v7 strict contract: L2 Translator JSON 后置归一 + 阻断型校验。
  let v7ContractReport = null;
  if (useLedgerPureMdV7Prompt || SCRIPT_TAG === 'call_editmap_v7') {
    const contractResult = validateEditMapV7Canonical(parsed, normalizedPackage, {
      strict: true,
    });
    parsed = /** @type {Record<string, unknown>} */ (contractResult.normalized);
    v7ContractReport = contractResult.report;
    const reportPath = path.join(path.dirname(outPath), 'edit_map_v7_contract_report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(v7ContractReport, null, 2) + '\n', 'utf8');
    console.log(
      `[${SCRIPT_TAG}] v7 contract report: ${contractResult.ok ? 'ok' : 'fail'} (${reportPath})`,
    );
    if (!contractResult.ok) {
      console.error(`[${SCRIPT_TAG}] ❌ v7 contract strict 校验失败：`);
      for (const msg of contractResult.errors) {
        console.error(`  - ${msg}`);
      }
      console.error(`[${SCRIPT_TAG}] 已写入 edit_map_v7_contract_report.json；拒绝继续写 edit_map_sd2.json。`);
      process.exit(7);
    }
  }

  // ── v5.0 HOTFIX H1 · maxBlock 超上限 → **仅软门**（warn + diagnosis，不拒写；2026-04 与产品对齐：Opus 已很少超长）──
  let maxBlockDurationSoft = { status: 'pass', overList: /** @type {string[]} */ ([]) };
  {
    const finalValidation = /** @type {Record<string, unknown>} */ (parsed)._validation;
    if (finalValidation && typeof finalValidation === 'object') {
      const fv = /** @type {{
        max_block_duration_check?: boolean,
        over_limit_blocks?: string[],
      }} */ (finalValidation);
      if (fv.max_block_duration_check === false) {
        const overList = Array.isArray(fv.over_limit_blocks) ? fv.over_limit_blocks : [];
        const overStr = overList.length ? overList.join(', ') : '未知';
        maxBlockDurationSoft = { status: 'warn', overList: overList };
        const msg =
          `max_block_duration 软告警：${overStr} 超过单组建议上限（默认 16s，可 env SD2_MAX_BLOCK_DURATION_SEC）· 仍落盘`;
        console.warn(`[${SCRIPT_TAG}] ⚠️ ${msg}`);
        const app = parsed.appendix && typeof parsed.appendix === 'object'
          ? /** @type {Record<string, unknown>} */ (parsed.appendix)
          : null;
        const diag = app && app.diagnosis && typeof app.diagnosis === 'object'
          ? /** @type {Record<string, unknown>} */ (app.diagnosis)
          : null;
        if (diag) {
          const w = diag.warning_msg;
          const entry = `max_block_duration_soft: ${overStr}`;
          if (Array.isArray(w)) {
            w.push(entry);
          } else if (typeof w === 'string' && w.trim()) {
            diag.warning_msg = [w, entry];
          } else {
            diag.warning_msg = [entry];
          }
        }
      }
    }
  }

  // ── v6 软门/硬门集群（HOTFIX D：L1 与 last_seg 默认硬门；HOTFIX G：source_integrity 硬门） ──
  const segCheck = runSegmentCoverageL1Check(parsed, normalizedPackage);
  const tailCheck = runLastSegCoveredCheck(parsed, normalizedPackage);
  const sourceCheck = runSourceIntegrityCheck(parsed, normalizedPackage);
  const rhythmCheck = runRhythmTimelineShapeCheck(parsed);
  const styleCheck = runStyleInferenceShapeCheck(parsed);

  console.log(
    `[${SCRIPT_TAG}] v6 硬门 · segment_coverage L1: ${segCheck.status} (${segCheck.covered}/${segCheck.total}, ratio=${segCheck.ratio.toFixed(3)})${segCheck.status === 'fail' && segCheck.missingIds.length ? ' missing(前12)=' + segCheck.missingIds.slice(0, 12).join(',') : ''}`,
  );
  console.log(
    `[${SCRIPT_TAG}] v6 硬门 · last_seg_covered_check: ${tailCheck.status}${tailCheck.tailSegId ? ` tail=${tailCheck.tailSegId}` : ''}${tailCheck.status === 'fail' ? ` (${tailCheck.reason})` : ''}`,
  );
  console.log(
    `[${SCRIPT_TAG}] v6 硬门 · source_integrity_check: ${sourceCheck.status} (refs=${sourceCheck.totalReferenced})${sourceCheck.status === 'fail' ? ` out_of_universe(前8)=${sourceCheck.outOfUniverseIds.slice(0, 8).join(',')}` : ''}`,
  );
  console.log(
    `[${SCRIPT_TAG}] v6 软门 · rhythm_timeline shape: ${rhythmCheck.status}${rhythmCheck.missing.length ? ' missing=' + rhythmCheck.missing.join(',') : ''}`,
  );
  console.log(
    `[${SCRIPT_TAG}] v6 软门 · style_inference shape: ${styleCheck.status}${styleCheck.missing.length ? ' missing=' + styleCheck.missing.join(',') : ''}`,
  );

  // 回填 diagnosis：用 pipeline 真实值覆盖 LLM 自报（防止 0.97 幻觉）
  backfillDiagnosisAuthoritativeMetrics(parsed, segCheck, tailCheck);

  // 把门结果写到 appendix.diagnosis.v6_softgate_report（保留审计轨迹）
  const appendixAny =
    parsed.appendix && typeof parsed.appendix === 'object'
      ? /** @type {Record<string, unknown>} */ (parsed.appendix)
      : null;
  if (appendixAny) {
    const diag =
      appendixAny.diagnosis && typeof appendixAny.diagnosis === 'object'
        ? /** @type {Record<string, unknown>} */ (appendixAny.diagnosis)
        : (appendixAny.diagnosis = {});
    /** @type {Record<string, unknown>} */ (diag).v6_softgate_report = {
      max_block_duration: maxBlockDurationSoft,
      segment_coverage_l1: segCheck,
      last_seg_covered: tailCheck,
      source_integrity: sourceCheck,
      rhythm_timeline_shape: rhythmCheck,
      style_inference_shape: styleCheck,
      v7_contract: v7ContractReport,
      downgrade_flags: {
        allow_v6_soft: allowV6Soft,
        skip_editmap_coverage_hard: skipCoverageHard,
        skip_last_seg_hard: skipLastSegHard,
        skip_source_integrity_hard: skipSourceIntegrityHard,
      },
    };
  }

  // ── HOTFIX D/G · 硬门拦截（L1 + last_seg + source_integrity），允许通过 flag 降级 ──
  /** @type {string[]} */
  const hardFails = [];
  if (segCheck.status === 'fail') {
    if (skipCoverageHard) {
      console.warn(
        `[${SCRIPT_TAG}] ⚠️ segment_coverage L1 < 0.95（${segCheck.ratio.toFixed(3)}）· 已降级为 warn（--allow-v6-soft / --skip-editmap-coverage-hard）`,
      );
    } else {
      hardFails.push(`segment_coverage_l1 ratio=${segCheck.ratio.toFixed(3)} < 0.95 (${segCheck.covered}/${segCheck.total})`);
    }
  }
  if (tailCheck.status === 'fail') {
    if (skipLastSegHard) {
      console.warn(
        `[${SCRIPT_TAG}] ⚠️ last_seg_covered_check fail（${tailCheck.reason}）· 已降级为 warn（--allow-v6-soft / --skip-last-seg-hard）`,
      );
    } else {
      hardFails.push(`last_seg_covered_check: ${tailCheck.reason}`);
    }
  }
  if (sourceCheck.status === 'fail') {
    if (skipSourceIntegrityHard) {
      console.warn(
        `[${SCRIPT_TAG}] ⚠️ source_integrity_check fail（${sourceCheck.outOfUniverseIds.length} 个伪 seg_id，前 8: ${sourceCheck.outOfUniverseIds.slice(0, 8).join(',')}）· 已降级为 warn（--allow-v6-soft / --skip-source-integrity-hard）`,
      );
    } else {
      hardFails.push(
        `source_integrity_check: ${sourceCheck.outOfUniverseIds.length} fabricated seg_ids (${sourceCheck.outOfUniverseIds.slice(0, 8).join(',')}${sourceCheck.outOfUniverseIds.length > 8 ? ',…' : ''})`,
      );
    }
  }
  if (rhythmCheck.status === 'fail') {
    console.warn(
      `[${SCRIPT_TAG}] ⚠️ rhythm_timeline 结构不完整，下游 v6 节奏决策将降级 / 退化到 v5 行为`,
    );
  }
  if (styleCheck.status === 'fail') {
    console.warn(
      `[${SCRIPT_TAG}] ⚠️ style_inference 三轴不全，下游 renderingStyle 会回退到 meta.rendering_style 或默认值`,
    );
  }

  if (hardFails.length > 0) {
    console.error(
      `[${SCRIPT_TAG}] ❌ v6 EditMap 硬门失败 ${hardFails.length} 项：`,
    );
    for (const msg of hardFails) {
      console.error(`  - ${msg}`);
    }
    console.error(
      `[${SCRIPT_TAG}] 如需一次性降级请加 --allow-v6-soft（或对应 --skip-editmap-coverage-hard / --skip-last-seg-hard）。拒绝写盘。`,
    );
    process.exit(7);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`[${SCRIPT_TAG}] 已写入 ${outPath}`);
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error(`[${SCRIPT_TAG}]`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

// HOTFIX D/F/G · 导出 pure 函数供单元测试使用
//   - D/F: tests/test_editmap_hardgate_v6_hotfix_d.mjs
//   - G:   tests/test_editmap_hardgate_v6_hotfix_g.mjs
export {
  computeSegmentUniverseFromPackage,
  collectCoveredSegmentIds,
  collectAllReferencedSegIds,
  runSegmentCoverageL1Check,
  runLastSegCoveredCheck,
  runSourceIntegrityCheck,
  runStyleInferenceShapeCheck,
  backfillDiagnosisAuthoritativeMetrics,
  composeDynamicHardFloorBrief,
  appendHardFloorToDirectorBrief,
};
