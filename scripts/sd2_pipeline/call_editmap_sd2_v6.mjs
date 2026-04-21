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
 * v6 EditMap 层软门：segment_coverage_check · L1 阈值 ≥ 0.95。
 *
 * 计算口径（与 04_v6-并发链路.md §5.1.1 完全一致）：
 *   - 分母：normalizedScriptPackage.beat_ledger[*].segments[].seg_id 的全集 count
 *   - 分子：⋃ block_index[i].covered_segment_ids[] 的去重 count
 *   - 阈值：≥ 0.95 视为通过；低于阈值 → 软门失败（打 warn，不阻塞）
 *   - Stage 0 未提供 → 跳过本检查
 *   - EditMap 未升级（所有 block 都缺 covered_segment_ids）→ 写入 ratio=0 + 警告
 *
 * @param {Record<string, unknown>} parsed      LLM 已解析的 EditMap 产物
 * @param {unknown | null} normalizedPackage    Stage 0 产物
 * @returns {{ ratio: number, covered: number, total: number, status: 'pass'|'fail'|'skip' }}
 */
function runSegmentCoverageL1Check(parsed, normalizedPackage) {
  if (!normalizedPackage || typeof normalizedPackage !== 'object') {
    return { ratio: 1, covered: 0, total: 0, status: 'skip' };
  }
  const pkg = /** @type {Record<string, unknown>} */ (normalizedPackage);
  const ledger = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : [];
  /** @type {Set<string>} */
  const universe = new Set();
  for (const beat of ledger) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    const segs = Array.isArray(b.segments) ? b.segments : [];
    for (const seg of segs) {
      if (!seg || typeof seg !== 'object') continue;
      const sid = /** @type {Record<string, unknown>} */ (seg).seg_id;
      if (typeof sid === 'string' && sid) universe.add(sid);
    }
  }
  const totalCount = universe.size;
  if (totalCount === 0) {
    return { ratio: 1, covered: 0, total: 0, status: 'skip' };
  }

  const appendix =
    parsed.appendix && typeof parsed.appendix === 'object'
      ? /** @type {Record<string, unknown>} */ (parsed.appendix)
      : {};
  const rows = Array.isArray(appendix.block_index) ? appendix.block_index : [];
  /** @type {Set<string>} */
  const covered = new Set();
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
  const ratio = covered.size / totalCount;
  return {
    ratio,
    covered: covered.size,
    total: totalCount,
    status: ratio >= 0.95 ? 'pass' : 'fail',
  };
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

  const userPayload = mergeNormalizedPackageIntoPayload(inputObj, normalizedPackage);

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

  console.log(
    `[${SCRIPT_TAG}] 调用 LLM：model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()}`,
  );
  console.log(`[${SCRIPT_TAG}] 生成 EditMap-SD2 v6 …`);
  const raw = await callLLM({
    systemPrompt,
    userMessage,
    temperature: 0.25,
    jsonObject: true,
  });

  /** @type {Record<string, unknown>} */
  let parsed;
  try {
    parsed = /** @type {Record<string, unknown>} */ (parseJsonFromModelText(raw));
  } catch (e) {
    console.error(`[${SCRIPT_TAG}] JSON 解析失败，原始前 500 字：`);
    console.error(raw.slice(0, 500));
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

  // ── v6 软门三件套（只 warn，不阻塞；失败记录到 appendix.diagnosis.v6_softgate_report） ──
  const segCheck = runSegmentCoverageL1Check(parsed, normalizedPackage);
  const rhythmCheck = runRhythmTimelineShapeCheck(parsed);
  const styleCheck = runStyleInferenceShapeCheck(parsed);

  console.log(
    `[${SCRIPT_TAG}] v6 软门 · segment_coverage L1: ${segCheck.status} (${segCheck.covered}/${segCheck.total}, ratio=${segCheck.ratio.toFixed(3)})`,
  );
  console.log(
    `[${SCRIPT_TAG}] v6 软门 · rhythm_timeline shape: ${rhythmCheck.status}${rhythmCheck.missing.length ? ' missing=' + rhythmCheck.missing.join(',') : ''}`,
  );
  console.log(
    `[${SCRIPT_TAG}] v6 软门 · style_inference shape: ${styleCheck.status}${styleCheck.missing.length ? ' missing=' + styleCheck.missing.join(',') : ''}`,
  );

  if (segCheck.status === 'fail') {
    console.warn(
      `[${SCRIPT_TAG}] ⚠️ segment_coverage L1 < 0.95（${segCheck.ratio.toFixed(3)}）· 下游 Prompter L2 硬门可能拦截`,
    );
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

  // 把软门结果写到 appendix.diagnosis.v6_softgate_report（保留审计轨迹）
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
      rhythm_timeline_shape: rhythmCheck,
      style_inference_shape: styleCheck,
    };
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
