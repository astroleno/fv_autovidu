#!/usr/bin/env node
/**
 * 读取 sd2_director_payloads.json，按 Block 调用 LLM（2_SD2Director-v1.md），生成镜头导演稿 JSON。
 *
 * 位于 EditMap-SD2 与 SD2Prompter 之间：使用廉价模型（默认 SD2_LLM_* / DashScope qwen）即可。
 *
 * 用法:
 *   node scripts/sd2_pipeline/call_sd2_director.mjs \
 *     --payloads output/sd2/{id}/sd2_director_payloads.json \
 *     --out-dir output/sd2/{id}/director_prompts \
 *     [--stagger-ms 400] [--concurrency 4]
 *
 * 汇总文件写入 out-dir 的上一级：sd2_director_all.json（供 build_sd2_prompter_payload --director-json 合并）。
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_PROMPT = path.join(
  REPO_ROOT,
  'prompt',
  '1_SD2Workflow',
  '2_SD2Director',
  '2_SD2Director-v1.md',
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
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<void>} fn
 */
async function runPool(items, concurrency, fn) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payloadsPath =
    typeof args.payloads === 'string' ? path.resolve(process.cwd(), args.payloads) : '';
  if (!payloadsPath || !fs.existsSync(payloadsPath)) {
    console.error('请指定 --payloads sd2_director_payloads.json');
    process.exit(2);
  }

  const raw = JSON.parse(fs.readFileSync(payloadsPath, 'utf8'));
  const payloads = Array.isArray(raw.payloads) ? raw.payloads : [];
  if (!payloads.length) {
    throw new Error('sd2_director_payloads.json 缺少 payloads[]');
  }

  const blockFilter =
    typeof args.block === 'string' ? String(args.block).trim() : '';

  const list = blockFilter
    ? payloads.filter((p) => p && p.block_id === blockFilter)
    : payloads;

  if (!list.length) {
    throw new Error(blockFilter ? `未找到 block: ${blockFilter}` : '无 payload');
  }

  const outDir =
    typeof args['out-dir'] === 'string'
      ? path.resolve(process.cwd(), args['out-dir'])
      : path.join(path.dirname(payloadsPath), 'director_prompts');

  const promptPath =
    typeof args['prompt-file'] === 'string'
      ? path.resolve(process.cwd(), args['prompt-file'])
      : DEFAULT_PROMPT;

  const systemPrompt = fs.readFileSync(promptPath, 'utf8');

  const staggerMs = Math.max(
    0,
    parseInt(String(args['stagger-ms'] !== undefined ? args['stagger-ms'] : '400'), 10) || 0,
  );

  const concRaw =
    args.concurrency !== undefined && args.concurrency !== ''
      ? parseInt(String(args.concurrency), 10)
      : 0;
  const concurrency =
    !Number.isFinite(concRaw) || concRaw <= 0
      ? list.length
      : Math.min(Math.max(1, concRaw), list.length);

  const useFullParallel = concurrency >= list.length;

  console.log(
    `[call_sd2_director] LLM：model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()} ` +
      `parallel=${useFullParallel ? 'full' : `pool(${concurrency})`} staggerMs=${staggerMs}`,
  );

  fs.mkdirSync(outDir, { recursive: true });

  /**
   * @param {{ block_id?: string, payload?: unknown }} entry
   * @param {number} index
   */
  async function processOne(entry, index) {
    const blockId = entry.block_id;
    const payload = entry.payload;
    if (!blockId || !payload) {
      return null;
    }
    if (useFullParallel && staggerMs > 0) {
      await new Promise((r) => setTimeout(r, index * staggerMs));
    }
    const userMessage = [
      '以下为单 Block 的 SD2Director 输入 JSON（edit_map_block、asset_tag_mapping、prev_block_context、few_shot_context、rendering_style、aspect_ratio）。',
      '请严格按系统提示输出唯一一个 JSON 对象，不要 Markdown 围栏。',
      '',
      JSON.stringify(payload, null, 2),
    ].join('\n');

    console.log(`[call_sd2_director] Block ${blockId} …`);
    const text = await callLLM({
      systemPrompt,
      userMessage,
      temperature: 0.25,
      jsonObject: true,
    });
    const parsed = parseJsonFromModelText(text);
    const onePath = path.join(outDir, `${blockId}.json`);
    fs.writeFileSync(onePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    return { block_id: blockId, result: parsed };
  }

  /** @type {Array<{ block_id: string, result: unknown }>} */
  let combined = [];

  if (useFullParallel) {
    const rows = await Promise.all(
      list.map((entry, index) => processOne(entry, index)),
    );
    combined = /** @type {typeof combined} */ (rows.filter((x) => x !== null));
  } else {
    await runPool(list, concurrency, async (entry, index) => {
      const row = await processOne(entry, index);
      if (row) {
        combined.push(row);
      }
    });
  }

  combined.sort((a, b) => a.block_id.localeCompare(b.block_id));

  const allPath = path.join(path.dirname(outDir), 'sd2_director_all.json');
  fs.writeFileSync(
    allPath,
    JSON.stringify(
      {
        meta: {
          source_payloads: payloadsPath,
          generated_at: new Date().toISOString(),
          block_count: combined.length,
          stagger_ms: staggerMs,
          concurrency_effective: concurrency,
          parallel_mode: useFullParallel ? 'full_stagger' : 'pool',
        },
        blocks: combined,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(`[call_sd2_director] 单块目录: ${outDir}`);
  console.log(`[call_sd2_director] 汇总: ${allPath}`);
}

const _e2 = process.argv[1];
if (_e2 && pathToFileURL(path.resolve(_e2)).href === import.meta.url) {
  main().catch((err) => {
    console.error('[call_sd2_director]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
