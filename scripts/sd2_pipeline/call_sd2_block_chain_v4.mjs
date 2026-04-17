#!/usr/bin/env node
/**
 * SD2 v4：每 Block 内 Director → Prompter；Block 间调度规则（对齐 SD2Workflow-v3.1 合同）：
 * - 相邻 Block **scene_run_id 相同** → 必须串行（需前一块 Director 的 continuity_out → prevBlockContext）
 * - **scene_run_id 不同** → 可并行（prevBlockContext 为 null，不依赖前一块附录）
 * - `scene_run_id` 缺失时 → 保守按「同场」处理，与上一块串行
 *
 * 可选 `--serial`：强制全局串行（调试用）。
 *
 * 知识切片：4_KnowledgeSlices/injection_map.yaml，注入到 **system prompt 末尾**（user JSON 中省略 knowledgeSlices 以免重复）。
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
  loadKnowledgeSlicesForConsumer,
  omitKnowledgeSlicesFromPayload,
} from './lib/knowledge_slices.mjs';
import {
  assertV4PromptFileExists,
  getDirectorSd2V4PromptPath,
  getKnowledgeSlicesRootPath,
  getPrompterSd2V4PromptPath,
} from './lib/sd2_prompt_paths_v4.mjs';
import {
  buildDirectorPayloadV4,
  buildPrompterPayloadV4,
  computePrevBlockContextForDirector,
  extractDirectorMarkdownSectionForBlock,
} from './lib/sd2_v4_payloads.mjs';

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
 * @param {unknown} editMap
 * @param {string} blockId
 */
function getBlockIndexRow(editMap, blockId) {
  const appendix = /** @type {{ block_index?: unknown[] }} */ (editMap.appendix);
  const rows = Array.isArray(appendix?.block_index) ? appendix.block_index : [];
  return rows.find((x) => x && typeof x === 'object' && x.id === blockId) || null;
}

/**
 * 相邻块是否必须串行：仅当二者 scene_run_id 相同且均非空时，后一块依赖前一块的 Director appendix。
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
  const blockFilter =
    typeof args.block === 'string' ? String(args.block).trim() : '';
  if (blockFilter) {
    list = list.filter((p) => p && p.block_id === blockFilter);
  }
  if (!list.length) {
    throw new Error(blockFilter ? `未找到 block: ${blockFilter}` : '无 director payload');
  }

  list.sort((a, b) =>
    String(a.block_id || '').localeCompare(String(b.block_id || ''), undefined, {
      numeric: true,
    }),
  );

  const editMap = JSON.parse(fs.readFileSync(editMapPath, 'utf8'));

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
  console.log(`[call_sd2_block_chain_v4] 画面风格: renderingStyle=${renderingStyle}`);

  const aspectRatio =
    typeof args['aspect-ratio'] === 'string' ? args['aspect-ratio'] : '16:9';
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
      : getPrompterSd2V4PromptPath();
  assertV4PromptFileExists(prompterPromptPath);

  const directorPromptPath =
    typeof args['director-prompt'] === 'string' && args['director-prompt'].trim()
      ? path.resolve(process.cwd(), args['director-prompt'].trim())
      : getDirectorSd2V4PromptPath();
  assertV4PromptFileExists(directorPromptPath);

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
    `[call_sd2_block_chain_v4] Director+Prompter v4；model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()} blocks=${list.length}；调度=${forceSerial ? '强制串行' : `按 scene_run_id（可并行边≈${parallelEdges}）`} slicesRoot=${slicesRoot}`,
  );
  console.log(`[call_sd2_block_chain_v4] Director 提示词: ${directorPromptPath}`);
  console.log(`[call_sd2_block_chain_v4] Prompter 提示词: ${prompterPromptPath}`);

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

    /** 仅当须衔接上一块 continuity 时才 await 上一块 Director（同 scene_run_id 或 --serial；缺 id 保守串行） */
    const mustWaitForPrevDirector =
      index > 0 &&
      (forceSerial || (prevRow && biRow ? adjacentBlocksRequireSerial(prevRow, biRow) : true));

    if (mustWaitForPrevDirector) {
      await done[index - 1];
    }

    if (staggerMs > 0) {
      await new Promise((r) => setTimeout(r, index * staggerMs));
    }

    const prevAppendixForCtx = mustWaitForPrevDirector
      ? appendixByIndex[index - 1]
      : null;
    const prevCtx = computePrevBlockContextForDirector(
      prevAppendixForCtx,
      prevRow,
      biRow,
    );

    const dirSlices = loadKnowledgeSlicesForConsumer(
      'director',
      biRow,
      parsedBrief,
      slicesRoot,
    );
    const dpPayload = buildDirectorPayloadV4({
      editMap,
      blockId,
      kbDir,
      renderingStyle,
      aspectRatio,
      maxExamples,
      knowledgeSlices: dirSlices,
      prevBlockContext: prevCtx,
    });

    const directorSys = appendKnowledgeSlicesToSystemPrompt(directorSysBase, dirSlices);
    const dirUserObj = omitKnowledgeSlicesFromPayload(
      /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(dpPayload))),
    );
    const dirUser = [
      '以下为单 Block 的 SD2Director v4 输入 JSON（editMapParagraph、blockIndex、assetTagMapping、prevBlockContext 等；knowledgeSlices 已注入 system）。',
      '请严格按系统提示输出唯一一个 JSON 对象（含 markdown_body 与 appendix），不要 Markdown 围栏。',
      '',
      JSON.stringify(dirUserObj, null, 2),
    ].join('\n');

    console.log(`[call_sd2_block_chain_v4] ${blockId}：Director …`);
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

    const dirMd =
      dirParsed &&
      typeof dirParsed === 'object' &&
      typeof /** @type {{ markdown_body?: string }} */ (dirParsed).markdown_body === 'string'
        ? /** @type {{ markdown_body: string }} */ (dirParsed).markdown_body
        : '';
    const section = extractDirectorMarkdownSectionForBlock(dirMd, blockId);

    const proSlices = loadKnowledgeSlicesForConsumer(
      'prompter',
      biRow,
      parsedBrief,
      slicesRoot,
    );
    const prompterPayload = buildPrompterPayloadV4({
      editMap,
      blockId,
      kbDir,
      renderingStyle,
      artStyle,
      maxExamples,
      aspectRatio,
      directorMarkdownSection: section,
      knowledgeSlices: proSlices,
    });

    mergedPayloads.push({ block_id: blockId, payload: prompterPayload });

    const prompterSys = appendKnowledgeSlicesToSystemPrompt(prompterSysBase, proSlices);
    const prUserObj = omitKnowledgeSlicesFromPayload(
      /** @type {Record<string, unknown>} */ (JSON.parse(JSON.stringify(prompterPayload))),
    );
    const prUser = [
      '以下为单 Block 的 SD2Prompter v4 输入 JSON（directorMarkdownSection、blockIndex、assetTagMapping 等；knowledgeSlices 已注入 system）。',
      '请严格按系统提示输出唯一一个 JSON 对象，不要 Markdown 围栏。',
      '',
      JSON.stringify(prUserObj, null, 2),
    ].join('\n');

    console.log(`[call_sd2_block_chain_v4] ${blockId}：Prompter …`);
    const prRaw = await callLLM({
      systemPrompt: prompterSys,
      userMessage: prUser,
      temperature: 0.35,
      jsonObject: true,
    });
    const prParsed = parseJsonFromModelText(prRaw);

    /** ── @图N 标签后校验 ── */
    if (prParsed && typeof prParsed === 'object') {
      const sd2Prompt = typeof /** @type {{ sd2_prompt?: string }} */ (prParsed).sd2_prompt === 'string'
        ? /** @type {{ sd2_prompt: string }} */ (prParsed).sd2_prompt
        : '';

      if (sd2Prompt) {
        /**
         * 检测裸角色名模式：`角色名（角色名）` -- 仅匹配括号内外文字完全相同的 2-4 字中文名。
         * 如 `秦若岚（秦若岚）`。排除环境描述如 `家庭合影（一角被遮挡）`。
         */
        const bareNamePattern = /(?<!@图\d+)([\u4e00-\u9fff]{2,4})（\1）/g;
        const bareMatches = sd2Prompt.match(bareNamePattern);
        if (bareMatches && bareMatches.length > 0) {
          console.warn(
            `[call_sd2_block_chain_v4] ${blockId} ⚠ Prompter 输出中检测到裸角色名（@图N 丢失）：${bareMatches.slice(0, 3).join('、')}`,
          );
        }

        /** 检测全局大编号残留（present_asset_ids 通常不超过 6-8 个，@图10+ 高度可疑） */
        const largeTagPattern = /@图(\d+)/g;
        let tagMatch = largeTagPattern.exec(sd2Prompt);
        const presentCount = biRow && Array.isArray(biRow.present_asset_ids)
          ? biRow.present_asset_ids.length
          : 8;
        while (tagMatch) {
          const num = parseInt(tagMatch[1], 10);
          if (num > presentCount + 2) {
            console.warn(
              `[call_sd2_block_chain_v4] ${blockId} ⚠ 检测到可疑全局编号 @图${num}（本 Block present_asset_ids 仅 ${presentCount} 个）`,
            );
            break;
          }
          tagMatch = largeTagPattern.exec(sd2Prompt);
        }

        /** 检测 @图N 是否从 1 开始连续 */
        const allTags = [...sd2Prompt.matchAll(/@图(\d+)/g)].map((m) => parseInt(m[1], 10));
        if (allTags.length > 0) {
          const unique = [...new Set(allTags)].sort((a, b) => a - b);
          if (unique[0] !== 1) {
            console.warn(`[call_sd2_block_chain_v4] ${blockId} ⚠ @图N 未从 1 开始：最小编号=${unique[0]}`);
          }
          for (let ti = 1; ti < unique.length; ti++) {
            if (unique[ti] !== unique[ti - 1] + 1) {
              console.warn(`[call_sd2_block_chain_v4] ${blockId} ⚠ @图N 编号不连续：${unique.join(',')}`);
              break;
            }
          }
        } else {
          console.warn(`[call_sd2_block_chain_v4] ${blockId} ⚠ sd2_prompt 中未检测到任何 @图N 标签`);
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
    } finally {
      resolveDone[index]();
    }
  }

  await Promise.all(list.map((_, i) => runOne(i)));

  /** @type {Array<{ block_id: string, director_result: unknown, prompter_result: unknown }>} */
  const rowsFlat = rows.filter((x) => x !== null);

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

  const directorAllPath = path.join(outRoot, 'sd2_director_all.json');
  fs.writeFileSync(
    directorAllPath,
    JSON.stringify(
      {
        meta: {
          source_edit_map: editMapPath,
          mode: 'block_chain_v4',
          sd2_version: 'v4',
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
          kind: 'sd2_prompter_payloads_v4',
          sd2_version: 'v4',
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
          sd2_version: 'v4',
          generated_at: new Date().toISOString(),
          block_count: prompterBlocks.length,
          stagger_ms: staggerMs,
          mode: 'block_chain_v4',
        },
        blocks: prompterBlocks,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(`[call_sd2_block_chain_v4] Director 汇总: ${directorAllPath}`);
  console.log(`[call_sd2_block_chain_v4] 合并后 payload: ${payloadsOutPath}`);
  console.log(`[call_sd2_block_chain_v4] Prompter 汇总: ${promptsAllPath}`);
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error('[call_sd2_block_chain_v4]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
