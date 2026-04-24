#!/usr/bin/env node
/**
 * Stage 1.5 · Scene Architect v1 · Runner
 *
 * 职责（PoC）：
 *   - 读 EditMap v6 + normalized_script_package v2；
 *   - 构造 payload（rhythm_timeline 草案 + block_index_compact + KVA + segments_compact）；
 *   - 调 APIMart `claude-opus-4-6-thinking`（用户 D2 决策）；
 *   - 解析 + 校验 + 投影输出（超出 ±3s、条目数不一致、越界 block_id 一律回退）；
 *   - 并列落盘（用户 D3 决策）：
 *       meta.rhythm_timeline_original  ← 保留草案
 *       meta.rhythm_timeline           ← 更新为微调版
 *       meta.rhythm_adjustments[]      ← 追加审计日志
 *       appendix.block_index[].kva_suggestions[] ← KVA 编排建议
 *   - 把完整 LLM 产物落到 `<outDir>/scene_architect_output.json`
 *   - 把回灌后的 editMap 写回 `<outDir>/edit_map_sd2.json`（in-place）
 *
 * CLI：
 *   node scripts/sd2_pipeline/call_scene_architect_v1.mjs \
 *     --edit-map output/sd2/<id>/edit_map_sd2.json \
 *     --normalized-package output/sd2/<id>/normalized_script_package.json \
 *     --episode-json output/sd2/<id>/episode.json \
 *     --output-dir output/sd2/<id>
 *
 * 可选：
 *   --model             覆盖 APIMart model id（默认 claude-opus-4-6-thinking）
 *   --apimart-messages  使用 Anthropic `/messages`（推荐 thinking 模型）
 *   --dry-run           不调 LLM，仅输出 payload 给审计
 *
 * 契约源：
 *   - prompt/1_SD2Workflow/1_5_SceneArchitect/1_5_SceneArchitect-v1.md
 *   - prompt/1_SD2Workflow/docs/v6/05_v6-场级调度与音频意图.md
 *   - prompt/1_SD2Workflow/docs/v6/06_v6-节奏推导与爆点密度.md
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { callApimartChatCompletions } from './lib/apimart_chat.mjs';
import {
  callApimartMessages,
  getApimartMessagesDefaults,
} from './lib/apimart_messages_chat.mjs';
import { parseJsonFromModelText } from './lib/llm_client.mjs';
import {
  getSceneArchitectV1PromptPath,
  assertV6PromptFileExists,
} from './lib/sd2_prompt_paths_v6.mjs';
import {
  buildSceneArchitectPayload,
  validateSceneArchitectOutput,
  applySceneArchitectToEditMap,
} from './lib/sd2_scene_architect_payload.mjs';

const SCRIPT_TAG = 'call_scene_architect_v1';
const DEFAULT_MODEL = 'claude-opus-4-6-thinking';

/**
 * 解析 CLI 参数（与其他 call_* 脚本同风格）。
 *
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
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * 读入 JSON 文件，失败直接抛错（上层兜住）。
 *
 * @param {string} absPath
 * @returns {Record<string, unknown>}
 */
function readJsonFile(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`JSON root 不是对象: ${absPath}`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * 写 JSON（带缩进 + 换行尾，方便 diff）。
 *
 * @param {string} absPath
 * @param {unknown} obj
 */
function writeJsonFile(absPath, obj) {
  const text = `${JSON.stringify(obj, null, 2)}\n`;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf8');
}

/**
 * 构造发给 LLM 的 messages：
 *   - system：读 1_5_SceneArchitect-v1.md 全文
 *   - user：JSON 化后的 payload
 *
 * @param {string} promptPath
 * @param {Record<string, unknown>} payload
 * @returns {Array<{ role: 'system' | 'user'; content: string }>}
 */
function buildMessages(promptPath, payload) {
  const sys = fs.readFileSync(promptPath, 'utf8');
  const user = JSON.stringify(payload, null, 2);
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/**
 * 主入口。
 *
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const args = parseArgs(argv);
  const editMapPath = typeof args['edit-map'] === 'string' ? args['edit-map'] : '';
  const nspPath =
    typeof args['normalized-package'] === 'string' ? args['normalized-package'] : '';
  const episodePath =
    typeof args['episode-json'] === 'string' ? args['episode-json'] : '';
  const outputDir =
    typeof args['output-dir'] === 'string' ? args['output-dir'] : '';

  if (!editMapPath || !outputDir) {
    console.error(
      `[${SCRIPT_TAG}] 缺少参数：--edit-map <path> --output-dir <dir> 是必须的`,
    );
    return 2;
  }
  const dryRun = args['dry-run'] === true;
  const modelOverride = typeof args.model === 'string' ? args.model : '';
  const useApimartMessages = args['apimart-messages'] === true;

  const promptPath = getSceneArchitectV1PromptPath();
  assertV6PromptFileExists(promptPath);

  const editMap = readJsonFile(editMapPath);
  const nsp = nspPath ? readJsonFile(nspPath) : null;
  const episode = episodePath
    ? readJsonFile(episodePath)
    : { duration_sec: 0, episode_id: 'unknown' };
  const episodeCompact = {
    duration_sec:
      typeof episode.duration_sec === 'number' ? episode.duration_sec : 0,
    episode_id:
      typeof episode.episode_id === 'string' ? episode.episode_id : 'unknown',
  };

  const payload = buildSceneArchitectPayload(editMap, nsp, episodeCompact);

  const payloadPath = path.join(outputDir, 'scene_architect_payload.json');
  writeJsonFile(payloadPath, payload);
  console.log(`[${SCRIPT_TAG}] payload 已落盘: ${payloadPath}`);

  if (dryRun) {
    console.log(`[${SCRIPT_TAG}] dry-run 结束，未调用 LLM`);
    return 0;
  }

  const kvaCount = Array.isArray(payload.key_visual_actions)
    ? payload.key_visual_actions.length
    : 0;
  const blockCount = Array.isArray(payload.block_index_compact)
    ? payload.block_index_compact.length
    : 0;
  console.log(
    `[${SCRIPT_TAG}] 调 APIMart（backend=${useApimartMessages ? 'messages' : 'chat'} model=${modelOverride || DEFAULT_MODEL}）blocks=${blockCount} kva=${kvaCount}`,
  );

  const messages = buildMessages(promptPath, payload);
  const sceneArchitectTimeoutMs = Math.max(
    60000,
    parseInt(process.env.APIMART_SCENE_ARCHITECT_TIMEOUT_MS || '300000', 10),
  );
  let text = '';
  /** @type {string | null} */
  let llmError = null;
  try {
    text = useApimartMessages
      ? await (async () => {
          const defaults = getApimartMessagesDefaults();
          console.log(
            `[${SCRIPT_TAG}] APIMart /messages：base=${defaults.baseUrl} anthropic-version=${defaults.anthropicVersion}`,
          );
          return callApimartMessages({
            messages,
            model: modelOverride || DEFAULT_MODEL,
            temperature: 0.2,
            maxTokens: Math.max(
              8192,
              parseInt(
                process.env.APIMART_SCENE_ARCHITECT_MAX_TOKENS ||
                  process.env.APIMART_MAX_OUTPUT_TOKENS ||
                  '24000',
                10,
              ),
            ),
            stream: false,
            timeoutMs: sceneArchitectTimeoutMs,
          });
        })()
      : await callApimartChatCompletions({
          messages,
          model: modelOverride || DEFAULT_MODEL,
          temperature: 0.2,
          jsonObject: true,
          timeoutMs: sceneArchitectTimeoutMs,
          // thinking 由 model id 的 -thinking 后缀决定（APIMart 规范）；
          // 保留 enableThinking=true 作为自动补后缀的兜底（base 模型无后缀时生效）。
          enableThinking: true,
        });
  } catch (err) {
    llmError = err instanceof Error ? err.message : String(err);
    if (args['strict-llm'] === true) {
      throw err;
    }
    console.warn(
      `[${SCRIPT_TAG}] LLM 调用失败，Stage 1.5 将回退草案并继续：${llmError}`,
    );
  }

  /** @type {Record<string, unknown> | null} */
  let rawOut = null;
  try {
    rawOut = text ? parseJsonFromModelText(text) : null;
  } catch (e) {
    console.warn(
      `[${SCRIPT_TAG}] LLM 输出 JSON 解析失败，将回退草案；err=${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const { sanitized, issues } = validateSceneArchitectOutput(rawOut, payload);
  if (llmError) {
    issues.unshift(`llm_call_failed_fallback: ${llmError}`);
  }
  if (issues.length > 0) {
    console.warn(
      `[${SCRIPT_TAG}] 发现 ${issues.length} 条不合规项（已自动回退到草案）：`,
    );
    for (const it of issues) console.warn(`  - ${it}`);
  }

  const rawOutputPath = path.join(outputDir, 'scene_architect_output_raw.json');
  writeJsonFile(rawOutputPath, rawOut || { _note: 'llm output missing', llm_error: llmError });

  const sanitizedPath = path.join(outputDir, 'scene_architect_output.json');
  writeJsonFile(sanitizedPath, {
    ...sanitized,
    _validation_issues: issues,
  });

  applySceneArchitectToEditMap(editMap, sanitized);

  writeJsonFile(editMapPath, editMap);
  console.log(`[${SCRIPT_TAG}] 已回灌到 ${editMapPath}`);
  console.log(`[${SCRIPT_TAG}] Scene Architect 产物: ${sanitizedPath}`);

  const adjustedCount = Array.isArray(sanitized.rhythm_adjustments)
    ? sanitized.rhythm_adjustments.length
    : 0;
  const kvaArrCount = Array.isArray(sanitized.kva_arrangements)
    ? sanitized.kva_arrangements.length
    : 0;
  console.log(
    `[${SCRIPT_TAG}] 完成：rhythm_adjustments=${adjustedCount} kva_arrangements=${kvaArrCount} issues=${issues.length}`,
  );
  return 0;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(__filename).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`[${SCRIPT_TAG}] 失败:`, e instanceof Error ? e.stack || e.message : e);
      process.exit(1);
    });
}
