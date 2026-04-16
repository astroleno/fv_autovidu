#!/usr/bin/env node
/**
 * 读取 EditMap 输入 JSON + 系统提示词（默认 1_EditMap-SD2-v2.md），调用 LLM 生成 edit_map_sd2.json。
 *
 * 用法:
 *   node scripts/sd2_pipeline/call_editmap_sd2.mjs \
 *     --input output/sd2/{id}/edit_map_input.json \
 *     --output output/sd2/{id}/edit_map_sd2.json
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
import { normalizeEditMapSd2Shape } from './lib/normalize_edit_map_sd2.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_PROMPT = path.join(
  REPO_ROOT,
  'prompt',
  '1_SD2Workflow',
  '1_EditMap-SD2',
  '1_EditMap-SD2-v2.md',
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
  const inputPath =
    typeof args.input === 'string' ? path.resolve(process.cwd(), args.input) : '';
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

  console.log(
    `[call_editmap_sd2] 调用 LLM：model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()}`,
  );
  console.log('[call_editmap_sd2] 生成 EditMap-SD2 …');
  const raw = await callLLM({
    systemPrompt,
    userMessage,
    temperature: 0.25,
    jsonObject: true,
  });

  let parsed;
  try {
    parsed = parseJsonFromModelText(raw);
  } catch (e) {
    console.error('[call_editmap_sd2] JSON 解析失败，原始前 500 字：');
    console.error(raw.slice(0, 500));
    throw e;
  }

  normalizeEditMapSd2Shape(parsed);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`[call_editmap_sd2] 已写入 ${outPath}`);
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error('[call_editmap_sd2]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
