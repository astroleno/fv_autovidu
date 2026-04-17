#!/usr/bin/env node
/**
 * SD2 v5：每 Block 内 Director → Prompter；Block 间调度规则（与 v4 相同）：
 *   - 同 scene_run_id 串行（需 continuity_out）；不同 scene_run_id 可并行。
 *
 * 与 v4 的差异：
 *   1. 用 lib/knowledge_slices_v5.mjs 的 canonical routing 匹配器（structural /
 *      satisfaction / psychology_group / shot_hint / paywall_level / aspect_ratio）；
 *   2. 在入口做一次 derivePsychologyGroupOnBlocks：把 meta.psychology_plan[] 按 block_id
 *      反查 group 回填到 block_index[i].routing.psychology_group（编排层派生字段）；
 *   3. 用 lib/sd2_v5_payloads.mjs 构造 Director / Prompter 入参（透传 v5Meta 等新字段）；
 *   4. 每 block 生成 routing_trace 条目（applied + truncated），汇总写入
 *      `outRoot/sd2_routing_trace.json`（编排层审计产物，LLM 不感知）。
 *
 * 其余（--serial / --stagger-ms / --block / --kb-dir / --slices-root / --aspect-ratio /
 * Director & Prompter 温度 / LocalMapping @图N 校验）与 v4 完全一致。
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
  appendKnowledgeSlicesToSystemPrompt,
  derivePsychologyGroupOnBlocks,
  extractRoutingForBlock,
  loadKnowledgeSlicesV5,
  omitKnowledgeSlicesFromPayload,
} from './lib/knowledge_slices_v5.mjs';
import {
  assertV5PromptFileExists,
  getDirectorSd2V5PromptPath,
  getKnowledgeSlicesRootPath,
  getPrompterSd2V5PromptPath,
} from './lib/sd2_prompt_paths_v5.mjs';
import {
  buildDirectorPayloadV5,
  buildPrompterPayloadV5,
  computePrevBlockContextForDirectorV5,
  extractDirectorMarkdownSectionForBlock,
} from './lib/sd2_v5_payloads.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_KB = path.join(
  REPO_ROOT,
  'prompt',
  '1_SD2Workflow',
  '3_FewShotKnowledgeBase',
);

/**
 * @param {string[]} argv
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
 * 读取 block_index 中某 block_id 对应的一行（兼容 block_id / id 两种命名）。
 * @param {unknown} editMap
 * @param {string} blockId
 */
function getBlockIndexRow(editMap, blockId) {
  const appendix = /** @type {{ block_index?: unknown[] }} */ (editMap.appendix);
  const rows = Array.isArray(appendix?.block_index) ? appendix.block_index : [];
  return (
    rows.find((x) => {
      if (!x || typeof x !== 'object') {
        return false;
      }
      const r = /** @type {Record<string, unknown>} */ (x);
      return r.block_id === blockId || r.id === blockId;
    }) || null
  );
}

/**
 * v5.0 HOTFIX：一条 routing_warning 结构（对齐 07_v5-schema-冻结.md §七·附）。
 *
 * @typedef {Object} RoutingWarning
 * @property {string}  code       ∈ routing_warning_code 枚举
 * @property {'warn'|'info'} severity
 * @property {string|null} block_id
 * @property {unknown} actual
 * @property {Record<string, unknown>} expected
 * @property {string}  message
 */

/**
 * v5.0 HOTFIX：AV-split 四段切正则（T11 硬门 H5 副校验）。
 * 合规要求：每 shot 块都要**依序**包含 `[FRAME]` / `[DIALOG]` / `[SFX]` / `[BGM]` 四段。
 * 这里用 `indexOf` 的顺序检查，而非单一正则——避免跨 shot 误匹配。
 *
 * @param {string} sd2Prompt
 * @returns {{ ok: boolean, missing: string[] }}  missing 列表为 0+ 个缺失标签
 */
function checkAvSplitFormat(sd2Prompt) {
  const labels = ['[FRAME]', '[DIALOG]', '[SFX]', '[BGM]'];
  /** @type {string[]} */
  const missing = [];
  let cursor = 0;
  for (const lab of labels) {
    const at = sd2Prompt.indexOf(lab, cursor);
    if (at < 0) {
      missing.push(lab);
      continue;
    }
    cursor = at + lab.length;
  }
  return { ok: missing.length === 0, missing };
}

/**
 * v5.0 HOTFIX：BGM 裸名正则（T11 硬门 H5 副校验 · BGM 不具名）。
 * `[BGM]` 段只允许受控方向词；出现具名乐器 / 人名 / 歌名 即告警。
 *
 * 合法词：tension / release / suspense / bond / none（详见 06_ §3.6）。
 *
 * @param {string} sd2Prompt
 * @returns {string[]}  命中的违禁词列表（每个 `[BGM]` 段独立抽检）
 */
function detectBgmNameLeak(sd2Prompt) {
  /** 每个 `[BGM]` 段之后、下一个 `[` 前的文本 */
  const bgmSegments = [...sd2Prompt.matchAll(/\[BGM\]([^\[]*)/g)].map((m) => m[1] || '');
  /** 简化的违禁词：常见乐器 / 中文人名两字 空格 英文名 等 */
  const forbiddenPatterns = [
    /钢琴|吉他|弦乐|交响|架子鼓|萨克斯|电子鼓|提琴/,
    /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/, // 英文人名两段式
    /周杰伦|林俊杰|王菲|陈奕迅/,
  ];
  /** @type {string[]} */
  const hits = [];
  for (const seg of bgmSegments) {
    for (const pat of forbiddenPatterns) {
      const m = seg.match(pat);
      if (m) {
        hits.push(m[0]);
      }
    }
  }
  return hits;
}

/**
 * v5.0 HOTFIX：从 Director appendix.shot_count_per_block 取本 block 的 shot_count。
 * 兼容两种形态：
 *   - `{ appendix: { shot_count_per_block: [{ block_id|id, shot_count }, ...] } }`
 *   - 顶层 `{ shot_count_per_block: [...] }`（LLM 偶发写错层级）
 *
 * @param {unknown} dirParsed
 * @param {string} blockId
 * @returns {number|null}
 */
function extractShotCountFromDirector(dirParsed, blockId) {
  if (!dirParsed || typeof dirParsed !== 'object') {
    return null;
  }
  const obj = /** @type {Record<string, unknown>} */ (dirParsed);
  /** @type {unknown} */
  let list = null;
  if (obj.appendix && typeof obj.appendix === 'object') {
    const app = /** @type {Record<string, unknown>} */ (obj.appendix);
    if (Array.isArray(app.shot_count_per_block)) {
      list = app.shot_count_per_block;
    }
  }
  if (!list && Array.isArray(obj.shot_count_per_block)) {
    list = obj.shot_count_per_block;
  }
  if (!Array.isArray(list)) {
    return null;
  }
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const it = /** @type {Record<string, unknown>} */ (item);
    const bid = typeof it.block_id === 'string' ? it.block_id : typeof it.id === 'string' ? it.id : '';
    if (bid === blockId) {
      const sc = typeof it.shot_count === 'number' ? it.shot_count : Number(it.shot_count);
      return Number.isFinite(sc) && sc > 0 ? sc : null;
    }
  }
  return null;
}

/**
 * v5.0 治本 · S12 辅助：判断本 block 是否为 payoff block（Director v5 §9.1 识别规则）。
 * 任一条件成立即判定：
 *   1. block_index[i].routing.satisfaction[] 长度 ≥ 1；或
 *   2. editMap.meta.satisfaction_points[] 中存在条目 block_id == 本 block；或
 *   3. editMap.meta.psychology_plan[block_id == 本块].group == "payoff"（或同义词兜底到 payoff，但这里只看原始值）。
 *
 * @param {Record<string, unknown>} biRow     block_index[i]
 * @param {Record<string, unknown>} editMap   appendix 顶层（含 meta / block_index）
 * @param {string} blockId                    block_id
 * @returns {boolean}
 */
function isPayoffBlock(biRow, editMap, blockId) {
  // 1) routing.satisfaction 非空
  const routing =
    biRow.routing && typeof biRow.routing === 'object'
      ? /** @type {Record<string, unknown>} */ (biRow.routing)
      : null;
  if (routing && Array.isArray(routing.satisfaction) && routing.satisfaction.length > 0) {
    return true;
  }
  const meta =
    editMap.meta && typeof editMap.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (editMap.meta)
      : null;
  if (!meta) return false;

  // 2) meta.satisfaction_points[] 中含 block_id
  if (Array.isArray(meta.satisfaction_points)) {
    for (const p of meta.satisfaction_points) {
      if (p && typeof p === 'object' && /** @type {Record<string, unknown>} */ (p).block_id === blockId) {
        return true;
      }
    }
  }

  // 3) meta.psychology_plan[block_id == 本块].group == "payoff"
  if (Array.isArray(meta.psychology_plan)) {
    for (const p of meta.psychology_plan) {
      if (!p || typeof p !== 'object') continue;
      const pp = /** @type {Record<string, unknown>} */ (p);
      if (pp.block_id === blockId && pp.group === 'payoff') {
        return true;
      }
    }
  }

  return false;
}

/**
 * v5.0 治本 · S12 辅助：从 Director continuity_out.notes 中提取 `payoff_reaction_shots` 列表。
 * notes 可能是 string（单行）或 string[]（多行）；支持 `payoff_reaction_shots: [id1, id2]`
 * 或 `payoff_reaction_shots: id1, id2` 两种写法。
 *
 * @param {Record<string, unknown>} co   Director appendix.continuity_out
 * @returns {string[]}                   提取的 shot id 列表；未找到返回 []
 */
function extractPayoffReactionShots(co) {
  const raw = co.notes;
  /** @type {string} */
  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else if (Array.isArray(raw)) {
    text = raw.filter((x) => typeof x === 'string').join('\n');
  } else {
    return [];
  }
  const match = text.match(/payoff_reaction_shots\s*[:=]\s*\[?([^\]\n]+)\]?/i);
  if (!match) return [];
  const inner = match[1];
  return inner
    .split(/[,，]\s*/)
    .map((s) => s.trim().replace(/^["'`]|["'`]$/g, ''))
    .filter((s) => s.length > 0);
}

/**
 * 两块是否必须串行：仅当 scene_run_id 相同且均非空时。
 * @param {unknown} prevRow
 * @param {unknown} curRow
 */
function adjacentBlocksRequireSerial(prevRow, curRow) {
  const pr =
    prevRow && typeof prevRow === 'object'
      ? String(/** @type {{ scene_run_id?: unknown }} */ (prevRow).scene_run_id ?? '').trim()
      : '';
  const cr =
    curRow && typeof curRow === 'object'
      ? String(/** @type {{ scene_run_id?: unknown }} */ (curRow).scene_run_id ?? '').trim()
      : '';
  if (!pr || !cr) {
    return true;
  }
  return pr === cr;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const editMapPath =
    typeof args['edit-map'] === 'string'
      ? path.resolve(process.cwd(), args['edit-map'])
      : '';
  const directorPayloadsPath =
    typeof args['director-payloads'] === 'string'
      ? path.resolve(process.cwd(), args['director-payloads'])
      : '';
  const outRoot =
    typeof args['out-root'] === 'string'
      ? path.resolve(process.cwd(), args['out-root'])
      : '';

  if (!editMapPath || !fs.existsSync(editMapPath)) {
    console.error('请指定 --edit-map edit_map_sd2.json');
    process.exit(2);
  }
  if (!directorPayloadsPath || !fs.existsSync(directorPayloadsPath)) {
    console.error('请指定 --director-payloads sd2_director_payloads.json');
    process.exit(2);
  }
  if (!outRoot) {
    console.error('请指定 --out-root');
    process.exit(2);
  }

  const rawDp = JSON.parse(fs.readFileSync(directorPayloadsPath, 'utf8'));
  /** @type {Array<{ block_id?: string, payload?: unknown }>} */
  let list = Array.isArray(rawDp.payloads) ? rawDp.payloads : [];
  const blockFilter = typeof args.block === 'string' ? String(args.block).trim() : '';
  if (blockFilter) {
    list = list.filter((p) => p && p.block_id === blockFilter);
  }
  if (!list.length) {
    throw new Error(blockFilter ? `未找到 block: ${blockFilter}` : '无 director payload');
  }
  list.sort((a, b) =>
    String(a.block_id || '').localeCompare(String(b.block_id || ''), undefined, { numeric: true }),
  );

  const editMap = JSON.parse(fs.readFileSync(editMapPath, 'utf8'));

  /**
   * v5.0 HOTFIX：片级 / 块级软门告警累加器。
   * 所有软门违反都推到这里，最后写入 `sd2_routing_trace.json` 顶层 `routing_warnings[]`，
   * 并回写到 `editMap.appendix.meta.routing_warnings[]` / `editMap.meta.routing_warnings[]`。
   *
   * @type {RoutingWarning[]}
   */
  const routingWarnings = [];

  // v5 特有：编排层派生 psychology_group（LLM 不感知，只给切片路由用）
  //   v5.0 HOTFIX：derivePsychologyGroupOnBlocks 返回 resolutions[]，
  //   由同义词层兜底的（source='synonym'）写 info 级告警；完全未命中的（source='none'）写 warn。
  const psyResolutions = derivePsychologyGroupOnBlocks(editMap);
  for (const res of psyResolutions) {
    if (res.source === 'canonical') {
      continue; // 合规，不产事件
    }
    if (res.source === 'synonym') {
      routingWarnings.push({
        code: 'psychology_group_synonym_fallback',
        severity: 'info',
        block_id: res.block_id,
        actual: res.raw,
        expected: { mapped_to: res.canonical },
        message: `EditMap 使用自由词 "${res.raw}"，同义词层映射到 "${res.canonical}"`,
      });
    } else {
      // 'none'：既不在 canonical 也不在 synonym_map；不注入 psychology 切片
      routingWarnings.push({
        code: 'psychology_group_synonym_fallback',
        severity: 'warn',
        block_id: res.block_id,
        actual: res.raw,
        expected: { mapped_to: null },
        message: res.raw
          ? `EditMap psychology group "${res.raw}" 同义词层未命中，不注入 psychology 切片`
          : 'EditMap 未提供 psychology group，不注入 psychology 切片',
      });
    }
  }

  const renderingStyleCli =
    typeof args['rendering-style'] === 'string' && args['rendering-style'].trim()
      ? args['rendering-style'].trim()
      : '';
  const artStyleCli =
    typeof args['art-style'] === 'string' && args['art-style'].trim()
      ? args['art-style'].trim()
      : '';
  const { renderingStyle, artStyle } = resolveSd2StyleHints({
    cliRenderingStyle: renderingStyleCli,
    cliArtStyle: artStyleCli,
    editMapJsonPath: editMapPath,
    editMap,
  });
  console.log(`[call_sd2_block_chain_v5] 画面风格: renderingStyle=${renderingStyle}`);

  // v5：aspectRatio 优先从 meta.video.aspect_ratio 取，CLI 仅做强制覆盖
  const metaVideo =
    editMap.meta && editMap.meta.video && typeof editMap.meta.video === 'object'
      ? /** @type {Record<string, unknown>} */ (editMap.meta.video)
      : {};
  const metaAspect = typeof metaVideo.aspect_ratio === 'string' ? metaVideo.aspect_ratio : '';
  const aspectRatio =
    typeof args['aspect-ratio'] === 'string' ? args['aspect-ratio'] : metaAspect || '9:16';

  const kbDir =
    typeof args['kb-dir'] === 'string'
      ? path.resolve(process.cwd(), args['kb-dir'])
      : DEFAULT_KB;
  const slicesRoot =
    typeof args['slices-root'] === 'string'
      ? path.resolve(process.cwd(), args['slices-root'])
      : getKnowledgeSlicesRootPath();

  const maxExamples = Math.max(
    1,
    parseInt(String(args['max-examples'] !== undefined ? args['max-examples'] : '2'), 10) || 2,
  );

  const staggerMs = Math.max(
    0,
    parseInt(String(args['stagger-ms'] !== undefined ? args['stagger-ms'] : '0'), 10) || 0,
  );

  const forceSerial = args.serial === true;

  const prompterPromptPath =
    typeof args['prompter-prompt'] === 'string' && args['prompter-prompt'].trim()
      ? path.resolve(process.cwd(), args['prompter-prompt'].trim())
      : getPrompterSd2V5PromptPath();
  assertV5PromptFileExists(prompterPromptPath);

  const directorPromptPath =
    typeof args['director-prompt'] === 'string' && args['director-prompt'].trim()
      ? path.resolve(process.cwd(), args['director-prompt'].trim())
      : getDirectorSd2V5PromptPath();
  assertV5PromptFileExists(directorPromptPath);

  const directorSysBase = fs.readFileSync(directorPromptPath, 'utf8');
  const prompterSysBase = fs.readFileSync(prompterPromptPath, 'utf8');

  const directorDir = path.join(outRoot, 'director_prompts');
  const promptsDir = path.join(outRoot, 'prompts');
  fs.mkdirSync(directorDir, { recursive: true });
  fs.mkdirSync(promptsDir, { recursive: true });

  /** @type {Array<{ block_id: string, payload: unknown }>} */
  const mergedPayloads = [];

  const meta =
    editMap.meta && typeof editMap.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (editMap.meta)
      : {};
  const parsedBrief = meta.parsed_brief ?? null;
  void parsedBrief;

  /** 统计并行度（仅日志） */
  let parallelEdges = 0;
  for (let ii = 1; ii < list.length; ii += 1) {
    const a = list[ii - 1].block_id;
    const b = list[ii].block_id;
    if (!a || !b) {
      continue;
    }
    const pRow = getBlockIndexRow(editMap, a);
    const cRow = getBlockIndexRow(editMap, b);
    if (!forceSerial && !adjacentBlocksRequireSerial(pRow, cRow)) {
      parallelEdges += 1;
    }
  }

  console.log(
    `[call_sd2_block_chain_v5] Director+Prompter v5；model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()} blocks=${list.length}；` +
      `调度=${forceSerial ? '强制串行' : `按 scene_run_id（可并行边≈${parallelEdges}）`} slicesRoot=${slicesRoot} aspectRatio=${aspectRatio}`,
  );
  console.log(`[call_sd2_block_chain_v5] Director 提示词: ${directorPromptPath}`);
  console.log(`[call_sd2_block_chain_v5] Prompter 提示词: ${prompterPromptPath}`);

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

  /** 路由审计产物：每 block 一条（编排层产出） */
  /** @type {Array<Record<string, unknown>>} */
  const routingTrace = [];

  /**
   * @param {number} index
   */
  async function runOne(index) {
    try {
      const entry = list[index];
      const blockId = entry.block_id;
      if (!blockId || !entry.payload) {
        return;
      }

      const prevRow = index > 0 ? getBlockIndexRow(editMap, list[index - 1].block_id) : null;
      const biRow = getBlockIndexRow(editMap, blockId);

      const mustWaitForPrevDirector =
        index > 0 &&
        (forceSerial ||
          (prevRow && biRow ? adjacentBlocksRequireSerial(prevRow, biRow) : true));

      if (mustWaitForPrevDirector) {
        await done[index - 1];
      }

      if (staggerMs > 0) {
        await new Promise((r) => setTimeout(r, index * staggerMs));
      }

      const prevAppendixForCtx = mustWaitForPrevDirector ? appendixByIndex[index - 1] : null;
      const prevCtx = computePrevBlockContextForDirectorV5(prevAppendixForCtx, prevRow, biRow);

      // 取 canonical routing（已派生 psychology_group）
      const routing = extractRoutingForBlock(biRow);

      // ── Director 切片（v5 匹配器）──
      const dirLoad = loadKnowledgeSlicesV5({
        consumer: 'director',
        routing,
        aspectRatio,
        slicesRoot,
      });
      const dpPayload = buildDirectorPayloadV5({
        editMap,
        blockId,
        kbDir,
        renderingStyle,
        aspectRatio,
        maxExamples,
        knowledgeSlices: dirLoad.slices,
        prevBlockContext: prevCtx,
      });

      const directorSys = appendKnowledgeSlicesToSystemPrompt(directorSysBase, dirLoad.slices);
      const dirUserObj = omitKnowledgeSlicesFromPayload(
        /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(dpPayload))),
      );
      const dirUser = [
        '以下为单 Block 的 SD2Director v5 输入 JSON。',
        '包含 editMapParagraph / blockIndex / assetTagMapping / prevBlockContext / v5Meta（video、psychology_plan、info_gap_ledger、proof_ladder、paywall_scaffolding 等）。knowledgeSlices 已注入 system。',
        '请严格按系统提示输出唯一一个 JSON 对象（含 markdown_body 与 appendix），不要 Markdown 围栏。',
        '',
        JSON.stringify(dirUserObj, null, 2),
      ].join('\n');

      console.log(`[call_sd2_block_chain_v5] ${blockId}：Director …（slices=${dirLoad.applied.length}, trunc=${dirLoad.truncated.length}, tokens=${dirLoad.total_tokens}/${dirLoad.budget}）`);
      const dirRaw = await callLLM({
        systemPrompt: directorSys,
        userMessage: dirUser,
        temperature: 0.25,
        jsonObject: true,
      });
      const dirParsed = parseJsonFromModelText(dirRaw);
      appendixByIndex[index] =
        dirParsed && typeof dirParsed === 'object' && 'appendix' in dirParsed
          ? /** @type {{ appendix: unknown }} */ (dirParsed).appendix
          : null;

      fs.writeFileSync(
        path.join(directorDir, `${blockId}.json`),
        JSON.stringify(dirParsed, null, 2) + '\n',
        'utf8',
      );

      // ── v5.0 HOTFIX：Director 侧块级软门校验 ──
      //   a) shot_budget_per_block_check：取 appendix.shot_count_per_block[blockId].shot_count
      //      vs biRow.shot_budget_hint.tolerance；超界写 warn。
      //   b) iron_rule_checklist_missing / _failed_item：appendix.iron_rule_checklist 缺失或任一 pass=false。
      //   c) protagonist_shot_ratio_below_min：appendix.protagonist_shot_ratio_actual < target 却 ratio_ok=true。
      if (dirParsed && typeof dirParsed === 'object') {
        const dirApp =
          /** @type {Record<string, unknown>} */ (dirParsed).appendix &&
          typeof /** @type {Record<string, unknown>} */ (dirParsed).appendix === 'object'
            ? /** @type {Record<string, unknown>} */ (
                /** @type {Record<string, unknown>} */ (dirParsed).appendix
              )
            : {};

        // (a) 块级镜头预算
        const biRowR =
          biRow && typeof biRow === 'object'
            ? /** @type {Record<string, unknown>} */ (biRow)
            : null;
        const hintRaw = biRowR ? biRowR.shot_budget_hint : null;
        if (hintRaw && typeof hintRaw === 'object') {
          const hint = /** @type {Record<string, unknown>} */ (hintRaw);
          const tol = Array.isArray(hint.tolerance) ? hint.tolerance : null;
          const actualCount = extractShotCountFromDirector(dirParsed, blockId);
          if (actualCount !== null && tol && tol.length === 2) {
            const lo = Number(tol[0]);
            const hi = Number(tol[1]);
            if (
              Number.isFinite(lo) &&
              Number.isFinite(hi) &&
              (actualCount < lo || actualCount > hi)
            ) {
              routingWarnings.push({
                code: 'shot_budget_per_block_check',
                severity: 'warn',
                block_id: blockId,
                actual: actualCount,
                expected: { target: hint.target, tolerance: [lo, hi] },
                message: `block ${blockId} 镜头数 ${actualCount} 超出预算 [${lo}, ${hi}]（target=${hint.target}）`,
              });
            }
          } else if (actualCount === null) {
            // Director 没写 shot_count_per_block → 无法审计块级预算，只记 info，不当 iron 漏报
            routingWarnings.push({
              code: 'shot_budget_per_block_check',
              severity: 'info',
              block_id: blockId,
              actual: null,
              expected: { field: 'appendix.shot_count_per_block[]' },
              message: `block ${blockId} Director 未输出 appendix.shot_count_per_block，跳过块级预算审计`,
            });
          }
        }

        // (b) iron_rule_checklist —— 位置修正：实际在 Prompter 顶层 dict（见 2_SD2Prompter-v5.md §示例）。
        //     这里为了代码集中，把判定挪到下面 Prompter 解析后的分支；此处仅做 Director appendix 诊断性提示。
        // （故意留空：Director 并不输出 iron_rule_checklist；Prompter 侧的校验见下面 §Prompter 后）

        // (c) protagonist_shot_ratio_actual —— 位置修正：Director appendix.continuity_out.*（见 2_SD2Director-v5.md §7）。
        //     字段名：protagonist_shot_ratio_actual（number）+ protagonist_shot_ratio_check（bool，LLM 自评）。
        const coRaw = dirApp.continuity_out;
        const co =
          coRaw && typeof coRaw === 'object'
            ? /** @type {Record<string, unknown>} */ (coRaw)
            : {};
        const ratioActualRaw = co.protagonist_shot_ratio_actual;
        const ratioOkRaw = co.protagonist_shot_ratio_check;
        if (typeof ratioActualRaw === 'number' && Number.isFinite(ratioActualRaw)) {
          const ratioActual = ratioActualRaw;
          /** meta 层的 target 目标（per_block_min），找不到就按 0.3 兜底 */
          let target = 0.3;
          const pbMeta =
            editMap.meta && typeof editMap.meta === 'object'
              ? /** @type {Record<string, unknown>} */ (editMap.meta)
              : {};
          const scaffoldRaw = pbMeta.paywall_scaffolding;
          if (scaffoldRaw && typeof scaffoldRaw === 'object') {
            const sc = /** @type {Record<string, unknown>} */ (scaffoldRaw);
            const psr =
              sc.protagonist_shot_ratio && typeof sc.protagonist_shot_ratio === 'object'
                ? /** @type {Record<string, unknown>} */ (sc.protagonist_shot_ratio)
                : null;
            if (psr && typeof psr.per_block_min === 'number') {
              target = psr.per_block_min;
            }
          }
          const reportedOk =
            ratioOkRaw === true ||
            (typeof ratioOkRaw === 'string' && ratioOkRaw.toLowerCase() === 'true');
          if (ratioActual + 1e-9 < target) {
            // 低于目标；若 LLM 仍报 ratio_ok=true，视为 false-green
            routingWarnings.push({
              code: 'protagonist_shot_ratio_below_min',
              severity: 'warn',
              block_id: blockId,
              actual: {
                protagonist_shot_ratio_actual: ratioActual,
                protagonist_shot_ratio_check: reportedOk,
              },
              expected: { per_block_min: target },
              message: reportedOk
                ? `block ${blockId} protagonist_shot_ratio_actual=${ratioActual} < ${target} 但 protagonist_shot_ratio_check=true（假绿）`
                : `block ${blockId} protagonist_shot_ratio_actual=${ratioActual} 低于 per_block_min=${target}`,
            });
          }

          // v5.0 治本 · S12：`payoff_protagonist_reaction_check`（07 §7.12）
          //   识别 payoff block 后，读 continuity_out.notes 里的 `payoff_reaction_shots:` 标记；
          //   若标记缺失 → 回退到 ratio_actual < 0.5 判定（payoff block 硬下限 0.5）。
          if (isPayoffBlock(biRow, editMap, blockId)) {
            const reactionShots = extractPayoffReactionShots(co);
            const hasReactionShots = reactionShots.length > 0;
            const PAYOFF_MIN_RATIO = 0.5;
            if (!hasReactionShots && ratioActual + 1e-9 < PAYOFF_MIN_RATIO) {
              routingWarnings.push({
                code: 'payoff_without_protagonist_reaction',
                severity: 'warn',
                block_id: blockId,
                actual: {
                  ratio_actual: ratioActual,
                  payoff_reaction_shots: reactionShots, // []
                  notes_present: typeof co.notes === 'string' || Array.isArray(co.notes),
                },
                expected: {
                  min_ratio: PAYOFF_MIN_RATIO,
                  or_notes: 'continuity_out.notes 中含 "payoff_reaction_shots: [shot_id,...]"',
                },
                message:
                  `block ${blockId} 判定为 payoff block，但未找到主角反应特写标记且 ratio_actual=${ratioActual} < ${PAYOFF_MIN_RATIO}；` +
                  `请人工复核 Director 画面（见 2_SD2Director-v5.md §9.1）。`,
              });
            }
          }
        }
      }

      const dirMd =
        dirParsed &&
        typeof dirParsed === 'object' &&
        typeof /** @type {{ markdown_body?: string }} */ (dirParsed).markdown_body === 'string'
          ? /** @type {{ markdown_body: string }} */ (dirParsed).markdown_body
          : '';
      const section = extractDirectorMarkdownSectionForBlock(dirMd, blockId);

      // ── Prompter 切片（v5 匹配器）──
      const proLoad = loadKnowledgeSlicesV5({
        consumer: 'prompter',
        routing,
        aspectRatio,
        slicesRoot,
      });
      const prompterPayload = buildPrompterPayloadV5({
        editMap,
        blockId,
        kbDir,
        renderingStyle,
        artStyle,
        maxExamples,
        aspectRatio,
        directorMarkdownSection: section,
        knowledgeSlices: proLoad.slices,
      });

      mergedPayloads.push({ block_id: blockId, payload: prompterPayload });

      const prompterSys = appendKnowledgeSlicesToSystemPrompt(prompterSysBase, proLoad.slices);
      const prUserObj = omitKnowledgeSlicesFromPayload(
        /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(prompterPayload))),
      );
      const prUser = [
        '以下为单 Block 的 SD2Prompter v5 输入 JSON（directorMarkdownSection、blockIndex、assetTagMapping、v5Meta.video 等；knowledgeSlices 已注入 system）。',
        '请严格按系统提示输出唯一一个 JSON 对象，不要 Markdown 围栏。',
        '',
        JSON.stringify(prUserObj, null, 2),
      ].join('\n');

      console.log(`[call_sd2_block_chain_v5] ${blockId}：Prompter …（slices=${proLoad.applied.length}, trunc=${proLoad.truncated.length}, tokens=${proLoad.total_tokens}/${proLoad.budget}）`);
      const prRaw = await callLLM({
        systemPrompt: prompterSys,
        userMessage: prUser,
        temperature: 0.35,
        jsonObject: true,
      });
      const prParsed = parseJsonFromModelText(prRaw);

      /** ── @图N 标签后校验（与 v4 相同） ── */
      if (prParsed && typeof prParsed === 'object') {
        const sd2Prompt =
          typeof /** @type {{ sd2_prompt?: string }} */ (prParsed).sd2_prompt === 'string'
            ? /** @type {{ sd2_prompt: string }} */ (prParsed).sd2_prompt
            : '';

        if (sd2Prompt) {
          const bareNamePattern = /(?<!@图\d+)([\u4e00-\u9fff]{2,4})（\1）/g;
          const bareMatches = sd2Prompt.match(bareNamePattern);
          if (bareMatches && bareMatches.length > 0) {
            console.warn(
              `[call_sd2_block_chain_v5] ${blockId} ⚠ Prompter 输出中检测到裸角色名（@图N 丢失）：${bareMatches.slice(0, 3).join('、')}`,
            );
          }

          const largeTagPattern = /@图(\d+)/g;
          let tagMatch = largeTagPattern.exec(sd2Prompt);
          const presentCount =
            biRow && typeof biRow === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (biRow).present_asset_ids)
              ? /** @type {{ present_asset_ids: unknown[] }} */ (biRow).present_asset_ids.length
              : 8;
          while (tagMatch) {
            const num = parseInt(tagMatch[1], 10);
            if (num > presentCount + 2) {
              console.warn(
                `[call_sd2_block_chain_v5] ${blockId} ⚠ 检测到可疑全局编号 @图${num}（本 Block present_asset_ids 仅 ${presentCount} 个）`,
              );
              break;
            }
            tagMatch = largeTagPattern.exec(sd2Prompt);
          }

          const allTags = [...sd2Prompt.matchAll(/@图(\d+)/g)].map((m) => parseInt(m[1], 10));
          if (allTags.length > 0) {
            const unique = [...new Set(allTags)].sort((a, b) => a - b);
            if (unique[0] !== 1) {
              console.warn(
                `[call_sd2_block_chain_v5] ${blockId} ⚠ @图N 未从 1 开始：最小编号=${unique[0]}`,
              );
            }
            for (let ti = 1; ti < unique.length; ti++) {
              if (unique[ti] !== unique[ti - 1] + 1) {
                console.warn(
                  `[call_sd2_block_chain_v5] ${blockId} ⚠ @图N 编号不连续：${unique.join(',')}`,
                );
                break;
              }
            }
          } else {
            console.warn(`[call_sd2_block_chain_v5] ${blockId} ⚠ sd2_prompt 中未检测到任何 @图N 标签`);
          }

          // ── v5.0 HOTFIX：T11 硬门 H5 副校验 ──
          //   这里把 LLM 自报（iron_rule_checklist.avsplit_format_complete）替换成代码级正则校验。
          //   a) AV-split 四段齐全 & 顺序：[FRAME] → [DIALOG] → [SFX] → [BGM]。
          //   b) BGM 不具名：受控方向词（tension/release/suspense/bond/none）之外的具名乐器/人名/歌名告警。
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
          const bgmHits = detectBgmNameLeak(sd2Prompt);
          if (bgmHits.length > 0) {
            routingWarnings.push({
              code: 'bgm_name_leak',
              severity: 'warn',
              block_id: blockId,
              actual: { hits: bgmHits.slice(0, 5) },
              expected: { controlled_vocab: ['tension', 'release', 'suspense', 'bond', 'none'] },
              message: `block ${blockId} [BGM] 段出现具名元素：${bgmHits.slice(0, 3).join('、')}`,
            });
          }
        }

        // ── v5.0 HOTFIX：iron_rule_checklist 位置校准（07_v5-schema-冻结.md §7.8）──
        //   契约：Prompter **顶层** 返回 `iron_rule_checklist`，结构为 dict<string,bool>（如
        //   { no_metaphor:true, all_characters_in_wide_shot:true, ... }）。
        //   a) 对象缺失 / 空 dict → iron_rule_checklist_missing
        //   b) 任一 value===false → iron_rule_checklist_failed_item（actual 带失败项名）
        const ironRaw = /** @type {Record<string, unknown>} */ (prParsed).iron_rule_checklist;
        const isPlainObject =
          ironRaw && typeof ironRaw === 'object' && !Array.isArray(ironRaw);
        const ironDict = isPlainObject
          ? /** @type {Record<string, unknown>} */ (ironRaw)
          : null;
        if (!ironDict || Object.keys(ironDict).length === 0) {
          routingWarnings.push({
            code: 'iron_rule_checklist_missing',
            severity: 'warn',
            block_id: blockId,
            actual: null,
            expected: { field: 'iron_rule_checklist (Prompter 顶层 dict)' },
            message: `block ${blockId} Prompter.iron_rule_checklist 缺失或为空对象`,
          });
        } else {
          /** @type {string[]} */
          const failedKeys = [];
          for (const [k, v] of Object.entries(ironDict)) {
            /** value 兼容 bool 与字符串 "true"/"false" */
            const passed =
              v === true || (typeof v === 'string' && v.toLowerCase() === 'true');
            if (!passed) {
              failedKeys.push(k);
            }
          }
          if (failedKeys.length > 0) {
            routingWarnings.push({
              code: 'iron_rule_checklist_failed_item',
              severity: 'warn',
              block_id: blockId,
              actual: { failed_items: failedKeys },
              expected: { all_pass: true },
              message: `block ${blockId} iron_rule_checklist 未通过项：${failedKeys.slice(0, 5).join(', ')}${failedKeys.length > 5 ? ` … 共 ${failedKeys.length} 项` : ''}`,
            });
          }
        }
      }

      fs.writeFileSync(
        path.join(promptsDir, `${blockId}.json`),
        JSON.stringify(prParsed, null, 2) + '\n',
        'utf8',
      );

      rows[index] = {
        block_id: blockId,
        director_result: dirParsed,
        prompter_result: prParsed,
      };

      // v5：收集路由审计条目
      routingTrace.push({
        block_id: blockId,
        routing: {
          structural: routing.structural,
          satisfaction: routing.satisfaction,
          psychology_group: routing.psychology_group,
          shot_hint: routing.shot_hint,
          paywall_level: routing.paywall_level,
        },
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

  // ── v5.0 HOTFIX：片级镜头预算汇总软门（shot_count_budget_check） ──
  //   把每 block Director 自报的 shot_count 求和，与 meta.target_shot_count.tolerance 对比。
  //   注意：因为是软门，这里只写 warn，不影响后续合并/写盘。
  {
    const metaTop =
      editMap.meta && typeof editMap.meta === 'object'
        ? /** @type {Record<string, unknown>} */ (editMap.meta)
        : null;
    const appendixTop =
      editMap.appendix && typeof editMap.appendix === 'object'
        ? /** @type {Record<string, unknown>} */ (editMap.appendix)
        : null;
    const appendixMetaTop =
      appendixTop && appendixTop.meta && typeof appendixTop.meta === 'object'
        ? /** @type {Record<string, unknown>} */ (appendixTop.meta)
        : null;
    const tscRaw =
      (appendixMetaTop && appendixMetaTop.target_shot_count) ||
      (metaTop && metaTop.target_shot_count) ||
      null;

    if (tscRaw && typeof tscRaw === 'object') {
      const tsc = /** @type {Record<string, unknown>} */ (tscRaw);
      const target = typeof tsc.target === 'number' ? tsc.target : 0;
      const tol = Array.isArray(tsc.tolerance) ? tsc.tolerance : null;
      /** 汇总：遍历 rowsFlat 的 director_result.appendix.shot_count_per_block[].shot_count */
      let total = 0;
      let missing = 0;
      for (const row of rowsFlat) {
        const dp = row.director_result;
        if (!dp || typeof dp !== 'object') {
          missing += 1;
          continue;
        }
        const sc = extractShotCountFromDirector(dp, row.block_id);
        if (sc === null) {
          missing += 1;
          continue;
        }
        total += sc;
      }
      if (target > 0 && tol && tol.length === 2) {
        const lo = Number(tol[0]);
        const hi = Number(tol[1]);
        if (
          Number.isFinite(lo) &&
          Number.isFinite(hi) &&
          missing === 0 &&
          (total < lo || total > hi)
        ) {
          routingWarnings.push({
            code: 'shot_count_budget_check',
            severity: 'warn',
            block_id: null,
            actual: total,
            expected: { target, tolerance: [lo, hi] },
            message: `片级镜头总数 ${total} 超出预算 [${lo}, ${hi}]（target=${target}）`,
          });
        }
      }
    }
  }

  // ── v5.0 HOTFIX：把累计 routingWarnings 写回 editMap（canonical 位置）──
  //   appendix.meta.routing_warnings[] 是契约位置（07_ §七·附）；meta.routing_warnings[] 同步一份兼容消费者。
  {
    const appendix =
      editMap.appendix && typeof editMap.appendix === 'object'
        ? /** @type {Record<string, unknown>} */ (editMap.appendix)
        : null;
    if (appendix && appendix.meta && typeof appendix.meta === 'object') {
      const am = /** @type {Record<string, unknown>} */ (appendix.meta);
      if (!Array.isArray(am.routing_warnings)) {
        am.routing_warnings = [];
      }
      /** @type {RoutingWarning[]} */
      const existed = /** @type {RoutingWarning[]} */ (am.routing_warnings);
      for (const w of routingWarnings) {
        existed.push(w);
      }
    }
    if (editMap.meta && typeof editMap.meta === 'object') {
      const tm = /** @type {Record<string, unknown>} */ (editMap.meta);
      if (!Array.isArray(tm.routing_warnings)) {
        tm.routing_warnings = [];
      }
      /** @type {RoutingWarning[]} */
      const existed = /** @type {RoutingWarning[]} */ (tm.routing_warnings);
      for (const w of routingWarnings) {
        existed.push(w);
      }
    }
  }

  /** @type {Array<{ block_id: string, result: unknown }>} */
  const directorBlocks = [];
  /** @type {Array<{ block_id: string, result: unknown }>} */
  const prompterBlocks = [];

  for (const row of rowsFlat) {
    directorBlocks.push({ block_id: row.block_id, result: row.director_result });
    prompterBlocks.push({ block_id: row.block_id, result: row.prompter_result });
  }
  directorBlocks.sort((a, b) => a.block_id.localeCompare(b.block_id, undefined, { numeric: true }));
  prompterBlocks.sort((a, b) => a.block_id.localeCompare(b.block_id, undefined, { numeric: true }));
  mergedPayloads.sort((a, b) => a.block_id.localeCompare(b.block_id, undefined, { numeric: true }));
  routingTrace.sort((a, b) =>
    String(a.block_id).localeCompare(String(b.block_id), undefined, { numeric: true }),
  );

  const directorAllPath = path.join(outRoot, 'sd2_director_all.json');
  fs.writeFileSync(
    directorAllPath,
    JSON.stringify(
      {
        meta: {
          source_edit_map: editMapPath,
          mode: 'block_chain_v5',
          sd2_version: 'v5',
          generated_at: new Date().toISOString(),
          block_count: directorBlocks.length,
          stagger_ms: staggerMs,
          slices_root: path.resolve(slicesRoot),
        },
        blocks: directorBlocks,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const payloadsOutPath = path.join(outRoot, 'sd2_payloads.json');
  fs.writeFileSync(
    payloadsOutPath,
    JSON.stringify(
      {
        meta: {
          source_edit_map: editMapPath,
          kind: 'sd2_prompter_payloads_v5',
          sd2_version: 'v5',
          generated_at: new Date().toISOString(),
          block_count: mergedPayloads.length,
          kb_dir: path.resolve(kbDir),
        },
        payloads: mergedPayloads,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const promptsAllPath = path.join(outRoot, 'sd2_prompts_all.json');
  fs.writeFileSync(
    promptsAllPath,
    JSON.stringify(
      {
        meta: {
          source_edit_map: editMapPath,
          sd2_version: 'v5',
          generated_at: new Date().toISOString(),
          block_count: prompterBlocks.length,
          stagger_ms: staggerMs,
          mode: 'block_chain_v5',
        },
        blocks: prompterBlocks,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // v5 新产物：编排层路由审计
  //   v5.0 HOTFIX：把软门告警 routing_warnings[] 写到顶层，便于 CI / 回归基线统一消费
  //   （06_v5-验收清单与回归基线.md §6.1）。
  const warnCount = routingWarnings.filter((w) => w.severity === 'warn').length;
  const infoCount = routingWarnings.filter((w) => w.severity === 'info').length;
  const routingTracePath = path.join(outRoot, 'sd2_routing_trace.json');
  fs.writeFileSync(
    routingTracePath,
    JSON.stringify(
      {
        meta: {
          sd2_version: 'v5',
          generated_at: new Date().toISOString(),
          block_count: routingTrace.length,
          slices_root: path.resolve(slicesRoot),
          warning_count: warnCount,
          info_count: infoCount,
        },
        trace: routingTrace,
        routing_warnings: routingWarnings,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // 回写 editMap 本身（带上合并后的 routing_warnings），便于下游重放 & 审计
  fs.writeFileSync(editMapPath, JSON.stringify(editMap, null, 2) + '\n', 'utf8');

  console.log(`[call_sd2_block_chain_v5] Director 汇总: ${directorAllPath}`);
  console.log(`[call_sd2_block_chain_v5] 合并后 payload: ${payloadsOutPath}`);
  console.log(`[call_sd2_block_chain_v5] Prompter 汇总: ${promptsAllPath}`);
  console.log(
    `[call_sd2_block_chain_v5] 路由审计: ${routingTracePath}（warnings=${warnCount}, info=${infoCount}）`,
  );
  if (warnCount + infoCount > 0) {
    // 控制台摘要前 10 条，便于开发期肉眼过一遍
    for (const w of routingWarnings.slice(0, 10)) {
      console.log(
        `[call_sd2_block_chain_v5] [${w.severity}] ${w.code} @ ${w.block_id ?? '(film-level)'}: ${w.message}`,
      );
    }
    if (routingWarnings.length > 10) {
      console.log(`[call_sd2_block_chain_v5] … 另有 ${routingWarnings.length - 10} 条警告详见 JSON`);
    }
  }
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error('[call_sd2_block_chain_v5]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
