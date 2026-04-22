#!/usr/bin/env node
/**
 * API Mart 版 EditMap-SD2 **v3** 独立脚本，语义对齐 `call_yunwu_editmap_sd2_v3.mjs`。
 * 默认模型 claude-opus-4-7，接口见 `reference/apimart/openai-sse.md`。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { callApimartChatCompletions, getApimartResolvedDefaults } from './lib/apimart_chat.mjs';
import { parseJsonFromModelText } from './lib/llm_client.mjs';
import { normalizeEditMapSd2V3 } from './lib/normalize_edit_map_sd2_v3.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TAG = 'call_apimart_editmap_sd2_v3';

const DEFAULT_PROMPT = path.join(
  REPO_ROOT,
  'prompt',
  '1_SD2Workflow',
  '1_EditMap-SD2',
  '1_EditMap-SD2-v3.md',
);

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */ const out = {};
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
  const inputPath = typeof args.input === 'string' ? path.resolve(process.cwd(), args.input) : '';
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('请指定有效 --input edit_map_input.json');
    process.exit(2);
  }
  const outPath =
    typeof args.output === 'string'
      ? path.resolve(process.cwd(), args.output)
      : path.join(path.dirname(inputPath), 'edit_map_sd2.json');
  const promptPath =
    typeof args['prompt-file'] === 'string'
      ? path.resolve(process.cwd(), args['prompt-file'])
      : DEFAULT_PROMPT;

  const systemPrompt = fs.readFileSync(promptPath, 'utf8');
  const inputObj = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const userMessage = [
    '以下为 globalSynopsis、scriptContent、assetManifest、episodeDuration、referenceAssets 等输入。',
    '请严格按系统提示中的 Schema 输出唯一一个 JSON 对象，不要 Markdown 围栏。',
    '',
    JSON.stringify(inputObj, null, 2),
  ].join('\n');

  const defaults = getApimartResolvedDefaults();
  const modelOverride = typeof args.model === 'string' ? args.model : undefined;
  const noThinking = args['no-thinking'] === true;
  console.log(
    `[${TAG}] API Mart model=${modelOverride || defaults.model} base=${defaults.baseUrl} thinking=${!noThinking}`,
  );
  const editMapMaxTokens = Math.max(32768, parseInt(process.env.APIMART_EDITMAP_MAX_TOKENS || '200000', 10));
  console.log(`[${TAG}] max_tokens=${editMapMaxTokens}`);

  const chatOpts = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    model: modelOverride,
    temperature: 0.25,
    jsonObject: true,
    enableThinking: !noThinking,
    maxTokens: editMapMaxTokens,
  };

  let raw = '';
  try {
    raw = await callApimartChatCompletions(chatOpts);
  } catch (firstErr) {
    const fr = /** @type {Error & { finishReason?: string }} */ (firstErr);
    if (fr.finishReason === 'length') {
      const cap = Math.max(editMapMaxTokens, parseInt(process.env.APIMART_EDITMAP_MAX_RETRY_CAP || '262144', 10));
      const bumped = Math.min(Math.floor(editMapMaxTokens * 1.5), cap);
      if (bumped > editMapMaxTokens) {
        console.warn(`[${TAG}] finish_reason=length，将 max_tokens ${editMapMaxTokens}→${bumped} 重试…`);
        raw = await callApimartChatCompletions({ ...chatOpts, maxTokens: bumped });
      } else {
        throw firstErr;
      }
    } else {
      throw firstErr;
    }
  }

  let parsed;
  try {
    parsed = parseJsonFromModelText(raw);
  } catch (e) {
    console.error(`[${TAG}] JSON 解析失败，原始前 800 字：`);
    console.error(raw.slice(0, 800));
    throw e;
  }
  normalizeEditMapSd2V3(parsed);
  const blocks = /** @type {{ blocks?: unknown }} */ (parsed).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error(
      'EditMap v3 归一化后 blocks[] 为空。可尝试调大 APIMART_EDITMAP_MAX_TOKENS 或使用 DashScope：call_editmap_sd2_v3.mjs',
    );
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`[${TAG}] 已写入 ${outPath}`);
}

const entry = process.argv[1];
if (entry && pathToFileURL(path.resolve(entry)).href === import.meta.url) {
  main().catch((err) => {
    console.error(`[${TAG}]`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
