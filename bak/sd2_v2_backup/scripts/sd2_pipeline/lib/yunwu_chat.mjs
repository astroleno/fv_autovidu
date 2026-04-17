/**
 * 云雾（Yunwu）OpenAI 兼容 Chat Completions 客户端。
 *
 * 文档：`reference/yunwu-openai.md`
 * - POST `${baseUrl}/chat/completions`
 * - Header: `Authorization: Bearer <token>`，`Content-Type` / `Accept: application/json`
 * - 思考类模型可在请求体中通过 `extra_body.enable_thinking` 开启（以网关实际支持为准）
 *
 * 本模块与 `llm_client.mjs` 并列：默认 LLM 仍走 DashScope；云雾专用调用请用本文件，
 * 避免在非云雾环境下误传 `extra_body`。
 */
import { loadEnvFromDotenv } from './load_env.mjs';

loadEnvFromDotenv();

/** @typedef {{ role: 'system' | 'user' | 'assistant'; content: string }} YunwuChatMessage */

/**
 * 解析云雾网关返回的 assistant 文本。
 * 部分思考模型可能在 `message` 上附带额外字段，仍以 `content` 为主。
 *
 * @param {unknown} data
 * @returns {string}
 */
function extractAssistantText(data) {
  if (!data || typeof data !== 'object') {
    return '';
  }
  const choices = /** @type {{ choices?: unknown }} */ (data).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }
  const first = choices[0];
  if (!first || typeof first !== 'object') {
    return '';
  }
  const msg = /** @type {{ message?: { content?: unknown } } } */ (first).message;
  if (!msg || typeof msg.content !== 'string') {
    return '';
  }
  return msg.content.trim();
}

/**
 * 调用云雾 Chat Completions（非流式），返回 assistant 文本。
 *
 * @param {object} opts
 * @param {YunwuChatMessage[]} opts.messages OpenAI 风格消息数组
 * @param {string} [opts.model] 默认读取 `YUNWU_MODEL` 或 `claude-opus-4-6-thinking`
 * @param {string} [opts.apiKey] 默认 `YUNWU_API_KEY`
 * @param {string} [opts.baseUrl] 默认 `https://yunwu.ai/v1`（可含或不含尾 `/v1`，会规范化）
 * @param {number} [opts.temperature]
 * @param {boolean} [opts.jsonObject] 是否请求 `response_format: json_object`
 * @param {boolean} [opts.enableThinking] 是否设置 `extra_body.enable_thinking`
 * @param {number} [opts.maxTokens] 上限 tokens，默认读 `YUNWU_MAX_OUTPUT_TOKENS`
 * @param {number} [opts.timeoutMs] 超时毫秒，默认读 `YUNWU_TIMEOUT_MS` 或 900000
 * @param {number} [opts.maxRetries] 失败重试次数
 * @returns {Promise<string>}
 */
export async function callYunwuChatCompletions({
  messages,
  model,
  apiKey,
  baseUrl,
  temperature = 0.25,
  jsonObject = false,
  enableThinking = true,
  maxTokens,
  timeoutMs,
  maxRetries = 3,
}) {
  const resolvedKey =
    apiKey ||
    process.env.YUNWU_API_KEY ||
    process.env.SD2_LLM_API_KEY ||
    '';
  if (!resolvedKey.trim()) {
    throw new Error(
      '缺少云雾 API 密钥：请配置 YUNWU_API_KEY（或兼容使用 SD2_LLM_API_KEY）',
    );
  }

  const rawBase =
    baseUrl ||
    process.env.YUNWU_BASE_URL ||
    'https://yunwu.ai/v1';
  const normalizedBase = rawBase.replace(/\/$/, '');

  const resolvedModel =
    model ||
    process.env.YUNWU_MODEL ||
    'claude-opus-4-6-thinking';

  const resolvedMaxTokens = Math.max(
    256,
    maxTokens !== undefined
      ? maxTokens
      : parseInt(process.env.YUNWU_MAX_OUTPUT_TOKENS || '16384', 10),
  );

  const resolvedTimeout =
    timeoutMs !== undefined
      ? timeoutMs
      : Math.max(60000, parseInt(process.env.YUNWU_TIMEOUT_MS || '900000', 10));

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
    extra_body: {
      enable_thinking: enableThinking,
    },
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
        throw new Error(`Yunwu HTTP ${res.status}: ${rawText.slice(0, 1200)}`);
      }
      /** @type {{ choices?: unknown; error?: { message?: string } }} */
      const data = JSON.parse(rawText);
      if (data.error && data.error.message) {
        throw new Error(data.error.message);
      }
      const text = extractAssistantText(data);
      if (!text) {
        throw new Error('云雾返回空 content，请检查模型名与网关是否匹配');
      }
      return text;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const delayMs = 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr || new Error('Yunwu 调用失败');
}

/**
 * @returns {{ baseUrl: string; model: string }}
 */
export function getYunwuResolvedDefaults() {
  const rawBase =
    process.env.YUNWU_BASE_URL || 'https://yunwu.ai/v1';
  return {
    baseUrl: rawBase.replace(/\/$/, ''),
    model: process.env.YUNWU_MODEL || 'claude-opus-4-6-thinking',
  };
}
