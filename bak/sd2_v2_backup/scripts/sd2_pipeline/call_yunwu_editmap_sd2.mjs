#!/usr/bin/env node
/**
 * 使用云雾（Yunwu）OpenAI 兼容接口调用 `1_EditMap-SD2-v2.md`，生成 `edit_map_sd2.json`。
 *
 * 对应 SD2 流水线第一步：将分集剧本与资产约束拆解为 Block 级「剪辑地图」JSON
 *（叙事节拍、时间槽、对白预算、资产标签映射、焦点主体、场景原型检索键等），
 * 供下游 SD2Director / SD2Prompter 使用。
 *
 * v2 新增：scene_archetype / focus_subject / block_skeleton / episodeShotCount / motionBias。
 *
 * 默认模型：`claude-opus-4-6-thinking`（可通过环境变量 `YUNWU_MODEL` 覆盖）。
 *
 * 用法:
 *   node scripts/sd2_pipeline/call_yunwu_editmap_sd2.mjs \
 *     --input output/sd2/{id}/edit_map_input.json \
 *     --output output/sd2/{id}/edit_map_sd2.json
 *
 * 环境变量（节选）:
 *   YUNWU_API_KEY       必填
 *   YUNWU_BASE_URL      默认 https://yunwu.ai/v1
 *   YUNWU_MODEL         默认 claude-opus-4-6-thinking
 *   YUNWU_MAX_OUTPUT_TOKENS  默认 16384
 *   YUNWU_TIMEOUT_MS    默认 900000（15 分钟）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { parseJsonFromModelText } from './lib/llm_client.mjs';
import {
  callYunwuChatCompletions,
  getYunwuResolvedDefaults,
} from './lib/yunwu_chat.mjs';
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
 * 解析 `--key value` / `--flag` 风格参数。
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

  const defaults = getYunwuResolvedDefaults();
  const modelOverride =
    typeof args.model === 'string' ? args.model : undefined;

  const noThinking = args['no-thinking'] === true;
  console.log(
    `[call_yunwu_editmap_sd2] 云雾 LLM：model=${modelOverride || defaults.model} base=${defaults.baseUrl} thinking=${!noThinking}`,
  );
  console.log('[call_yunwu_editmap_sd2] 生成 EditMap-SD2 …');

  const editMapMaxTokens = Math.max(
    8192,
    parseInt(process.env.YUNWU_EDITMAP_MAX_TOKENS || '65536', 10),
  );

  const raw = await callYunwuChatCompletions({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    model: modelOverride,
    temperature: 0.25,
    jsonObject: true,
    enableThinking: !noThinking,
    maxTokens: editMapMaxTokens,
  });

  let parsed;
  try {
    parsed = parseJsonFromModelText(raw);
  } catch (e) {
    console.error('[call_yunwu_editmap_sd2] JSON 解析失败，原始前 800 字：');
    console.error(raw.slice(0, 800));
    throw e;
  }

  normalizeEditMapSd2Shape(parsed);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`[call_yunwu_editmap_sd2] 已写入 ${outPath}`);
}

const entry = process.argv[1];
if (entry && pathToFileURL(path.resolve(entry)).href === import.meta.url) {
  main().catch((err) => {
    console.error(
      '[call_yunwu_editmap_sd2]',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
