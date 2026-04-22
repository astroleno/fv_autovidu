/**
 * API Mart - Anthropic Messages API 客户端。
 *
 * 用途：
 *   - 原生 Anthropic 端点 POST /v1/messages，认证用 `x-api-key` + `anthropic-version`
 *   - 支持 thinking 模型（如 claude-opus-4-6-thinking），响应 content[] 会混有
 *     {type:"thinking"} 与 {type:"text"} 两种 block，本模块只拼接 text block 作为正文
 *   - 支持流式（SSE）以避免上游网关在长推理任务中 idle 超时
 *
 * 与 `apimart_chat.mjs`（OpenAI 兼容端点）的区别：
 *   - 4-6 / 4-6-thinking 等新模型只在 /v1/messages 上可用，在 /v1/chat/completions 上 503
 *   - system 字段是顶层而非 messages[0]
 *   - 响应是 Anthropic 原生格式，不是 OpenAI choices[].message.content
 *
 * 参考文档：reference/apimart/claude.md（/v1/messages 接口规格）
 */
import { loadEnvFromDotenv } from './load_env.mjs';

loadEnvFromDotenv();

/** 本端点固定的 Anthropic API 版本。APIMart 文档示例用 2025-10-01。 */
const ANTHROPIC_VERSION = process.env.APIMART_ANTHROPIC_VERSION || '2025-10-01';

/**
 * 输入消息（user / assistant）。system 不走这里，单独作为顶层字段。
 * @typedef {{ role: 'user' | 'assistant'; content: string }} AnthropicTurnMsg
 */

/**
 * 非流式响应 content 里可能出现的 block（不含 tool_use 等工具场景，本 client 只处理文本类）。
 * @typedef {{ type: 'text'; text: string }
 *         | { type: 'thinking'; thinking?: string; signature?: string }
 *         | { type: string }} AnthropicContentBlock
 */

/**
 * 从非流式响应 JSON 中抽取"纯 text 正文"；thinking 只作兜底（content 为空时退而求其次）。
 *
 * @param {unknown} data APIMart 返回 body
 * @returns {{ text: string; stopReason: string; usage: { input: number; output: number } | null }}
 */
function extractFromMessagesResponse(data) {
  const empty = { text: '', stopReason: '', usage: null };
  if (!data || typeof data !== 'object') {
    return empty;
  }
  const root = /** @type {Record<string, unknown>} */ (data);
  const content = root.content;
  /** @type {string[]} */
  const texts = [];
  /** @type {string[]} */
  const thinkings = [];
  if (Array.isArray(content)) {
    for (const b of content) {
      if (!b || typeof b !== 'object') {
        continue;
      }
      const block = /** @type {Record<string, unknown>} */ (b);
      if (block.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text);
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        thinkings.push(block.thinking);
      }
    }
  }
  const text = texts.join('').trim() || thinkings.join('').trim();
  const stopReason = typeof root.stop_reason === 'string' ? root.stop_reason : '';
  /** @type {{ input: number; output: number } | null} */
  let usage = null;
  if (root.usage && typeof root.usage === 'object') {
    const u = /** @type {Record<string, unknown>} */ (root.usage);
    usage = {
      input: typeof u.input_tokens === 'number' ? u.input_tokens : 0,
      output: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
    };
  }
  return { text, stopReason, usage };
}

/**
 * 流式解析 Anthropic SSE。只累加 `text_delta` 作为正文；`thinking_delta` 单独累积，
 * 仅在 text 为空时作为兜底返回（防止 thinking-only 的极端响应被判空）。
 *
 * 关键事件：
 *   - event: content_block_delta
 *     data: {"type":"content_block_delta","index":N,
 *            "delta":{"type":"text_delta","text":"..."}
 *                  | {"type":"thinking_delta","thinking":"..."}}
 *   - event: message_delta
 *     data: {"delta":{"stop_reason":"end_turn"|"max_tokens"|...}}
 *   - event: message_stop（终止信号）
 *   - 偶发 `:ping` 或空行作为心跳，忽略
 *
 * @param {Response} res fetch 响应
 * @returns {Promise<{ text: string; stopReason: string }>}
 */
async function readAnthropicSse(res) {
  if (!res.body) {
    throw new Error('APIMart Messages SSE 响应体为空');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let textOut = '';
  let thinkingOut = '';
  let stopReason = '';

  /**
   * @param {string} dataStr 单个 data: 后面的 JSON 字符串
   * @returns {boolean} true 表示遇到 message_stop，可提前退出
   */
  const processDataLine = (dataStr) => {
    const trimmed = dataStr.trim();
    if (!trimmed || trimmed === '[DONE]') {
      return trimmed === '[DONE]';
    }
    try {
      const ev = JSON.parse(trimmed);
      if (ev && typeof ev === 'object') {
        const obj = /** @type {Record<string, unknown>} */ (ev);
        const t = obj.type;
        if (t === 'content_block_delta' && obj.delta && typeof obj.delta === 'object') {
          const d = /** @type {Record<string, unknown>} */ (obj.delta);
          if (d.type === 'text_delta' && typeof d.text === 'string') {
            textOut += d.text;
          } else if (d.type === 'thinking_delta' && typeof d.thinking === 'string') {
            thinkingOut += d.thinking;
          }
        } else if (t === 'message_delta' && obj.delta && typeof obj.delta === 'object') {
          const d = /** @type {Record<string, unknown>} */ (obj.delta);
          if (typeof d.stop_reason === 'string') {
            stopReason = d.stop_reason;
          }
        } else if (t === 'message_stop') {
          return true;
        }
      }
    } catch {
      // 忽略心跳 / 非 JSON 行
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
      const rawLine = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
      const line = rawLine.replace(/\r$/, '');
      if (!line || line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('data:')) {
        const ended = processDataLine(line.slice(5));
        if (ended) {
          try {
            reader.cancel();
          } catch {
            // noop
          }
          return { text: (textOut || thinkingOut).trim(), stopReason };
        }
      }
      // event: 行不处理（Anthropic 把关键信息都塞在 data: 里）
    }
  }
  if (buffer.trim().startsWith('data:')) {
    processDataLine(buffer.trim().slice(5));
  }
  return { text: (textOut || thinkingOut).trim(), stopReason };
}

/**
 * 调用 APIMart /v1/messages。
 *
 * 与 openai 兼容 client 的签名对齐（`messages[0].role==='system'` 会被自动剥离到顶层 system）。
 *
 * @param {object} opts
 * @param {Array<{role: 'system' | 'user' | 'assistant'; content: string}>} opts.messages
 *        允许 messages[0] 为 system（会被抽出到顶层 system 字段）；其余只能是 user/assistant
 * @param {string} [opts.model]            必传；例如 `claude-opus-4-6-thinking`
 * @param {string} [opts.apiKey]
 * @param {string} [opts.baseUrl]
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]        thinking 模型时请放大（含推理预算）
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxRetries]
 * @param {boolean} [opts.stream]          默认读 APIMART_STREAM，未设时 true
 * @param {number} [opts.thinkingBudget]   开启 extended thinking 的 budget_tokens；未传则不开启显式 thinking 参数
 *                                         （模型名含 `-thinking` 时 APIMart 会自动路由到 thinking 版本）
 * @returns {Promise<string>}
 */
export async function callApimartMessages({
  messages,
  model,
  apiKey,
  baseUrl,
  temperature = 0.25,
  maxTokens,
  timeoutMs,
  maxRetries = 3,
  stream: streamParam,
  thinkingBudget,
}) {
  const resolvedKey =
    apiKey ||
    process.env.APIMART_API_KEY ||
    process.env.APIMART_KEY ||
    '';
  if (!resolvedKey.trim()) {
    throw new Error('缺少 APIMart 密钥：请配置 APIMART_API_KEY（或 APIMART_KEY）');
  }
  if (!model || !model.trim()) {
    throw new Error('callApimartMessages 必须显式传入 model（如 claude-opus-4-6-thinking）');
  }

  const rawBase = baseUrl || process.env.APIMART_BASE_URL || 'https://api.apimart.ai/v1';
  const normalizedBase = rawBase.replace(/\/$/, '');

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

  // Anthropic 格式：system 从 messages 顶部拆出，其余只能 user/assistant
  /** @type {string} */
  let systemText = '';
  /** @type {AnthropicTurnMsg[]} */
  const turnMsgs = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemText = systemText ? `${systemText}\n\n${m.content}` : m.content;
    } else if (m.role === 'user' || m.role === 'assistant') {
      turnMsgs.push({ role: m.role, content: m.content });
    }
  }
  if (turnMsgs.length === 0) {
    throw new Error('messages 必须至少包含一条 user/assistant 消息');
  }

  /** @type {Record<string, unknown>} */
  const body = {
    model,
    max_tokens: resolvedMaxTokens,
    temperature,
    messages: turnMsgs,
    stream: useStream,
  };
  if (systemText) {
    body.system = systemText;
  }
  // 仅当显式开启 extended thinking 时才传 thinking 字段。
  // 若模型名本身是 `-thinking`，APIMart 端已按模型名路由，不一定需要此字段。
  if (typeof thinkingBudget === 'number' && thinkingBudget > 0) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
  }

  const url = `${normalizedBase}/messages`;

  /** @type {Error | null} */
  let lastErr = null;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const abortSignal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(resolvedTimeout)
        : undefined;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': resolvedKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
          accept: useStream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(body),
        ...(abortSignal ? { signal: abortSignal } : {}),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`APIMart /messages HTTP ${res.status}: ${errText.slice(0, 1200)}`);
      }

      let text = '';
      let stopReason = '';

      if (useStream) {
        const r = await readAnthropicSse(res);
        text = r.text;
        stopReason = r.stopReason;
      } else {
        const rawText = await res.text();
        const data = JSON.parse(rawText);
        if (data && data.error && data.error.message) {
          throw new Error(String(data.error.message));
        }
        const r = extractFromMessagesResponse(data);
        text = r.text;
        stopReason = r.stopReason;
        if (r.usage) {
          console.log(
            `[apimart_messages] token 用量: input=${r.usage.input} output=${r.usage.output}`,
          );
        }
      }

      // Anthropic stop_reason 为 `max_tokens` 即触发截断重试（等价 OpenAI 的 length）
      if (stopReason === 'max_tokens') {
        /** @type {Error & { finishReason?: string; partialText?: string }} */
        const err = new Error(
          `[apimart_messages] 输出被截断 (stop_reason=max_tokens)。max_tokens=${resolvedMaxTokens}。` +
            `thinking 类模型 output_tokens 含推理预算，请调大 APIMART_EDITMAP_MAX_TOKENS。`,
        );
        err.finishReason = 'length';
        err.partialText = text;
        throw err;
      }

      if (!text || !String(text).trim()) {
        throw new Error(
          `[apimart_messages] 返回空正文（stream=${useStream} stop_reason=${stopReason || 'n/a'}）`,
        );
      }

      return text;
    } catch (e) {
      const wrapped = e instanceof Error ? e : new Error(String(e));
      // 截断错误不重试（max_tokens 触顶，下游按 length 处理）
      if (/** @type {Record<string, unknown>} */ (wrapped).finishReason === 'length') {
        throw wrapped;
      }
      lastErr = wrapped;
      const delayMs = 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr || new Error('APIMart /messages 调用失败');
}

/**
 * 展示用默认参数（不做 thinking 后缀推导，model 由调用方显式指定）。
 * @returns {{ baseUrl: string; model: string; anthropicVersion: string }}
 */
export function getApimartMessagesDefaults() {
  const raw = process.env.APIMART_BASE_URL || 'https://api.apimart.ai/v1';
  return {
    baseUrl: raw.replace(/\/$/, ''),
    model: process.env.APIMART_MESSAGES_MODEL || 'claude-opus-4-6-thinking',
    anthropicVersion: ANTHROPIC_VERSION,
  };
}
