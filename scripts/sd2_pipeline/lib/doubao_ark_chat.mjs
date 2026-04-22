/**
 * 火山引擎 · 豆包 Ark OpenAI 兼容 Chat Completions 客户端（Node 原生 fetch）。
 *
 * 官方 Python 示例见仓库：`reference/豆包/openai格式.md`（使用 `openai` SDK 的
 * `responses.create` 多模态接口）。本流水线 Stage 2/3 仅需纯文本 system+user，
 * 故采用与 `llm_client.mjs` 相同的 `/chat/completions` 路径，便于与 SD2 块链对接。
 *
 * 环境变量（与文档对齐）：
 *   - ARK_API_KEY：Bearer Token（必填）
 *   - ARK_BASE_URL：默认 `https://ark.cn-beijing.volces.com/api/v3`（勿带尾 `/chat/...`）
 *   - ARK_MODEL：默认 `doubao-seed-2-0-pro-260215`（可按控制台可用模型改）
 *   - ARK_MAX_OUTPUT_TOKENS：默认 65536；Director 大块 JSON 建议 ≥ 8192
 *   - ARK_TIMEOUT_MS：默认 900000（15 分钟），与 SD2_LLM_TIMEOUT_MS 独立
 *
 * 与流水线的衔接：
 *   - `applyArkEnvForSd2Pipeline()` 把上述变量映射到 `SD2_LLM_*`，使 `call_sd2_block_chain_v6.mjs`
 *     内已有的 `callLLM()` 无需改签名即可走 Ark。
 *   - 若需单独调试 HTTP，可调用 `callDoubaoChatCompletions()`。
 */
import { loadEnvFromDotenv } from './load_env.mjs';

loadEnvFromDotenv();

/** @typedef {{ role: 'system' | 'user' | 'assistant'; content: string }} ArkChatMessage */

/**
 * 兼容网关把 `message.content` 设为 string | 片段数组的情况（与 `yunwu_chat.mjs` 同源思路）。
 *
 * @param {unknown} msg
 * @returns {string}
 */
function normalizeArkAssistantContent(msg) {
  if (!msg || typeof msg !== 'object') {
    return '';
  }
  const m = /** @type {Record<string, unknown>} */ (msg);
  const c = m.content;
  if (typeof c === 'string') {
    return c.trim();
  }
  if (Array.isArray(c)) {
    const parts = [];
    for (const part of c) {
      if (typeof part === 'string') {
        parts.push(part);
      } else if (part && typeof part === 'object') {
        const p = /** @type {Record<string, unknown>} */ (part);
        if (typeof p.text === 'string') {
          parts.push(p.text);
        }
      }
    }
    return parts.join('').trim();
  }
  return '';
}

/**
 * @param {unknown} data
 * @returns {{ text: string; finishReason: string }}
 */
function extractArkAssistantText(data) {
  const empty = { text: '', finishReason: '' };
  if (!data || typeof data !== 'object') {
    return empty;
  }
  const root = /** @type {Record<string, unknown>} */ (data);
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return empty;
  }
  const ch0 = choices[0];
  if (!ch0 || typeof ch0 !== 'object') {
    return empty;
  }
  const first = /** @type {Record<string, unknown>} */ (ch0);
  const fr = typeof first.finish_reason === 'string' ? first.finish_reason : '';
  const message = first.message;
  const text = normalizeArkAssistantContent(message);
  return { text, finishReason: fr };
}

/**
 * 在动态 `import('./call_sd2_block_chain_v6.mjs')` 之前调用：
 * 将 Ark 专用 env 写入 `SD2_LLM_*`，复用 `lib/llm_client.mjs` 的 `callLLM()`。
 *
 * 规则：仅当某一 `SD2_LLM_*` 尚未设置时，才用 Ark 默认值填充，避免覆盖用户显式配置。
 *
 * @returns {void}
 */
export function applyArkEnvForSd2Pipeline() {
  const base =
    process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
  const trimmedBase = base.replace(/\/$/, '');

  if (!process.env.SD2_LLM_BASE_URL?.trim()) {
    process.env.SD2_LLM_BASE_URL = trimmedBase;
  }
  if (!process.env.SD2_LLM_API_KEY?.trim() && process.env.ARK_API_KEY?.trim()) {
    process.env.SD2_LLM_API_KEY = process.env.ARK_API_KEY.trim();
  }
  if (!process.env.SD2_LLM_MODEL?.trim()) {
    process.env.SD2_LLM_MODEL =
      process.env.ARK_MODEL?.trim() || 'doubao-seed-2-0-pro-260215';
  }
  if (!process.env.SD2_LLM_MAX_OUTPUT_TOKENS?.trim() && process.env.ARK_MAX_OUTPUT_TOKENS?.trim()) {
    process.env.SD2_LLM_MAX_OUTPUT_TOKENS = process.env.ARK_MAX_OUTPUT_TOKENS.trim();
  }
  if (!process.env.SD2_LLM_TIMEOUT_MS?.trim() && process.env.ARK_TIMEOUT_MS?.trim()) {
    process.env.SD2_LLM_TIMEOUT_MS = process.env.ARK_TIMEOUT_MS.trim();
  }
  /**
   * v6.2-HOTFIX-K · 火山 Ark 的 doubao-seed-2-0-* 系列文本模型目前不支持
   * `response_format: json_object`（400 `InvalidParameter`）。默认为 Ark 链路
   * 开启 `SD2_LLM_DISABLE_JSON_RESPONSE_FORMAT=1`；如用户显式设置过则不覆盖。
   * 下游 JSON 归一由 system prompt 硬要求 + `parseJsonFromModelText` 兜底。
   */
  if (!process.env.SD2_LLM_DISABLE_JSON_RESPONSE_FORMAT?.trim()) {
    process.env.SD2_LLM_DISABLE_JSON_RESPONSE_FORMAT = '1';
  }
}

/**
 * 单次 Chat Completions 调用（OpenAI 兼容形态）。
 *
 * @param {object} opts
 * @param {ArkChatMessage[]} opts.messages
 * @param {string} [opts.model]
 * @param {string} [opts.apiKey] 默认 `ARK_API_KEY`
 * @param {string} [opts.baseUrl] 默认 `ARK_BASE_URL` 或北京区 v3 根
 * @param {number} [opts.temperature]
 * @param {boolean} [opts.jsonObject] `response_format: json_object`
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxRetries]
 * @returns {Promise<string>}
 */
export async function callDoubaoChatCompletions({
  messages,
  model,
  apiKey,
  baseUrl,
  temperature = 0.3,
  jsonObject = false,
  maxTokens,
  timeoutMs,
  maxRetries = 3,
}) {
  const resolvedKey = (apiKey || process.env.ARK_API_KEY || '').trim();
  if (!resolvedKey) {
    throw new Error('缺少 ARK_API_KEY（火山 Ark API Key）');
  }

  const rawBase = baseUrl || process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
  const normalizedBase = rawBase.replace(/\/$/, '');

  const resolvedModel =
    model || process.env.ARK_MODEL || 'doubao-seed-2-0-pro-260215';

  const resolvedMaxTokens = Math.max(
    256,
    maxTokens !== undefined
      ? maxTokens
      : parseInt(process.env.ARK_MAX_OUTPUT_TOKENS || '65536', 10),
  );

  const resolvedTimeout =
    timeoutMs !== undefined
      ? timeoutMs
      : Math.max(60000, parseInt(process.env.ARK_TIMEOUT_MS || '900000', 10));

  const abortSignal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(resolvedTimeout)
      : undefined;

  /** @type {Record<string, unknown>} */
  const body = {
    model: resolvedModel,
    messages,
    temperature,
    stream: false,
    max_tokens: resolvedMaxTokens,
  };
  if (jsonObject) {
    body.response_format = { type: 'json_object' };
  }

  const url = `${normalizedBase}/chat/completions`;

  let lastErr = /** @type {Error | null} */ (null);
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolvedKey}`,
        },
        body: JSON.stringify(body),
        ...(abortSignal ? { signal: abortSignal } : {}),
      });
      const rawText = await res.text();
      if (!res.ok) {
        throw new Error(`Ark HTTP ${res.status}: ${rawText.slice(0, 1200)}`);
      }
      /** @type {{ error?: { message?: string } }} */
      const data = JSON.parse(rawText);
      if (data.error && typeof data.error.message === 'string') {
        throw new Error(data.error.message);
      }
      const { text, finishReason } = extractArkAssistantText(data);
      if (finishReason === 'length') {
        throw new Error(
          `[doubao_ark_chat] finish_reason=length：输出被截断，请增大 ARK_MAX_OUTPUT_TOKENS（当前 ${resolvedMaxTokens}）`,
        );
      }
      if (!text) {
        throw new Error('[doubao_ark_chat] assistant 正文为空，请检查模型名与响应结构');
      }
      return text;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const delayMs = 400 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr || new Error('Ark 调用失败');
}

/**
 * 日志展示用：与 `getResolvedLlmModel()` 对齐的只读视图。
 *
 * @returns {{ baseUrl: string; model: string }}
 */
export function getArkResolvedDefaults() {
  const raw = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
  return {
    baseUrl: raw.replace(/\/$/, ''),
    model: process.env.ARK_MODEL || 'doubao-seed-2-0-pro-260215',
  };
}
