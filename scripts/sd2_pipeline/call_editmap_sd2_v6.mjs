#!/usr/bin/env node
/**
 * EditMap-SD2 v6 调度器：输出 `{ markdown_body, appendix }` 结构（契约见
 * `prompt/1_SD2Workflow/1_EditMap-SD2/1_EditMap-SD2-v6.md` 与
 * `prompt/1_SD2Workflow/docs/v6/07_v6-schema-冻结.md`）。
 *
 * 与 v5 的差异（仅限编排层）：
 *   1. system prompt 切到 `1_EditMap-SD2-v6.md`（delta 文档，内部引用 v5 原文）；
 *   2. editmap/ 静态挂载切片由 6 → 7（末尾追加 `v6_rhythm_templates.md`），token 硬限 14k；
 *   3. 新增 v6 软门（EditMap 层）：
 *        · segment_coverage_check.ratio ≥ 0.95（L1 软门，只 warn）
 *        · rhythm_timeline 基础结构校验（golden_open / major_climax / closing_hook 至少命中一项）
 *        · style_inference 三轴存在性校验（rendering_style / tone_bias / genre_bias 都要有值）
 *   4. 保留 v5.0 HOTFIX H1 的 maxBlock 硬门（任何 block.duration > 15s → exit 7）。
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
import {
  callApimartChatCompletions,
  getApimartResolvedDefaults,
} from './lib/apimart_chat.mjs';
import {
  callApimartMessages,
  getApimartMessagesDefaults,
} from './lib/apimart_messages_chat.mjs';
import {
  annotateNormalizerRef,
  estimateTokens,
  loadEditMapSlicesV6,
  loadNormalizedPackage,
  logEditMapSlicesSummaryV6,
  mergeNormalizedPackageIntoPayload,
} from './lib/editmap_slices_v6.mjs';
import { normalizeEditMapSd2V5 } from './lib/normalize_edit_map_sd2_v5.mjs';
import { getEditMapSd2V6PromptPath } from './lib/sd2_prompt_paths_v6.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_TAG = 'call_editmap_sd2_v6';

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
    `【硬下限 · Block】blocks.length ≥ ${blockFloor}（max(15, ceil(segs_count/4))），且每块 4–15s、总时长守恒。`,
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
    if (
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
    console.error(`[${SCRIPT_TAG}] EditMap-SD2-v6.md 不存在：${promptPath}`);
    process.exit(3);
  }

  const basePrompt = fs.readFileSync(promptPath, 'utf8');

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

  let userPayload = mergeNormalizedPackageIntoPayload(inputObj, normalizedPackage);

  // ── HOTFIX F · 动态硬下限注入 ──
  //   若已挂载 Stage 0 产物：按 segs_count 重写 directorBrief 硬下限尾段，
  //   覆盖 prepare_editmap_input 默认的"参考区间"软措辞，让 LLM 看到"至少 N shot / 至少 M block / tail_seg 必进"。
  if (normalizedPackage) {
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
  }

  const userMessage = [
    '以下为 globalSynopsis、scriptContent、assetManifest、episodeDuration、referenceAssets 等输入。',
    normalizedPackage
      ? '另附 __NORMALIZED_SCRIPT_PACKAGE__ 字段，为 Stage 0 · ScriptNormalizer v2 的事实归一化产物（KVA / structure_hints / segments 详情在此；冲突以原文为准）。'
      : '',
    '请严格按系统提示输出唯一一个 JSON 对象（含 markdown_body 与 appendix），不要 Markdown 围栏。',
    '',
    'v6 输出强提醒：',
    '  - appendix.meta.style_inference（三轴：rendering_style / tone_bias / genre_bias）必填',
    '  - appendix.meta.rhythm_timeline（golden_open_3s / mini_climaxes[] / major_climax / closing_hook）必填',
    '  - appendix.meta.rhythm_timeline.info_density_contract.max_none_ratio 按 genre 定档（0.10–0.30）',
    '  - 每条 block_index[i].covered_segment_ids[] 必填，且并集 ≥ 95% Normalizer seg 总数（L1 软门）',
    '  - block_index[i].must_cover_segment_ids ⊆ covered_segment_ids（见 §3.3）',
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

  /** @type {string} */
  let raw;
  if (useApimart) {
    const editMapMaxTokens = Math.max(
      32768,
      parseInt(process.env.APIMART_EDITMAP_MAX_TOKENS || '200000', 10),
    );
    const modelOverride = typeof args.model === 'string' ? args.model : undefined;

    if (useApimartOpenAiCompat) {
      // 旧路径：/v1/chat/completions（Anthropic 新模型已不支持，留作回退）
      const defaults = getApimartResolvedDefaults();
      const effectiveModel = modelOverride || defaults.model;
      console.log(
        `[${SCRIPT_TAG}] 调用 APIMart (OpenAI-compat)：model=${effectiveModel} base=${defaults.baseUrl} max_tokens=${editMapMaxTokens}`,
      );
      console.log(`[${SCRIPT_TAG}] 生成 EditMap-SD2 v6（APIMart /chat/completions）…`);
      const chatOpts = {
        messages: [
          { role: /** @type {'system'} */ ('system'), content: systemPrompt },
          { role: /** @type {'user'} */ ('user'), content: userMessage },
        ],
        model: modelOverride,
        temperature: 0.25,
        jsonObject: true,
        enableThinking: args['no-thinking'] !== true,
        maxTokens: editMapMaxTokens,
      };
      try {
        raw = await callApimartChatCompletions(chatOpts);
      } catch (firstErr) {
        const fr = /** @type {Error & { finishReason?: string }} */ (firstErr);
        if (fr.finishReason === 'length') {
          const cap = Math.max(
            editMapMaxTokens,
            parseInt(process.env.APIMART_EDITMAP_MAX_RETRY_CAP || '262144', 10),
          );
          const bumped = Math.min(Math.floor(editMapMaxTokens * 1.5), cap);
          if (bumped > editMapMaxTokens) {
            console.warn(
              `[${SCRIPT_TAG}] finish_reason=length，max_tokens ${editMapMaxTokens}→${bumped} 重试…`,
            );
            raw = await callApimartChatCompletions({ ...chatOpts, maxTokens: bumped });
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
    } else {
      // 默认路径：/v1/messages（Anthropic 原生，支持 claude-opus-4-6-thinking）
      const msgDefaults = getApimartMessagesDefaults();
      const effectiveModel = modelOverride || msgDefaults.model;
      console.log(
        `[${SCRIPT_TAG}] 调用 APIMart (Anthropic /messages)：model=${effectiveModel} ` +
          `base=${msgDefaults.baseUrl} anthropic-version=${msgDefaults.anthropicVersion} ` +
          `max_tokens=${editMapMaxTokens}`,
      );
      console.log(`[${SCRIPT_TAG}] 生成 EditMap-SD2 v6（APIMart /messages）…`);
      const msgOpts = {
        messages: [
          { role: /** @type {'system'} */ ('system'), content: systemPrompt },
          { role: /** @type {'user'} */ ('user'), content: userMessage },
        ],
        model: effectiveModel,
        temperature: 0.25,
        maxTokens: editMapMaxTokens,
      };
      try {
        raw = await callApimartMessages(msgOpts);
      } catch (firstErr) {
        const fr = /** @type {Error & { finishReason?: string }} */ (firstErr);
        if (fr.finishReason === 'length') {
          const cap = Math.max(
            editMapMaxTokens,
            parseInt(process.env.APIMART_EDITMAP_MAX_RETRY_CAP || '262144', 10),
          );
          const bumped = Math.min(Math.floor(editMapMaxTokens * 1.5), cap);
          if (bumped > editMapMaxTokens) {
            console.warn(
              `[${SCRIPT_TAG}] stop_reason=max_tokens，max_tokens ${editMapMaxTokens}→${bumped} 重试…`,
            );
            raw = await callApimartMessages({ ...msgOpts, maxTokens: bumped });
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
    }
  } else {
    console.log(
      `[${SCRIPT_TAG}] 调用 LLM：model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()}`,
    );
    console.log(`[${SCRIPT_TAG}] 生成 EditMap-SD2 v6 …`);
    raw = await callLLM({
      systemPrompt,
      userMessage,
      temperature: 0.25,
      jsonObject: true,
    });
  }

  /** @type {Record<string, unknown>} */
  let parsed;
  try {
    parsed = /** @type {Record<string, unknown>} */ (parseJsonFromModelText(raw));
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

  // ── v5.0 HOTFIX H1 保留 · maxBlock > 15s 硬门 ──
  {
    const finalValidation = /** @type {Record<string, unknown>} */ (parsed)._validation;
    if (finalValidation && typeof finalValidation === 'object') {
      const fv = /** @type {{
        max_block_duration_check?: boolean,
        over_limit_blocks?: string[],
      }} */ (finalValidation);
      if (fv.max_block_duration_check === false) {
        const overList = Array.isArray(fv.over_limit_blocks) ? fv.over_limit_blocks.join(', ') : '未知';
        console.error(
          `[${SCRIPT_TAG}] ❌ 硬门失败：max_block_duration_check=false（${overList} 超过 15s 硬上限）。拒绝写盘。`,
        );
        process.exit(7);
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
      segment_coverage_l1: segCheck,
      last_seg_covered: tailCheck,
      source_integrity: sourceCheck,
      rhythm_timeline_shape: rhythmCheck,
      style_inference_shape: styleCheck,
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
  backfillDiagnosisAuthoritativeMetrics,
  composeDynamicHardFloorBrief,
  appendHardFloorToDirectorBrief,
};
