/**
 * API Mart（OpenAI 兼容）Chat Completions 客户端，用于替代云雾高错误率场景。
 *
 * 文档基线：`reference/apimart/openai-sse.md`
 * - POST `${baseUrl}/chat/completions`
 * - 认证：`Authorization: Bearer <APIMART_API_KEY>`
 * - 支持 `stream: true`（SSE，推荐大 system prompt 时开启，避免连接 idle 被掐断）
 * - 思考型模型在 API Mart 中通常以独立 model id（如 `*-thinking`）出现，不依赖云雾的 `extra_body.enable_thinking`
 */
import { loadEnvFromDotenv } from './load_env.mjs';
import { extractJsonFromReasoningLoose } from './yunwu_reasoning_json_extract.mjs';

loadEnvFromDotenv();

/** @typedef {{ role: 'system' | 'user' | 'assistant'; content: string }} ApimartChatMessage */

/**
 * 从 message 取出可打印的正文（兼容 string / 数组多段 / reasoning 回落）。
 * @param {unknown} msg
 * @param {string} fromContent
 * @returns {string}
 */
function textFromMessage(msg, fromContent) {
  if (fromContent && fromContent.trim()) {
    return fromContent.trim();
  }
  if (!msg || typeof msg !== 'object') {
    return '';
  }
  const m = /** @type {Record<string, unknown>} */ (msg);
  const r = m.reasoning_content;
  if (typeof r === 'string') {
    const t = r.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      return t;
    }
    if (t.length > 0) {
      const extracted = extractJsonFromReasoningLoose(r);
      if (extracted) {
        return extracted;
      }
    }
  }
  return '';
}

/**
 * 同 yunwu：解析 OpenAI 兼容非流式响应。
 * @param {unknown} data
 * @returns {{ text: string; finishReason: string; usage: { prompt: number; completion: number; total: number } | null }}
 */
function extractAssistantNonStream(data) {
  const empty = { text: '', finishReason: '', usage: null };
  if (!data || typeof data !== 'object') {
    return empty;
  }
  const root = /** @type {Record<string, unknown>} */ (data);
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return empty;
  }
  const first = /** @type {Record<string, unknown>} */ (choices[0]);
  const msg = first.message;
  const fromContent =
    msg && typeof msg === 'object'
      ? normalizeOneContent(/** @type {Record<string, unknown>} */ (msg).content)
      : '';
  const text = textFromMessage(msg, fromContent);
  const finishReason =
    typeof first.finish_reason === 'string' ? first.finish_reason : '';
  let usage = null;
  const u = root.usage;
  if (u && typeof u === 'object') {
    const uu = /** @type {Record<string, unknown>} */ (u);
    usage = {
      prompt: typeof uu.prompt_tokens === 'number' ? uu.prompt_tokens : 0,
      completion: typeof uu.completion_tokens === 'number' ? uu.completion_tokens : 0,
      total: typeof uu.total_tokens === 'number' ? uu.total_tokens : 0,
    };
  }
  return { text: text.trim(), finishReason, usage };
}

/**
 * @param {unknown} c
 * @returns {string}
 */
function normalizeOneContent(c) {
  if (typeof c === 'string') {
    return c;
  }
  if (Array.isArray(c)) {
    const parts = [];
    for (const part of c) {
      if (typeof part === 'string') {
        parts.push(part);
      } else if (part && typeof part === 'object' && 'text' in part) {
        const t = /** @type {Record<string, unknown>} */ (part).text;
        if (typeof t === 'string') {
          parts.push(t);
        }
      }
    }
    return parts.join('');
  }
  return '';
}

/**
 * 流式读取：在标准 readSseChatStream 之上记录最后一个 finish_reason（用于 length 重试）。
 * @param {Response} res
 * @returns {Promise<{ text: string; finishReason: string }>}
 */
async function readSseWithFinishHint(res) {
  if (!res.body) {
    throw new Error('APIMart SSE 响应体为空');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let reasoning = '';
  let finishReason = '';

  const processEventData = (dataStr) => {
    const trimmed = dataStr.trim();
    if (!trimmed || trimmed === '[DONE]') {
      return trimmed === '[DONE]';
    }
    try {
      const ev = JSON.parse(trimmed);
      const ch0 = ev.choices && ev.choices[0] ? ev.choices[0] : null;
      if (ch0 && typeof ch0.finish_reason === 'string' && ch0.finish_reason) {
        finishReason = ch0.finish_reason;
      }
      const delta = ch0 && ch0.delta ? ch0.delta : null;
      if (delta) {
        if (typeof delta.content === 'string') {
          content += delta.content;
        }
        if (typeof delta.reasoning_content === 'string') {
          reasoning += delta.reasoning_content;
        }
      }
    } catch {
      // 心跳/断行
    }
    return false;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
      const l = line.replace(/\r$/, '');
      if (!l || l.startsWith(':')) {
        continue;
      }
      if (l.startsWith('data:')) {
        const ended = processEventData(l.slice(5));
        if (ended) {
          try {
            reader.cancel();
          } catch {
            // noop
          }
          return { text: (content || reasoning).trim(), finishReason };
        }
      }
    }
  }
  if (buffer.trim().startsWith('data:')) {
    processEventData(buffer.trim().slice(5));
  }
  return { text: (content || reasoning).trim(), finishReason };
}

/**
 * 将「基础模型名」在开启 thinking 时解析为带 `-thinking` 后缀的 id（可用 APIMART_THINKING_MODEL 整名覆盖）。
 *
 * @param {string} base
 * @param {boolean} enableThinking
 * @param {string | undefined} explicitModel
 * @returns {string}
 */
export function resolveApimartModelId(base, enableThinking) {
  if (!enableThinking) {
    return base;
  }
  const thinkingFull = process.env.APIMART_THINKING_MODEL || '';
  if (thinkingFull.trim()) {
    return thinkingFull.trim();
  }
  if (/-thinking$/i.test(base)) {
    return base;
  }
  return `${base}-thinking`;
}

/**
 * @param {object} opts
 * @param {ApimartChatMessage[]} opts.messages
 * @param {string} [opts.model]     显式 model id（含 `-thinking` 时优先生效）
 * @param {string} [opts.modelBase] 未设 model 时，与 enableThinking 组合成最终 id
 * @param {string} [opts.apiKey]
 * @param {string} [opts.baseUrl]
 * @param {number} [opts.temperature]
 * @param {boolean} [opts.jsonObject]      请求 response_format: json_object
 * @param {boolean} [opts.enableThinking]  为 true 且未设 APIMART_THINKING_MODEL 时，在 modelBase 后加 -thinking
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxRetries]
 * @param {boolean} [opts.stream]          默认读 APIMART_STREAM，未设时 true（大 prompt 防 idle）
 * @returns {Promise<string>}
 */
export async function callApimartChatCompletions({
  messages,
  model: modelParam,
  modelBase,
  apiKey,
  baseUrl,
  temperature = 0.25,
  jsonObject = false,
  enableThinking = true,
  maxTokens,
  timeoutMs,
  maxRetries = 3,
  stream: streamParam,
}) {
  const resolvedKey =
    apiKey ||
    process.env.APIMART_API_KEY ||
    process.env.APIMART_KEY ||
    '';
  if (!resolvedKey.trim()) {
    throw new Error('缺少 API Mart 密钥：请配置 APIMART_API_KEY（或 APIMART_KEY）');
  }

  const rawBase = baseUrl || process.env.APIMART_BASE_URL || 'https://api.apimart.ai/v1';
  const normalizedBase = rawBase.replace(/\/$/, '');

  const baseName = modelBase || process.env.APIMART_MODEL || 'claude-opus-4-7';
  const finalModel =
    typeof modelParam === 'string' && modelParam.trim()
      ? modelParam.trim()
      : resolveApimartModelId(baseName, enableThinking);

  const resolvedMaxTokens = Math.max(
    256,
    maxTokens !== undefined
      ? maxTokens
      : parseInt(process.env.APIMART_MAX_OUTPUT_TOKENS || '65536', 10),
  );

  const resolvedTimeout = Math.max(
    60000,
    timeoutMs !== undefined
      ? timeoutMs
      : parseInt(process.env.APIMART_TIMEOUT_MS || '900000', 10),
  );

  const streamDefault =
    String(process.env.APIMART_STREAM || '1').trim() !== '0' &&
    String(process.env.APIMART_DISABLE_STREAM || '').trim() !== '1';
  const useStream = streamParam !== undefined ? streamParam : streamDefault;

  const abortSignal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(resolvedTimeout)
      : undefined;

  const url = `${normalizedBase}/chat/completions`;

  let lastErr = /** @type {Error | null} */ (null);
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      /** @type {Record<string, unknown>} */
      const body = {
        model: finalModel,
        messages,
        temperature,
        stream: useStream,
        max_tokens: resolvedMaxTokens,
      };
      if (jsonObject) {
        body.response_format = { type: 'json_object' };
      }
      if (!useStream) {
        body.stream = false;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: useStream ? 'text/event-stream' : 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolvedKey}`,
        },
        body: JSON.stringify(body),
        ...(abortSignal ? { signal: abortSignal } : {}),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`APIMart HTTP ${res.status}: ${errText.slice(0, 1200)}`);
      }

      let text = '';
      let finishReason = '';

      if (useStream) {
        const r = await readSseWithFinishHint(res);
        text = r.text;
        finishReason = r.finishReason;
      } else {
        const rawText = await res.text();
        const data = JSON.parse(rawText);
        if (data.error && data.error.message) {
          throw new Error(String(data.error.message));
        }
        const r = extractAssistantNonStream(data);
        text = r.text;
        finishReason = r.finishReason;
        if (r.usage) {
          console.log(
            `[apimart_chat] token 用量: prompt=${r.usage.prompt} completion=${r.usage.completion} total=${r.usage.total}`,
          );
        }
      }

      if (finishReason === 'length') {
        const err = new Error(
          `[apimart_chat] 输出被截断 (finish_reason=length)。max_tokens=${resolvedMaxTokens}。` +
            `thinking 类模型时 completion 预算含推理 token，可增大 APIMART_EDITMAP_MAX_TOKENS。`,
        );
        /** @type {Error & { finishReason?: string; partialText?: string }} */ (err).finishReason = 'length';
        /** @type {Error & { finishReason?: string; partialText?: string }} */ (err).partialText = text;
        throw err;
      }

      if (!text || !String(text).trim()) {
        const err = new Error(
          `[apimart_chat] 返回空正文（stream=${useStream} finish_reason=${finishReason || 'n/a'}）`,
        );
        throw err;
      }

      return text;
    } catch (e) {
      const wrapped = e instanceof Error ? e : new Error(String(e));
      if (/** @type {Record<string, unknown>} */ (wrapped).finishReason === 'length') {
        throw wrapped;
      }
      lastErr = wrapped;
      const delayMs = 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr || new Error('APIMart 调用失败');
}

/**
 * 默认展示用（不区分 thinking 名）。
 * @returns {{ baseUrl: string; model: string }}
 */
export function getApimartResolvedDefaults() {
  const raw = process.env.APIMART_BASE_URL || 'https://api.apimart.ai/v1';
  return {
    baseUrl: raw.replace(/\/$/, ''),
    model: process.env.APIMART_MODEL || 'claude-opus-4-7',
  };
}
