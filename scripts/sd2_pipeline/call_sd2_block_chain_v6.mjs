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
 *      默认降级为 warning 并完整落盘；显式 --strict-quality-hard 才恢复 exit 8。
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
  getLlmTraceSnapshot,
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
  reconcileKvaWithPrompterV6,
  repairAssetTagDrift,
} from './lib/sd2_block_chain_v6_helpers.mjs';
import { runAllPrompterSelfChecks } from './lib/sd2_prompter_selfcheck_v6.mjs';
import { shouldRetryPrompter } from './lib/sd2_prompter_anomaly_v6.mjs';
import {
  buildCharacterWhitelist,
  checkCharacterWhitelistForBlock,
} from './lib/sd2_character_whitelist_v6.mjs';
import {
  checkMaxDialoguePerShot,
  checkMinShotsPerBlock,
} from './lib/sd2_shot_structure_v6.mjs';
import { resolveV6HardgateOptions } from './lib/sd2_hardgate_options_v6.mjs';
import {
  normalizeShotTimecodes,
  polishShortDramaRhythmLanguage,
  repairAssetTagReferences,
  sanitizeTextOverlayNegations,
} from './lib/sd2_prompt_repair_v6.mjs';

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

/** 导出供 `call_sd2_block_chain_v6_doubao.mjs` 等入口在设置好 `SD2_LLM_*` 后动态 import 调用。 */
export async function main() {
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
    const {
      allowV6Soft,
      strictQualityHard,
      skipKvaHard,
      skipSegHard,
      skipInfoHard,
      skipDialogueHard,
      skipPrompterSelfHard,
      skipDialoguePerShotHard,
      skipMinShotsHard,
      skipCharacterWhitelistHard,
    } = resolveV6HardgateOptions(args);
    // HOTFIX L/M 默认参数（可通过 CLI 微调；不建议业务使用）
    const maxDialoguePerShot = Math.max(
      1,
      parseInt(String(args['max-dialogue-per-shot'] !== undefined ? args['max-dialogue-per-shot'] : '2'), 10) || 2,
    );
    const minShotsFloor = Math.max(
      1,
      parseInt(String(args['min-shots-floor'] !== undefined ? args['min-shots-floor'] : '2'), 10) || 2,
    );
    const segsPerShotCeil = Math.max(
      1,
      parseInt(String(args['segs-per-shot-ceil'] !== undefined ? args['segs-per-shot-ceil'] : '4'), 10) || 4,
    );

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

  // HOTFIX N · 尝试读取同目录 edit_map_input.json（承载 assetManifest.characters），
  //   用于角色白名单硬门；读不到则 gate 自动降级为 skip。
  const editMapInputPath = path.join(outRoot, 'edit_map_input.json');
  /** @type {unknown | null} */
  let editMapInputForWhitelist = null;
  if (fs.existsSync(editMapInputPath)) {
    try {
      const raw = fs.readFileSync(editMapInputPath, 'utf8');
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') editMapInputForWhitelist = obj;
    } catch (err) {
      console.warn(
        `[${SCRIPT_TAG}] 读取 edit_map_input.json 失败（将跳过 character_token_integrity_check）：${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
    console.warn(
      `[${SCRIPT_TAG}] 未找到 ${editMapInputPath}，character_token_integrity_check 将自动 skip`,
    );
  }

  // HOTFIX P · 只在 main() 入口采一次 LLM trace 快照，后续所有产物都引用它；
  //   产物文件 **不含** API Key，只含 provider / base_url / model / 几个调用开关。
  const llmTraceSnapshot = getLlmTraceSnapshot();
  console.log(
    `[${SCRIPT_TAG}] HOTFIX P · llm_trace provider=${llmTraceSnapshot.provider} model=${llmTraceSnapshot.model}` +
      ` json_fmt_disabled=${llmTraceSnapshot.json_response_format_disabled} max_out=${llmTraceSnapshot.max_output_tokens}`,
  );
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
  const cliAspect = typeof args['aspect-ratio'] === 'string' ? args['aspect-ratio'].trim() : '';
  const aspectRatio = cliAspect || metaAspect || '9:16';

  // HOTFIX S · Fix A · 画幅单一真相源：
  //   EditMap v6 的 `meta.video.aspect_ratio` 是 LLM 在 Stage 1 自由填写的，
  //   实战中经常与 Stage 2/3 实际执行的画幅不一致（leji-v6-apimart 实锤：
  //   meta 写 "9:16"，CLI 跑 "16:9"，Qwen 把 "9:16" 带进 global_prefix 污染了所有 prompt）。
  //   统一口径：CLI 传了 --aspect-ratio 就以 CLI 为权威，强制写回 editMap.meta.video.aspect_ratio，
  //   保证下游 Prompter 从 editMap 里读到的画幅与 CLI 一致；同时 emit 一条 warn
  //   供审计追溯 LLM 原填的值与覆盖后的值。
  if (cliAspect && cliAspect !== metaAspect) {
    if (!editMap.meta || typeof editMap.meta !== 'object') editMap.meta = {};
    const meta = /** @type {Record<string, unknown>} */ (editMap.meta);
    if (!meta.video || typeof meta.video !== 'object') meta.video = {};
    /** @type {Record<string, unknown>} */ (meta.video).aspect_ratio = cliAspect;
    routingWarnings.push({
      code: 'aspect_ratio_source_mismatch',
      severity: 'warn',
      block_id: null,
      actual: { edit_map_meta: metaAspect || null, cli: cliAspect },
      expected: { single_source: 'cli --aspect-ratio' },
      message: `edit_map.meta.video.aspect_ratio=${metaAspect || '(empty)'} 与 CLI --aspect-ratio=${cliAspect} 不一致；已以 CLI 为准覆盖。`,
    });
  }

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
      `[${SCRIPT_TAG}] 降级 flags: allowV6Soft=${allowV6Soft} kva=${!skipKvaHard} seg=${!skipSegHard} info=${!skipInfoHard} dialogue=${!skipDialogueHard} qualityHard=${strictQualityHard}`,
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
        '题材裁决：若剧本含医院、夫妻、出轨、怀孕、手术、权力竞聘等信号，按“都市医疗婚恋背叛短剧”设计镜头，不按医疗科普/纪实剧设计。',
        '节奏裁决：每个 shot 必须承载新的情绪或信息增量；优先偷听视角、门缝窥视、手机/诊断书/腹部/衣领特写、反应反打、分屏反差；避免连续平视固定中景。',
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

      const expectedPrompterShotCount =
        prompterPayload &&
        typeof prompterPayload === 'object' &&
        prompterPayload.v5Meta &&
        typeof prompterPayload.v5Meta === 'object' &&
        Array.isArray(/** @type {{ shotSlots?: unknown }} */ (prompterPayload.v5Meta).shotSlots)
          ? /** @type {unknown[]} */ (/** @type {{ shotSlots: unknown[] }} */ (prompterPayload.v5Meta).shotSlots).length
          : null;

      const prompterSys = appendKnowledgeSlicesToSystemPromptV6(prompterSysBase, proLoad.slices);
      const prUserObj = omitKnowledgeSlicesFromPayloadV6(
        /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(prompterPayload))),
      );
      const prUser = [
        '以下为单 Block 的 SD2Prompter v6 输入 JSON。',
        'v6 新字段同 Director：scriptChunk / styleInference / rhythmTimelineForBlock / infoDensityContract。',
        expectedPrompterShotCount
          ? `镜头合同：v5Meta.shotSlots 已锁定本 block 必须输出 ${expectedPrompterShotCount} 个 shots[]；每个 slot 对应一个且只能一个 final shot，禁止合并、删除、改时长。`
          : '',
        '题材裁决：若剧本含医院、夫妻、出轨、怀孕、手术、院长竞聘、绿茶/小三等信号，本 block 必须按“都市医疗婚恋背叛短剧”拍，不按冷静医疗纪录片拍。',
        '节奏裁决：每 2-3 秒必须出现一个新的情绪/信息钩子（偷听、门缝、手机、诊断书、腹部、衣领、反应特写、分屏反差）；禁止连续复用“中景，平视，固定镜头”。',
        '镜头裁决：优先门缝窥视、压迫近景、快速反打、手部/腹部/手机/诊断书特写、缓慢推近、短暂停顿；保留现实质感，但情绪强度要服务短剧爽点和讽刺反差。',
        '对白保真铁律：scriptChunk.segments[] 中 dialogue/monologue/vo 类的 text 必须原样出现在 sd2_prompt 的 [DIALOG] 段；',
        '仅当 segment.author_hint.shortened_text 存在时才允许使用压缩后的文本。',
        '时间码必须使用合法 MM:SS–MM:SS；秒位不得超过 59。',
        '请严格按系统提示输出唯一一个 JSON 对象，不要 Markdown 围栏。',
        '',
        JSON.stringify(prUserObj, null, 2),
      ].filter(Boolean).join('\n');

      console.log(
        `[${SCRIPT_TAG}] ${blockId}：Prompter … slices=${proLoad.applied.length} tokens=${proLoad.total_tokens}/${proLoad.budget}`,
      );

      // ── HOTFIX I · Prompter 产物异常自动重试 ──
      //   偶发的 repetition collapse（如 global_prefix 被"偶像剧、家庭剧…"循环撑爆）
      //   或 tail-field-missing（LLM 只写到 shots + global_prefix 就停）会让整个 block
      //   的自检字段全丢、下游硬门只能 skip。这里检测到异常就用更高的温度重试 1 次，
      //   既避免陷入同一采样分支，也不放任坏样本污染产物。
      /** @type {{ temperature: number, tag: string }[]} */
      const prAttemptPlan = [
        { temperature: 0.35, tag: 'initial' },
        { temperature: 0.55, tag: 'retry_anomaly' },
      ];
      /** @type {unknown} */
      let prParsed = null;
      /** @type {string[]} */
      const prRetryReasons = [];
      for (let attemptIdx = 0; attemptIdx < prAttemptPlan.length; attemptIdx += 1) {
        const plan = prAttemptPlan[attemptIdx];
        const rawText = await callLLM({
          systemPrompt: prompterSys,
          userMessage: prUser,
          temperature: plan.temperature,
          jsonObject: true,
        });
        const parsed = parseJsonFromModelText(rawText);
        const verdict = shouldRetryPrompter(parsed, expectedPrompterShotCount);
        if (!verdict.shouldRetry) {
          prParsed = parsed;
          if (attemptIdx > 0) {
            console.log(
              `[${SCRIPT_TAG}] ${blockId}：Prompter 重试 ${attemptIdx} 次后产物通过完整性检查（原因：${prRetryReasons.join('；')}）。`,
            );
          }
          break;
        }
        prRetryReasons.push(...verdict.reasons);
        if (attemptIdx < prAttemptPlan.length - 1) {
          console.warn(
            `[${SCRIPT_TAG}] ${blockId}：Prompter 产物异常（${verdict.reasons.join('；')}），以 temperature=${prAttemptPlan[attemptIdx + 1].temperature} 自动重试…`,
          );
        } else {
          // 最后一次仍失败：保留最后一次解析结果，让下游硬门来处理
          console.error(
            `[${SCRIPT_TAG}] ${blockId}：Prompter 已尝试 ${prAttemptPlan.length} 次仍异常（${verdict.reasons.join('；')}），交由下游硬门处置。`,
          );
          prParsed = parsed;
        }
      }

      // ── HOTFIX S.1 · director_kva_coverage 二次裁决 ──
      //   Director 独判时常因漏登记 kva_consumption_report 而假阳性 fail
      //   （doubao-s 回测实锤：B04/B06/B14 Director 填 None 但 Prompter 实际画了）。
      //   Prompter 自检的 kva_visualization_check 是真实履约证据，在此合并两侧，
      //   对已 push 的 kvaOutcome 做原地改写；合并后 ≥1.0 就从 fail 降为 pass。
      //   不新增硬门，只让已有硬门更准。
      reconcileKvaWithPrompterV6(kvaOutcome, dirAppendix, prParsed, scriptChunk, skipKvaHard);

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
        const blockTime =
          biRow && typeof biRow === 'object'
            ? {
                start_sec: Number(/** @type {Record<string, unknown>} */ (biRow).start_sec),
                end_sec: Number(/** @type {Record<string, unknown>} */ (biRow).end_sec),
                duration: Number(/** @type {Record<string, unknown>} */ (biRow).duration),
              }
            : null;
        const timecodeRepair = topLevel ? { changed: 0 } : normalizeShotTimecodes(shotsRaw, blockTime);
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
          let sd2Prompt = sd2PromptOrig;
          const writeBackPrompt = () => {
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
          };

          const driftRepair = repairAssetTagDrift(sd2Prompt, presentCount);
          sd2Prompt = driftRepair.sd2Prompt;
          const assetRepair = repairAssetTagReferences(sd2Prompt, prompterPayload.assetTagMapping, {
            injectDeclaration: false,
          });
          sd2Prompt = assetRepair.sd2Prompt;
          const rhythmPolish = polishShortDramaRhythmLanguage(sd2Prompt);
          sd2Prompt = rhythmPolish.sd2Prompt;
          if (assetRepair.declaration) {
            const curPrefix =
              typeof /** @type {{ global_prefix?: unknown }} */ (prParsed).global_prefix === 'string'
                ? /** @type {{ global_prefix: string }} */ (prParsed).global_prefix
                : '';
            if (!curPrefix.includes(assetRepair.declaration)) {
              /** @type {{ global_prefix: string }} */ (prParsed).global_prefix = curPrefix.trim()
                ? `${curPrefix}\n${assetRepair.declaration}`
                : assetRepair.declaration;
            }
          }
          const textRepair = sanitizeTextOverlayNegations(sd2Prompt);
          sd2Prompt = textRepair.sd2Prompt;
          let globalSuffixRemovedLines = 0;
          let globalPrefixRemovedLines = 0;
          if (typeof /** @type {{ global_prefix?: unknown }} */ (prParsed).global_prefix === 'string') {
            const prefixRepair = sanitizeTextOverlayNegations(
              /** @type {{ global_prefix: string }} */ (prParsed).global_prefix,
            );
            if (prefixRepair.sd2Prompt !== /** @type {{ global_prefix: string }} */ (prParsed).global_prefix) {
              /** @type {{ global_prefix: string }} */ (prParsed).global_prefix = prefixRepair.sd2Prompt;
            }
            globalPrefixRemovedLines = prefixRepair.removed_lines;
          }
          if (typeof /** @type {{ global_suffix?: unknown }} */ (prParsed).global_suffix === 'string') {
            const suffixRepair = sanitizeTextOverlayNegations(
              /** @type {{ global_suffix: string }} */ (prParsed).global_suffix,
            );
            if (suffixRepair.sd2Prompt !== /** @type {{ global_suffix: string }} */ (prParsed).global_suffix) {
              /** @type {{ global_suffix: string }} */ (prParsed).global_suffix = suffixRepair.sd2Prompt;
            }
            globalSuffixRemovedLines = suffixRepair.removed_lines;
          }
          if (sd2Prompt !== sd2PromptOrig) {
            writeBackPrompt();
          }

          if (driftRepair.drifts.length > 0) {
            routingWarnings.push({
              code: 'asset_tag_drift',
              severity: 'warn',
              block_id: blockId,
              actual: { drifted_tags: driftRepair.drifts },
              expected: { local_tag_range: `@图1..@图${presentCount}` },
              message: `block ${blockId} @图N 越界已替换为 @图DROP*`,
            });
          }
          if (assetRepair.inserted_tags.length > 0) {
            routingWarnings.push({
              code: 'asset_tag_reference_repaired',
              severity: 'info',
              block_id: blockId,
              actual: { inserted_tags: assetRepair.inserted_tags },
              expected: { prompt_uses_asset_tags: true },
              message: `block ${blockId} 裸资产名已补写为 @图N（资产名）`,
            });
          }
          if (timecodeRepair.changed > 0) {
            routingWarnings.push({
              code: 'timecode_normalized',
              severity: 'info',
              block_id: blockId,
              actual: { changed: timecodeRepair.changed },
              expected: { format: 'MM:SS–MM:SS', seconds_lt_60: true },
              message: `block ${blockId} 时间码已按 block 时间轴归一化`,
            });
          }
          if (rhythmPolish.replacements > 0) {
            routingWarnings.push({
              code: 'short_drama_rhythm_polished',
              severity: 'info',
              block_id: blockId,
              actual: { replacements: rhythmPolish.replacements },
              expected: { avoid_repeated_fixed_mid_shots: true },
              message: `block ${blockId} 已替换平视固定模板为短剧冲突镜头语法`,
            });
          }
          if (textRepair.removed_lines + globalPrefixRemovedLines + globalSuffixRemovedLines > 0) {
            routingWarnings.push({
              code: 'positive_prompt_text_token_sanitized',
              severity: 'info',
              block_id: blockId,
              actual: { removed_lines: textRepair.removed_lines + globalPrefixRemovedLines + globalSuffixRemovedLines },
              expected: { no_text_overlay_tokens_in_global_suffix: true },
              message: `block ${blockId} 已移除全局后缀中的文字/字幕负向描述`,
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

      // HOTFIX I · 将异常重试轨迹写进产物（便于审计，不影响下游 schema）
      if (prParsed && typeof prParsed === 'object' && !Array.isArray(prParsed) && prRetryReasons.length > 0) {
        /** @type {Record<string, unknown>} */ (prParsed)._v6_anomaly_retry = {
          attempts: prRetryReasons.length + 1,
          reasons: prRetryReasons,
          hotfix: 'I',
        };
      }

      // ── HOTFIX L · max_dialogue_per_shot 硬门 ──
      const dlgPerShotGate = checkMaxDialoguePerShot(prParsed, maxDialoguePerShot);
      hardgateOutcomes.push({
        code: 'max_dialogue_per_shot',
        status:
          skipDialoguePerShotHard && dlgPerShotGate.status === 'fail' ? 'warn' : dlgPerShotGate.status,
        reason: dlgPerShotGate.reason,
        block_id: blockId,
        detail: { offenders: dlgPerShotGate.offenders, max_per_shot: dlgPerShotGate.max_per_shot },
      });

      // ── HOTFIX M · 块局部 min_shots_per_block 硬下限 ──
      const scriptChunkForM = /** @type {Record<string, unknown> | null} */ (
        /** @type {Record<string, unknown>} */ (dpPayload).scriptChunk
      );
      const segCountForM =
        scriptChunkForM && Array.isArray(/** @type {{ segments?: unknown[] }} */ (scriptChunkForM).segments)
          ? /** @type {unknown[]} */ (/** @type {{ segments: unknown[] }} */ (scriptChunkForM).segments).length
          : 0;
      const minShotsGate = checkMinShotsPerBlock(prParsed, segCountForM, {
        minShotsFloor,
        segsPerShotCeil,
      });
      hardgateOutcomes.push({
        code: 'min_shots_per_block',
        status: skipMinShotsHard && minShotsGate.status === 'fail' ? 'warn' : minShotsGate.status,
        reason: minShotsGate.reason,
        block_id: blockId,
        detail: {
          required: minShotsGate.required,
          actual: minShotsGate.actual,
          seg_count: minShotsGate.seg_count,
        },
      });

      // ── HOTFIX N · character_token_integrity_check 白名单硬门 ──
      const whitelist = buildCharacterWhitelist({
        editMapInput: /** @type {import('./lib/sd2_character_whitelist_v6.mjs').EditMapInputLike | null} */ (
          editMapInputForWhitelist
        ),
        scriptChunk: /** @type {import('./lib/sd2_character_whitelist_v6.mjs').ScriptChunkLike | null} */ (
          scriptChunkForM
        ),
      });
      const charGate = checkCharacterWhitelistForBlock(prParsed, whitelist);
      hardgateOutcomes.push({
        code: 'character_token_integrity',
        status: skipCharacterWhitelistHard && charGate.status === 'fail' ? 'warn' : charGate.status,
        reason: charGate.reason,
        block_id: blockId,
        detail: {
          unknown_tokens: charGate.unknown_tokens,
          per_shot: charGate.per_shot,
          whitelist_size: charGate.whitelist_size,
        },
      });

      // ── HOTFIX P · 把 LLM trace 注入到每个 Bxx.json 顶层，便于审计哪一轮是豆包/qwen ──
      if (prParsed && typeof prParsed === 'object' && !Array.isArray(prParsed)) {
        /** @type {Record<string, unknown>} */ (prParsed)._llm_trace = {
          ...llmTraceSnapshot,
          stage: 'prompter',
          block_id: blockId,
          hotfix: 'P',
        };
      }
      if (dirParsed && typeof dirParsed === 'object' && !Array.isArray(dirParsed)) {
        /** @type {Record<string, unknown>} */ (dirParsed)._llm_trace = {
          ...llmTraceSnapshot,
          stage: 'director',
          block_id: blockId,
          hotfix: 'P',
        };
        // director_prompts/${blockId}.json 已在前面写入；此处补写一遍以带上 trace
        fs.writeFileSync(
          path.join(directorDir, `${blockId}.json`),
          JSON.stringify(dirParsed, null, 2) + '\n',
          'utf8',
        );
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
    /** HOTFIX P · 整轮 LLM 调用快照，用于审计链（每个 Bxx.json 顶层亦有同样的 _llm_trace） */
    llm_trace: llmTraceSnapshot,
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
