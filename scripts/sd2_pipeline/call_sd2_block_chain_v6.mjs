#!/usr/bin/env node
/**
 * SD2 v6 · 每 Block 内 Director → Prompter 调度器。
 *
 * 与 v5 的差异：
 *   1. Director / Prompter system prompt 切到 `2_SD2Director-v6.md` / `2_SD2Prompter-v6.md`；
 *   2. 切片路由用 `lib/knowledge_slices_v6.mjs`（支持 has_kva 匹配键）；
 *   3. payload 用 `lib/sd2_v6_payloads.mjs`（scriptChunk 透传 / rhythm_timeline /
 *      style_inference / info_density_contract）；
 *   4. 新增 v6 硬门（见 lib/sd2_block_chain_v6_helpers.mjs Part B）：
 *        · Director segment_coverage_report.coverage_ratio ≥ 0.90
 *        · Director kva_coverage_ratio ≥ 1.00（有 P0 KVA 时）
 *        · Director shot_meta.info_delta none_ratio ≤ contract
 *        · Prompter dialogue_fidelity（scriptChunk.text 原样出现在 [DIALOG]）
 *      任一硬门失败 → exit 8（除非 --skip-kva-hard 等降级 flag）。
 *
 * 保留 v5 行为（直接复用 v5 helpers）：
 *   - @图N 全局 drift 修复；
 *   - AV-split 四段 + BGM 裸名检查；
 *   - iron_rule_checklist 位置 + failed_item；
 *   - shot_budget_per_block / shot_count_budget 软门。
 *
 * 逃生口（降级 flag，与 v6 prompt CLI 同名）：
 *   - `--skip-kva-hard`：kva_coverage 硬门降级为 warn
 *   - `--skip-segment-coverage-hard`：segment_coverage 硬门降级为 warn
 *   - `--skip-info-density-hard`：info_delta 硬门降级为 warn
 *   - `--skip-dialogue-fidelity-hard`：对白保真硬门降级为 warn
 *   - `--allow-v6-soft`：所有 v6 硬门降级为 warn（一键降级）
 *   - `--serial` / `--enforce-scene-serial`：与 v5 一致
 *
 * 契约源：
 *   - `prompt/1_SD2Workflow/2_SD2Director/2_SD2Director-v6.md` §I.2.1–§I.2.4
 *   - `prompt/1_SD2Workflow/2_SD2Prompter/2_SD2Prompter-v6.md`  §I.1–§I.5
 *   - `prompt/1_SD2Workflow/docs/v6/00_v6-升级计划总览.md` §九 降级路径
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
import { resolveSd2StyleHints } from './lib/edit_map_style_hints.mjs';
import {
  appendKnowledgeSlicesToSystemPromptV6,
  derivePsychologyGroupOnBlocks,
  deriveHasKvaFromScriptChunk,
  extractRoutingForBlockV6,
  loadKnowledgeSlicesV6,
  omitKnowledgeSlicesFromPayloadV6,
} from './lib/knowledge_slices_v6.mjs';
import {
  assertV6PromptFileExists,
  getDirectorSd2V6PromptPath,
  getKnowledgeSlicesRootPathV6,
  getPrompterSd2V6PromptPath,
} from './lib/sd2_prompt_paths_v6.mjs';
import {
  buildDirectorPayloadV6,
  buildPrompterPayloadV6,
  computePrevBlockContextForDirectorV6,
  extractDirectorMarkdownSectionForBlock,
} from './lib/sd2_v6_payloads.mjs';
import {
  adjacentBlocksRequireSerial,
  checkAvSplitFormat,
  checkDirectorInfoDensityV6,
  checkDirectorKvaCoverageV6,
  checkDirectorSegmentCoverageV6,
  checkPrompterDialogueFidelityV6,
  detectBgmNameLeak,
  extractShotCountFromDirector,
  getBlockIndexRow,
  repairAssetTagDrift,
} from './lib/sd2_block_chain_v6_helpers.mjs';
import { runAllPrompterSelfChecks } from './lib/sd2_prompter_selfcheck_v6.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_KB = path.join(REPO_ROOT, 'prompt', '1_SD2Workflow', '3_FewShotKnowledgeBase');
const SCRIPT_TAG = 'call_sd2_block_chain_v6';

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
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
 * 读取 normalizedScriptPackage（Stage 0 产物）。失败返回 null。
 *
 * @param {string} absPath
 * @returns {unknown | null}
 */
function loadNormalizedPackageSafely(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return null;
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : null;
  } catch (err) {
    console.warn(`[${SCRIPT_TAG}] 读取 normalized package 失败: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * @typedef {Object} HardgateOutcome
 * @property {string} code
 * @property {'pass'|'fail'|'warn'|'skip'} status
 * @property {string} reason
 * @property {string} block_id
 * @property {Record<string, unknown>} detail
 */

/**
 * 把一条 v6 硬门结果转换为 routing_warning 条目（用于审计产出）。
 *
 * @param {HardgateOutcome} o
 * @returns {import('./lib/sd2_block_chain_v6_helpers.mjs').RoutingWarning}
 */
function hardgateToWarning(o) {
  return {
    code: `v6_hardgate_${o.code}`,
    severity: o.status === 'fail' ? 'warn' : 'info',
    block_id: o.block_id,
    actual: o.detail,
    expected: { status: 'pass' },
    message: `[${o.status}] ${o.code} @ ${o.block_id}: ${o.reason}`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const editMapPath =
    typeof args['edit-map'] === 'string' ? path.resolve(process.cwd(), args['edit-map']) : '';
  const directorPayloadsPath =
    typeof args['director-payloads'] === 'string'
      ? path.resolve(process.cwd(), args['director-payloads'])
      : '';
  const outRoot =
    typeof args['out-root'] === 'string' ? path.resolve(process.cwd(), args['out-root']) : '';
  const normalizedPackagePath =
    typeof args['normalized-package'] === 'string'
      ? path.resolve(process.cwd(), args['normalized-package'])
      : '';

  if (!editMapPath || !fs.existsSync(editMapPath)) {
    console.error(`[${SCRIPT_TAG}] 请指定 --edit-map edit_map_sd2.json`);
    process.exit(2);
  }
  if (!directorPayloadsPath || !fs.existsSync(directorPayloadsPath)) {
    console.error(`[${SCRIPT_TAG}] 请指定 --director-payloads sd2_director_payloads_v6.json`);
    process.exit(2);
  }
  if (!outRoot) {
    console.error(`[${SCRIPT_TAG}] 请指定 --out-root`);
    process.exit(2);
  }

    // ── 降级开关 ──
    const allowV6Soft = args['allow-v6-soft'] === true;
    const skipKvaHard = args['skip-kva-hard'] === true || allowV6Soft;
    const skipSegHard = args['skip-segment-coverage-hard'] === true || allowV6Soft;
    const skipInfoHard = args['skip-info-density-hard'] === true || allowV6Soft;
    const skipDialogueHard = args['skip-dialogue-fidelity-hard'] === true || allowV6Soft;
    // v6.1 新增：Prompter 自检硬门（dialogue_fidelity_check / kva_coverage_ratio /
    // rhythm_density_check / five_stage_check / climax_signature_check /
    // segment_coverage_overall.pass_l2 / pass_l3）。默认开启，可一键降级。
    const skipPrompterSelfHard = args['skip-prompter-selfcheck-hard'] === true || allowV6Soft;

  const rawDp = JSON.parse(fs.readFileSync(directorPayloadsPath, 'utf8'));
  /** @type {Array<{ block_id?: string, payload?: unknown }>} */
  let list = Array.isArray(rawDp.payloads) ? rawDp.payloads : [];
  const blockFilter = typeof args.block === 'string' ? String(args.block).trim() : '';
  if (blockFilter) list = list.filter((p) => p && p.block_id === blockFilter);
  if (!list.length) {
    throw new Error(blockFilter ? `未找到 block: ${blockFilter}` : '无 director payload');
  }
  list.sort((a, b) =>
    String(a.block_id || '').localeCompare(String(b.block_id || ''), undefined, { numeric: true }),
  );

  const editMap = JSON.parse(fs.readFileSync(editMapPath, 'utf8'));
  const normalizedPackage = loadNormalizedPackageSafely(normalizedPackagePath);
  if (normalizedPackage) {
    console.log(`[${SCRIPT_TAG}] 已挂载 Stage 0 产物: ${normalizedPackagePath}`);
  } else {
    console.warn(
      `[${SCRIPT_TAG}] 未读取到 Stage 0 产物，v6 硬门（scriptChunk / KVA / 对白保真）将自动跳过 / 降级`,
    );
  }

  /** @type {import('./lib/sd2_block_chain_v6_helpers.mjs').RoutingWarning[]} */
  const routingWarnings = [];
  /** @type {HardgateOutcome[]} */
  const hardgateOutcomes = [];

  // 编排层派生 psychology_group（v6 与 v5 完全等价）
  const psyResolutions = derivePsychologyGroupOnBlocks(editMap);
  for (const res of psyResolutions) {
    if (res.source === 'canonical') continue;
    routingWarnings.push({
      code: 'psychology_group_synonym_fallback',
      severity: res.source === 'synonym' ? 'info' : 'warn',
      block_id: res.block_id,
      actual: res.raw,
      expected: { mapped_to: res.canonical || null },
      message:
        res.source === 'synonym'
          ? `EditMap 使用自由词 "${res.raw}"，同义词层映射到 "${res.canonical}"`
          : res.raw
          ? `EditMap psychology group "${res.raw}" 同义词层未命中，不注入 psychology 切片`
          : 'EditMap 未提供 psychology group，不注入 psychology 切片',
    });
  }

  // 风格 / 比例
  const renderingStyleCli =
    typeof args['rendering-style'] === 'string' && args['rendering-style'].trim()
      ? args['rendering-style'].trim()
      : '';
  const artStyleCli =
    typeof args['art-style'] === 'string' && args['art-style'].trim() ? args['art-style'].trim() : '';
  const { renderingStyle, artStyle } = resolveSd2StyleHints({
    cliRenderingStyle: renderingStyleCli,
    cliArtStyle: artStyleCli,
    editMapJsonPath: editMapPath,
    editMap,
  });
  const metaVideo =
    editMap.meta && editMap.meta.video && typeof editMap.meta.video === 'object'
      ? /** @type {Record<string, unknown>} */ (editMap.meta.video)
      : {};
  const metaAspect = typeof metaVideo.aspect_ratio === 'string' ? metaVideo.aspect_ratio : '';
  const aspectRatio =
    typeof args['aspect-ratio'] === 'string' ? args['aspect-ratio'] : metaAspect || '9:16';

  const kbDir =
    typeof args['kb-dir'] === 'string' ? path.resolve(process.cwd(), args['kb-dir']) : DEFAULT_KB;
  const slicesRoot =
    typeof args['slices-root'] === 'string'
      ? path.resolve(process.cwd(), args['slices-root'])
      : getKnowledgeSlicesRootPathV6();

  const maxExamples = Math.max(
    1,
    parseInt(String(args['max-examples'] !== undefined ? args['max-examples'] : '2'), 10) || 2,
  );
  const staggerMs = Math.max(
    0,
    parseInt(String(args['stagger-ms'] !== undefined ? args['stagger-ms'] : '0'), 10) || 0,
  );
  const forceSerial = args.serial === true;
  const enforceSceneSerial = args['enforce-scene-serial'] === true;

  const prompterPromptPath =
    typeof args['prompter-prompt'] === 'string' && args['prompter-prompt'].trim()
      ? path.resolve(process.cwd(), args['prompter-prompt'].trim())
      : getPrompterSd2V6PromptPath();
  const directorPromptPath =
    typeof args['director-prompt'] === 'string' && args['director-prompt'].trim()
      ? path.resolve(process.cwd(), args['director-prompt'].trim())
      : getDirectorSd2V6PromptPath();
  assertV6PromptFileExists(prompterPromptPath);
  assertV6PromptFileExists(directorPromptPath);
  const directorSysBase = fs.readFileSync(directorPromptPath, 'utf8');
  const prompterSysBase = fs.readFileSync(prompterPromptPath, 'utf8');

  const directorDir = path.join(outRoot, 'director_prompts');
  const promptsDir = path.join(outRoot, 'prompts');
  fs.mkdirSync(directorDir, { recursive: true });
  fs.mkdirSync(promptsDir, { recursive: true });

  console.log(
    `[${SCRIPT_TAG}] Director+Prompter v6；model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()} blocks=${list.length}；` +
      `调度=${forceSerial ? '强制串行' : enforceSceneSerial ? 'scene 串行' : '全 fan-out'} slicesRoot=${slicesRoot} aspect=${aspectRatio}`,
  );
    console.log(
      `[${SCRIPT_TAG}] 降级 flags: allowV6Soft=${allowV6Soft} kva=${!skipKvaHard} seg=${!skipSegHard} info=${!skipInfoHard} dialogue=${!skipDialogueHard} prompterSelf=${!skipPrompterSelfHard}`,
    );

  const n = list.length;
  /** @type {Promise<void>[]} */
  const done = [];
  /** @type {((value?: void) => void)[]} */
  const resolveDone = [];
  for (let i = 0; i < n; i += 1) {
    done[i] = new Promise((res) => {
      resolveDone[i] = res;
    });
  }

  /** @type {(unknown|null)[]} */
  const appendixByIndex = new Array(n).fill(null);
  /** @type {Array<{ block_id: string, director_result: unknown, prompter_result: unknown }|null>} */
  const rows = new Array(n).fill(null);
  /** @type {Array<Record<string, unknown>>} */
  const routingTrace = [];
  /** @type {Array<{ block_id: string, payload: unknown }>} */
  const mergedPayloads = [];

  /**
   * @param {number} index
   */
  async function runOne(index) {
    try {
      const entry = list[index];
      const blockId = entry.block_id;
      if (!blockId || !entry.payload) return;

      const prevRow = index > 0 ? getBlockIndexRow(editMap, list[index - 1].block_id) : null;
      const biRow = getBlockIndexRow(editMap, blockId);

      const mustWaitForPrevDirector =
        index > 0 &&
        (forceSerial ||
          (enforceSceneSerial && (prevRow && biRow ? adjacentBlocksRequireSerial(prevRow, biRow) : false)));
      if (mustWaitForPrevDirector) await done[index - 1];
      if (staggerMs > 0) await new Promise((r) => setTimeout(r, index * staggerMs));

      const prevAppendixForCtx = mustWaitForPrevDirector ? appendixByIndex[index - 1] : null;
      const prevCtx = computePrevBlockContextForDirectorV6(prevAppendixForCtx, prevRow, biRow);

      // ── v6 · 构造 Director payload（含 scriptChunk / rhythm / style / density） ──
      const dpPayload = buildDirectorPayloadV6({
        editMap,
        blockId,
        normalizedScriptPackage: normalizedPackage,
        kbDir,
        renderingStyle,
        aspectRatio,
        maxExamples,
        knowledgeSlices: [],
        prevBlockContext: prevCtx,
      });

      // ── v6 · 切片路由（读 has_kva 派生） ──
      const routing = extractRoutingForBlockV6(biRow);
      const hasKva = deriveHasKvaFromScriptChunk(
        /** @type {Record<string, unknown> | null} */ (
          /** @type {Record<string, unknown>} */ (dpPayload).scriptChunk
        ),
      );
      const dirLoad = loadKnowledgeSlicesV6({
        consumer: 'director',
        routing,
        aspectRatio,
        hasKva,
        slicesRoot,
      });
      /** @type {Record<string, unknown>} */ (dpPayload).knowledgeSlices = dirLoad.slices;

      const directorSys = appendKnowledgeSlicesToSystemPromptV6(directorSysBase, dirLoad.slices);
      const dirUserObj = omitKnowledgeSlicesFromPayloadV6(
        /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(dpPayload))),
      );
      const dirUser = [
        '以下为单 Block 的 SD2Director v6 输入 JSON。',
        'v6 新字段：scriptChunk（本 block 剧本切片 + KVA + structure_hints）/ styleInference（三轴）/ rhythmTimelineForBlock（节奏角色）/ infoDensityContract（none 密度契约）。',
        '请严格按系统提示输出唯一一个 JSON 对象（含 markdown_body 与 appendix），不要 Markdown 围栏。',
        '',
        JSON.stringify(dirUserObj, null, 2),
      ].join('\n');

      console.log(
        `[${SCRIPT_TAG}] ${blockId}：Director … slices=${dirLoad.applied.length} hasKva=${hasKva} tokens=${dirLoad.total_tokens}/${dirLoad.budget}`,
      );
      const dirRaw = await callLLM({
        systemPrompt: directorSys,
        userMessage: dirUser,
        temperature: 0.25,
        jsonObject: true,
      });
      const dirParsed = parseJsonFromModelText(dirRaw);
      const dirAppendix =
        dirParsed && typeof dirParsed === 'object' && 'appendix' in dirParsed
          ? /** @type {{ appendix: unknown }} */ (dirParsed).appendix
          : null;
      appendixByIndex[index] = dirAppendix;

      fs.writeFileSync(path.join(directorDir, `${blockId}.json`), JSON.stringify(dirParsed, null, 2) + '\n', 'utf8');

      // ── v6 硬门 · Director 侧 ──
      const scriptChunk = /** @type {Record<string, unknown> | null} */ (
        /** @type {Record<string, unknown>} */ (dpPayload).scriptChunk
      );
      const infoContract = /** @type {{ max_none_ratio: number, consecutive_none_limit: number }} */ (
        /** @type {Record<string, unknown>} */ (dpPayload).infoDensityContract
      );

      const segGate = checkDirectorSegmentCoverageV6(dirAppendix, scriptChunk);
      const kvaGate = checkDirectorKvaCoverageV6(dirAppendix, scriptChunk, skipKvaHard);
      const infoGate = checkDirectorInfoDensityV6(dirAppendix, infoContract);

      const segOutcome = /** @type {HardgateOutcome} */ ({
        code: 'director_segment_coverage',
        status: skipSegHard && segGate.status === 'fail' ? 'warn' : segGate.status,
        reason: segGate.reason,
        block_id: blockId,
        detail: { coverage_ratio: segGate.coverage_ratio },
      });
      const kvaOutcome = /** @type {HardgateOutcome} */ ({
        code: 'director_kva_coverage',
        status: kvaGate.status,
        reason: kvaGate.reason,
        block_id: blockId,
        detail: { kva_ratio: kvaGate.kva_ratio },
      });
      const infoOutcome = /** @type {HardgateOutcome} */ ({
        code: 'director_info_density',
        status: skipInfoHard && infoGate.status === 'fail' ? 'warn' : infoGate.status,
        reason: infoGate.reason,
        block_id: blockId,
        detail: { none_ratio: infoGate.none_ratio, consecutive_max: infoGate.consecutive_max },
      });
      hardgateOutcomes.push(segOutcome, kvaOutcome, infoOutcome);

      // ── 块级 shot_budget 软门（沿用 v5） ──
      const biRowR = biRow && typeof biRow === 'object' ? biRow : null;
      const hintRaw = biRowR ? biRowR.shot_budget_hint : null;
      if (hintRaw && typeof hintRaw === 'object') {
        const hint = /** @type {Record<string, unknown>} */ (hintRaw);
        const tol = Array.isArray(hint.tolerance) ? hint.tolerance : null;
        const actualCount = extractShotCountFromDirector(dirParsed, blockId);
        if (actualCount !== null && tol && tol.length === 2) {
          const lo = Number(tol[0]);
          const hi = Number(tol[1]);
          if (Number.isFinite(lo) && Number.isFinite(hi) && (actualCount < lo || actualCount > hi)) {
            routingWarnings.push({
              code: 'shot_budget_per_block_check',
              severity: 'warn',
              block_id: blockId,
              actual: actualCount,
              expected: { target: hint.target, tolerance: [lo, hi] },
              message: `block ${blockId} 镜头数 ${actualCount} 超出预算 [${lo}, ${hi}]`,
            });
          }
        }
      }

      // ── Prompter payload ──
      const dirMd =
        dirParsed && typeof dirParsed === 'object' &&
        typeof /** @type {{ markdown_body?: string }} */ (dirParsed).markdown_body === 'string'
          ? /** @type {{ markdown_body: string }} */ (dirParsed).markdown_body
          : '';
      const section = extractDirectorMarkdownSectionForBlock(dirMd, blockId);

      const proLoad = loadKnowledgeSlicesV6({
        consumer: 'prompter',
        routing,
        aspectRatio,
        hasKva,
        slicesRoot,
      });
      const prompterPayload = buildPrompterPayloadV6({
        editMap,
        blockId,
        normalizedScriptPackage: normalizedPackage,
        kbDir,
        renderingStyle,
        artStyle,
        maxExamples,
        aspectRatio,
        directorMarkdownSection: section,
        knowledgeSlices: proLoad.slices,
      });
      mergedPayloads.push({ block_id: blockId, payload: prompterPayload });

      const prompterSys = appendKnowledgeSlicesToSystemPromptV6(prompterSysBase, proLoad.slices);
      const prUserObj = omitKnowledgeSlicesFromPayloadV6(
        /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(prompterPayload))),
      );
      const prUser = [
        '以下为单 Block 的 SD2Prompter v6 输入 JSON。',
        'v6 新字段同 Director：scriptChunk / styleInference / rhythmTimelineForBlock / infoDensityContract。',
        '对白保真铁律：scriptChunk.segments[] 中 dialogue/monologue/vo 类的 text 必须原样出现在 sd2_prompt 的 [DIALOG] 段；',
        '仅当 segment.author_hint.shortened_text 存在时才允许使用压缩后的文本。',
        '请严格按系统提示输出唯一一个 JSON 对象，不要 Markdown 围栏。',
        '',
        JSON.stringify(prUserObj, null, 2),
      ].join('\n');

      console.log(
        `[${SCRIPT_TAG}] ${blockId}：Prompter … slices=${proLoad.applied.length} tokens=${proLoad.total_tokens}/${proLoad.budget}`,
      );
      const prRaw = await callLLM({
        systemPrompt: prompterSys,
        userMessage: prUser,
        temperature: 0.35,
        jsonObject: true,
      });
      const prParsed = parseJsonFromModelText(prRaw);

      // ── v5 复用：@图N drift / AV-split / BGM 裸名 ──
      //
      // v5/v6 Prompter 契约：shots[]（每个 shot 有 sd2_prompt），而非顶层
      // 单字符串 sd2_prompt。此处优先顶层兜底（兼容旧格式），否则把
      // shots[].sd2_prompt 用 "\n\n" 串起来做整体扫描；修复后再写回
      // shots[].sd2_prompt（shot 级切片重新分配）。
      if (prParsed && typeof prParsed === 'object') {
        /** @type {unknown[]} */
        const shotsRaw = Array.isArray(/** @type {{ shots?: unknown }} */ (prParsed).shots)
          ? /** @type {{ shots: unknown[] }} */ (prParsed).shots
          : [];
        const topLevel =
          typeof /** @type {{ sd2_prompt?: string }} */ (prParsed).sd2_prompt === 'string'
            ? /** @type {{ sd2_prompt: string }} */ (prParsed).sd2_prompt
            : '';
        const shotPrompts = shotsRaw.map((s) =>
          s && typeof s === 'object' && typeof /** @type {{ sd2_prompt?: string }} */ (s).sd2_prompt === 'string'
            ? /** @type {{ sd2_prompt: string }} */ (s).sd2_prompt
            : '',
        );
        const sd2PromptOrig = topLevel || shotPrompts.join('\n\n');
        if (sd2PromptOrig) {
          const presentCount =
            biRow && Array.isArray(biRow.present_asset_ids)
              ? /** @type {unknown[]} */ (biRow.present_asset_ids).length
              : 8;
          const { sd2Prompt, drifts } = repairAssetTagDrift(sd2PromptOrig, presentCount);
          if (drifts.length > 0) {
            if (topLevel) {
              /** @type {{ sd2_prompt: string }} */ (prParsed).sd2_prompt = sd2Prompt;
            } else {
              // shots[] 形式：按顺序重新切分 "\n\n" 串起来的整段，回写每个 shot
              const fixedParts = sd2Prompt.split('\n\n');
              for (let i = 0; i < shotsRaw.length && i < fixedParts.length; i += 1) {
                const shot = /** @type {Record<string, unknown>} */ (shotsRaw[i]);
                if (shot && typeof shot === 'object') shot.sd2_prompt = fixedParts[i];
              }
            }
            routingWarnings.push({
              code: 'asset_tag_drift',
              severity: 'warn',
              block_id: blockId,
              actual: { drifted_tags: drifts },
              expected: { local_tag_range: `@图1..@图${presentCount}` },
              message: `block ${blockId} @图N 越界已替换为 @图DROP*`,
            });
          }
          // AV-split：shots[] 形式下逐镜头校验；topLevel 形式按整段一次性扫
          if (topLevel) {
            const avCheck = checkAvSplitFormat(sd2Prompt);
            if (!avCheck.ok) {
              routingWarnings.push({
                code: 'avsplit_format_failed',
                severity: 'warn',
                block_id: blockId,
                actual: { missing: avCheck.missing },
                expected: { labels_in_order: ['[FRAME]', '[DIALOG]', '[SFX]', '[BGM]'] },
                message: `block ${blockId} AV-split 缺少标签：${avCheck.missing.join(', ')}`,
              });
            }
          } else {
            /** @type {Array<{ shot_idx: number, missing: string[] }>} */
            const shotFails = [];
            for (let si = 0; si < shotPrompts.length; si += 1) {
              const sp = shotPrompts[si] || '';
              if (!sp) continue;
              const c = checkAvSplitFormat(sp);
              if (!c.ok) shotFails.push({ shot_idx: si + 1, missing: c.missing });
            }
            if (shotFails.length > 0) {
              routingWarnings.push({
                code: 'avsplit_format_failed',
                severity: 'warn',
                block_id: blockId,
                actual: { per_shot: shotFails.slice(0, 5) },
                expected: { labels_in_order: ['[FRAME]', '[DIALOG]', '[SFX]', '[BGM]'] },
                message: `block ${blockId} AV-split 缺标签的镜头：${shotFails.length}/${shotPrompts.length}`,
              });
            }
          }
          const bgmHits = detectBgmNameLeak(sd2Prompt);
          if (bgmHits.length > 0) {
            routingWarnings.push({
              code: 'bgm_name_leak',
              severity: 'warn',
              block_id: blockId,
              actual: { hits: bgmHits.slice(0, 5) },
              expected: { controlled_vocab: ['tension', 'release', 'suspense', 'bond', 'none'] },
              message: `block ${blockId} [BGM] 段出现具名元素`,
            });
          }

          // ── v6 硬门 · Prompter 对白保真（字符级匹配 scriptChunk.text） ──
          const fidGate = checkPrompterDialogueFidelityV6(sd2Prompt, scriptChunk);
          hardgateOutcomes.push({
            code: 'prompter_dialogue_fidelity',
            status: skipDialogueHard && fidGate.status === 'fail' ? 'warn' : fidGate.status,
            reason:
              fidGate.status === 'fail'
                ? `missing seg_ids=${fidGate.missing_seg_ids.slice(0, 5).join(',')}`
                : fidGate.status,
            block_id: blockId,
            detail: { missing_seg_ids: fidGate.missing_seg_ids },
          });
        }

        // ── v6.1 硬门 · Prompter 自检字段全套 ──
        // 即便 sd2_prompt 为空（shots[] 缺失），也能暴露 LLM 输出格式退化。
        const selfChecks = runAllPrompterSelfChecks(prParsed, scriptChunk);
        for (const sc of selfChecks) {
          hardgateOutcomes.push({
            code: sc.code,
            status: skipPrompterSelfHard && sc.status === 'fail' ? 'warn' : sc.status,
            reason: sc.reason,
            block_id: blockId,
            detail: sc.detail,
          });
        }
      }

      fs.writeFileSync(path.join(promptsDir, `${blockId}.json`), JSON.stringify(prParsed, null, 2) + '\n', 'utf8');
      rows[index] = { block_id: blockId, director_result: dirParsed, prompter_result: prParsed };

      routingTrace.push({
        block_id: blockId,
        routing,
        has_kva: hasKva,
        director: {
          applied: dirLoad.applied,
          truncated: dirLoad.truncated,
          total_tokens: dirLoad.total_tokens,
          budget: dirLoad.budget,
        },
        prompter: {
          applied: proLoad.applied,
          truncated: proLoad.truncated,
          total_tokens: proLoad.total_tokens,
          budget: proLoad.budget,
        },
      });
    } finally {
      resolveDone[index]();
    }
  }

  await Promise.all(list.map((_, i) => runOne(i)));

  /** @type {Array<{ block_id: string, director_result: unknown, prompter_result: unknown }>} */
  const rowsFlat = rows.filter((x) => x !== null);

  // ── 把 v6 硬门 outcomes 转成 warnings 记录 ──
  for (const o of hardgateOutcomes) {
    if (o.status === 'skip' || o.status === 'pass') {
      routingWarnings.push(hardgateToWarning(o));
      continue;
    }
    routingWarnings.push(hardgateToWarning(o));
  }

  // ── 聚合产出 ──
  /** @type {Array<{ block_id: string, result: unknown }>} */
  const directorBlocks = rowsFlat.map((r) => ({ block_id: r.block_id, result: r.director_result }));
  /** @type {Array<{ block_id: string, result: unknown }>} */
  const prompterBlocks = rowsFlat.map((r) => ({ block_id: r.block_id, result: r.prompter_result }));
  directorBlocks.sort((a, b) => a.block_id.localeCompare(b.block_id, undefined, { numeric: true }));
  prompterBlocks.sort((a, b) => a.block_id.localeCompare(b.block_id, undefined, { numeric: true }));
  mergedPayloads.sort((a, b) => a.block_id.localeCompare(b.block_id, undefined, { numeric: true }));
  routingTrace.sort((a, b) => String(a.block_id).localeCompare(String(b.block_id), undefined, { numeric: true }));

  const writeJson = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  const baseMeta = {
    source_edit_map: editMapPath,
    sd2_version: 'v6',
    generated_at: new Date().toISOString(),
    block_count: rowsFlat.length,
    stagger_ms: staggerMs,
    slices_root: path.resolve(slicesRoot),
    has_normalized_script_package: Boolean(normalizedPackage),
  };

  writeJson(path.join(outRoot, 'sd2_director_all.json'), {
    meta: { ...baseMeta, mode: 'block_chain_v6' },
    blocks: directorBlocks,
  });
  writeJson(path.join(outRoot, 'sd2_payloads.json'), {
    meta: { ...baseMeta, kind: 'sd2_prompter_payloads_v6', kb_dir: path.resolve(kbDir) },
    payloads: mergedPayloads,
  });
  writeJson(path.join(outRoot, 'sd2_prompts_all.json'), {
    meta: { ...baseMeta, mode: 'block_chain_v6' },
    blocks: prompterBlocks,
  });

  const warnCount = routingWarnings.filter((w) => w.severity === 'warn').length;
  const infoCount = routingWarnings.filter((w) => w.severity === 'info').length;
  writeJson(path.join(outRoot, 'sd2_routing_trace.json'), {
    meta: { ...baseMeta, warning_count: warnCount, info_count: infoCount },
    trace: routingTrace,
    routing_warnings: routingWarnings,
    v6_hardgate_outcomes: hardgateOutcomes,
  });

  // 回写 editMap（带 warnings · 与 v5 一致的审计轨迹）
  const appendixObj =
    editMap.appendix && typeof editMap.appendix === 'object'
      ? /** @type {Record<string, unknown>} */ (editMap.appendix)
      : null;
  if (appendixObj && appendixObj.meta && typeof appendixObj.meta === 'object') {
    const am = /** @type {Record<string, unknown>} */ (appendixObj.meta);
    if (!Array.isArray(am.routing_warnings)) am.routing_warnings = [];
    /** @type {unknown[]} */ (am.routing_warnings).push(...routingWarnings);
  }
  fs.writeFileSync(editMapPath, JSON.stringify(editMap, null, 2) + '\n', 'utf8');

  // ── v6 硬门总结 + exit 码 ──
  const hardFail = hardgateOutcomes.filter((o) => o.status === 'fail');
  console.log(`[${SCRIPT_TAG}] v6 硬门汇总：`);
  for (const o of hardgateOutcomes) {
    console.log(`  · ${o.code} @ ${o.block_id}: ${o.status} — ${o.reason}`);
  }
  console.log(`[${SCRIPT_TAG}] 路由审计 warnings=${warnCount} info=${infoCount}`);

  if (hardFail.length > 0) {
    console.error(
      `[${SCRIPT_TAG}] ❌ v6 硬门失败 ${hardFail.length} 项；如需降级请加 --allow-v6-soft 或对应 --skip-*-hard`,
    );
    process.exit(8);
  }
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error(`[${SCRIPT_TAG}]`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
