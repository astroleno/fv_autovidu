#!/usr/bin/env node
/**
 * 单集内：每个 Block **先** SD2Director **再** SD2Prompter（串联）；
 * 多个 Block 之间 **Promise.all 全并发**，仅按序号做 **stagger-ms** 错峰启动（与原先两阶段「全 Director 再全 Prompter」不同）。
 *
 * 依赖：同目录下胶水 `build_sd2_prompter_payload.js`（CommonJS）与 `llm_client.mjs`。
 *
 * 用法:
 *   node scripts/sd2_pipeline/call_sd2_block_chain.mjs \
 *     --edit-map output/sd2/{id}/edit_map_sd2.json \
 *     --director-payloads output/sd2/{id}/sd2_director_payloads.json \
 *     --out-root output/sd2/{id} \
 *     [--stagger-ms 400] [--block B03] [--prompter-prompt path/to/2_SD2Prompter-v2.md]
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

import {
  callLLM,
  getResolvedLlmBaseUrl,
  getResolvedLlmModel,
  parseJsonFromModelText,
} from './lib/llm_client.mjs';
import {
  assertPromptFileExists,
  getResolvedPrompterPromptPath,
} from './lib/sd2_prompt_paths.mjs';
import { resolveSd2StyleHints } from './lib/edit_map_style_hints.mjs';

const require = createRequire(import.meta.url);
const { buildPrompterPayload } = require('../build_sd2_prompter_payload.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DIRECTOR_PROMPT = path.join(
  REPO_ROOT,
  'prompt',
  '1_SD2Workflow',
  '2_SD2Director',
  '2_SD2Director-v1.md',
);
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
  console.log(`[call_sd2_block_chain] 画面风格: renderingStyle=${renderingStyle}`);
  const aspectRatio =
    typeof args['aspect-ratio'] === 'string' ? args['aspect-ratio'] : '16:9';
  const kbDir =
    typeof args['kb-dir'] === 'string'
      ? path.resolve(process.cwd(), args['kb-dir'])
      : DEFAULT_KB;
  const maxExamples = Math.max(
    1,
    parseInt(String(args['max-examples'] !== undefined ? args['max-examples'] : '2'), 10) || 2,
  );

  const staggerMs = Math.max(
    0,
    parseInt(String(args['stagger-ms'] !== undefined ? args['stagger-ms'] : '400'), 10) || 0,
  );

  const prompterPromptPath =
    typeof args['prompter-prompt'] === 'string' && args['prompter-prompt'].trim()
      ? path.resolve(process.cwd(), args['prompter-prompt'].trim())
      : getResolvedPrompterPromptPath();
  assertPromptFileExists(prompterPromptPath);

  const directorSys = fs.readFileSync(DIRECTOR_PROMPT, 'utf8');
  const prompterSys = fs.readFileSync(prompterPromptPath, 'utf8');

  const directorDir = path.join(outRoot, 'director_prompts');
  const promptsDir = path.join(outRoot, 'prompts');
  fs.mkdirSync(directorDir, { recursive: true });
  fs.mkdirSync(promptsDir, { recursive: true });

  /** @type {Array<{ block_id: string, payload: unknown }>} */
  const mergedPayloads = [];

  console.log(
    `[call_sd2_block_chain] Director+Prompter 串联/Block；model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()} staggerMs=${staggerMs} blocks=${list.length}`,
  );
  console.log(`[call_sd2_block_chain] SD2Prompter 系统提示词: ${prompterPromptPath}`);

  /**
   * 单 Block：Director LLM → 合并 sd2_director → Prompter LLM。
   * @param {{ block_id?: string, payload?: unknown }} entry
   * @param {number} index
   */
  async function processOne(entry, index) {
    const blockId = entry.block_id;
    const dp = entry.payload;
    if (!blockId || !dp) {
      return null;
    }
    if (staggerMs > 0) {
      await new Promise((r) => setTimeout(r, index * staggerMs));
    }

    const dirUser = [
      '以下为单 Block 的 SD2Director 输入 JSON。',
      '请严格按系统提示输出唯一一个 JSON 对象，不要 Markdown 围栏。',
      '',
      JSON.stringify(dp, null, 2),
    ].join('\n');

    console.log(`[call_sd2_block_chain] ${blockId}：Director …`);
    const dirRaw = await callLLM({
      systemPrompt: directorSys,
      userMessage: dirUser,
      temperature: 0.25,
      jsonObject: true,
    });
    const dirParsed = parseJsonFromModelText(dirRaw);
    fs.writeFileSync(
      path.join(directorDir, `${blockId}.json`),
      JSON.stringify(dirParsed, null, 2) + '\n',
      'utf8',
    );

    const prompterPayload = buildPrompterPayload({
      editMap,
      blockId,
      kbDir,
      renderingStyle,
      artStyle,
      maxExamples,
      aspectRatio,
      directorByBlockId: { [blockId]: dirParsed },
    });
    mergedPayloads.push({ block_id: blockId, payload: prompterPayload });

    const prUser = [
      '以下为单 Block 的 SD2Prompter 输入 JSON（含 sd2_director）。',
      '请严格按系统提示输出唯一一个 JSON 对象，不要 Markdown 围栏。',
      '',
      JSON.stringify(prompterPayload, null, 2),
    ].join('\n');

    console.log(`[call_sd2_block_chain] ${blockId}：Prompter …`);
    const prRaw = await callLLM({
      systemPrompt: prompterSys,
      userMessage: prUser,
      temperature: 0.35,
      jsonObject: true,
    });
    const prParsed = parseJsonFromModelText(prRaw);
    fs.writeFileSync(
      path.join(promptsDir, `${blockId}.json`),
      JSON.stringify(prParsed, null, 2) + '\n',
      'utf8',
    );
    return {
      block_id: blockId,
      director_result: dirParsed,
      prompter_result: prParsed,
    };
  }

  const rows = await Promise.all(list.map((e, i) => processOne(e, i)));

  /** @type {Array<{ block_id: string, result: unknown }>} */
  const directorBlocks = [];
  /** @type {Array<{ block_id: string, result: unknown }>} */
  const prompterBlocks = [];

  for (const row of rows) {
    if (!row) {
      continue;
    }
    directorBlocks.push({ block_id: row.block_id, result: row.director_result });
    prompterBlocks.push({ block_id: row.block_id, result: row.prompter_result });
  }
  directorBlocks.sort((a, b) => a.block_id.localeCompare(b.block_id));
  prompterBlocks.sort((a, b) => a.block_id.localeCompare(b.block_id));
  mergedPayloads.sort((a, b) => a.block_id.localeCompare(b.block_id));

  const directorAllPath = path.join(outRoot, 'sd2_director_all.json');
  fs.writeFileSync(
    directorAllPath,
    JSON.stringify(
      {
        meta: {
          source_edit_map: editMapPath,
          mode: 'block_chain',
          generated_at: new Date().toISOString(),
          block_count: directorBlocks.length,
          stagger_ms: staggerMs,
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
          kind: 'sd2_prompter_payloads',
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
          generated_at: new Date().toISOString(),
          block_count: prompterBlocks.length,
          stagger_ms: staggerMs,
          mode: 'block_chain',
        },
        blocks: prompterBlocks,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(`[call_sd2_block_chain] Director 汇总: ${directorAllPath}`);
  console.log(`[call_sd2_block_chain] 合并后 payload: ${payloadsOutPath}`);
  console.log(`[call_sd2_block_chain] Prompter 汇总: ${promptsAllPath}`);
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error('[call_sd2_block_chain]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
