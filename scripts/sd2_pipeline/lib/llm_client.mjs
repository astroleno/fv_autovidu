/**
 * OpenAI 兼容 Chat Completions 封装，供 EditMap-SD2 / SD2Prompter 调用。
 * 默认对接阿里云 DashScope 兼容模式；也可通过 SD2_LLM_* 指向任意兼容网关。
 */
import { jsonrepair } from 'jsonrepair';

import { loadEnvFromDotenv } from './load_env.mjs';

loadEnvFromDotenv();

/** @typedef {{ role: 'system' | 'user' | 'assistant'; content: string }} ChatMessage */

/**
 * 当前 SD2 流水线将使用的模型名（与 callLLM 默认一致，便于日志展示）。
 * @returns {string}
 */
export function getResolvedLlmModel() {
  return process.env.SD2_LLM_MODEL || 'qwen-plus';
}

/**
 * 当前 OpenAI 兼容 API 根路径（不含尾斜杠）。
 * @returns {string}
 */
export function getResolvedLlmBaseUrl() {
  return (
    process.env.SD2_LLM_BASE_URL ||
    'https://dashscope.aliyuncs.com/compatible-mode/v1'
  ).replace(/\/$/, '');
}

/**
 * HOTFIX P · 从 base_url 反推供应商（仅用于产物 trace / 审计）。
 * @param {string} baseUrl
 * @returns {string}
 */
export function inferLlmProviderFromBaseUrl(baseUrl) {
  const u = String(baseUrl || '').toLowerCase();
  if (u.includes('volcengineapi.com') || u.includes('ark.cn-') || u.includes('/ark/')) return 'doubao_ark';
  if (u.includes('dashscope.aliyuncs.com') || u.includes('bailian.aliyuncs.com')) return 'dashscope_qwen';
  if (u.includes('yunwu.ai') || u.includes('yun-wu.com')) return 'yunwu';
  if (u.includes('openai.com')) return 'openai';
  if (u.includes('anthropic.com')) return 'anthropic';
  if (u.includes('deepseek.com')) return 'deepseek';
  return 'custom_openai_compatible';
}

/**
 * HOTFIX P · 当前 LLM 调用参数快照（用于写入产物元数据以便审计）。
 *
 * 注意：绝不包含 API Key；只包含 base_url / model / 与调用行为相关的几个开关。
 * @returns {{
 *   provider: string,
 *   base_url: string,
 *   model: string,
 *   json_response_format_disabled: boolean,
 *   max_output_tokens: number | null,
 *   timeout_ms: number,
 * }}
 */
export function getLlmTraceSnapshot() {
  const baseUrl = getResolvedLlmBaseUrl();
  const maxOutRaw = process.env.SD2_LLM_MAX_OUTPUT_TOKENS || '';
  const mt = maxOutRaw.trim() ? parseInt(maxOutRaw, 10) : NaN;
  return {
    provider: inferLlmProviderFromBaseUrl(baseUrl),
    base_url: baseUrl,
    model: getResolvedLlmModel(),
    json_response_format_disabled:
      String(process.env.SD2_LLM_DISABLE_JSON_RESPONSE_FORMAT || '').trim() === '1',
    max_output_tokens: Number.isFinite(mt) && mt > 0 ? mt : null,
    timeout_ms: Math.max(60000, parseInt(process.env.SD2_LLM_TIMEOUT_MS || '900000', 10)),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {string} [opts.model]
 * @param {number} [opts.temperature]
 * @param {boolean} [opts.jsonObject] 请求 response_format json_object（模型需支持）
 * @param {number} [opts.maxRetries]
 * @returns {Promise<string>} assistant 文本内容
 */
export async function callLLM({
  systemPrompt,
  userMessage,
  model,
  temperature = 0.3,
  jsonObject = false,
  maxRetries = 3,
}) {
  const baseUrl = (
    process.env.SD2_LLM_BASE_URL ||
    'https://dashscope.aliyuncs.com/compatible-mode/v1'
  ).replace(/\/$/, '');
  const apiKey =
    process.env.SD2_LLM_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.YUNWU_API_KEY ||
    '';
  if (!apiKey) {
    throw new Error(
      '缺少 API 密钥：请配置 SD2_LLM_API_KEY，或设置 DASHSCOPE_API_KEY / YUNWU_API_KEY',
    );
  }
  const resolvedModel =
    model ||
    process.env.SD2_LLM_MODEL ||
    'qwen-plus';

  /** @type {ChatMessage[]} */
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const url = `${baseUrl}/chat/completions`;
  const body = {
    model: resolvedModel,
    messages,
    temperature,
  };
  /**
   * v6.2-HOTFIX-K · 网关/模型不支持 `response_format: json_object` 时（例如
   * 火山 Ark 的 doubao-seed-2-0-* 系列会 400 `InvalidParameter`），允许用
   * `SD2_LLM_DISABLE_JSON_RESPONSE_FORMAT=1` 显式关掉该参数；JSON 归一完全由
   * system prompt + `parseJsonFromModelText` 的 jsonrepair 兜底。
   */
  const disableJsonFormat =
    String(process.env.SD2_LLM_DISABLE_JSON_RESPONSE_FORMAT || '').trim() === '1';
  if (jsonObject && !disableJsonFormat) {
    body.response_format = { type: 'json_object' };
  }
  /** 长 JSON（Director / Prompter）可设 SD2_LLM_MAX_OUTPUT_TOKENS，兼容火山 Ark / 其它网关。 */
  const maxOutRaw = process.env.SD2_LLM_MAX_OUTPUT_TOKENS || '';
  if (maxOutRaw.trim()) {
    const mt = parseInt(maxOutRaw, 10);
    if (Number.isFinite(mt) && mt > 0) {
      body.max_tokens = mt;
    }
  }

  /** EditMap 等大输入可能超过默认 TCP/空闲超时，默认 15 分钟，可用 SD2_LLM_TIMEOUT_MS 覆盖（毫秒）。 */
  const timeoutMs = Math.max(
    60000,
    parseInt(process.env.SD2_LLM_TIMEOUT_MS || '900000', 10),
  );
  const abortSignal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;

  /**
   * HOTFIX R · SSE 流式开关。
   *
   * 背景：云雾网关（yunwu.ai）对 `claude-opus-4-6-thinking` 这类"思考模型 +
   *       大 system prompt（23k tokens）"的非流式请求会触发上游 idle-timeout
   *       （实测 ~20 分钟 `fetch failed`），即便请求侧 timeout 设到 40+ 分钟也救
   *       不回来，因为上游先把连接关了。
   *
   * 修复：打开 `SD2_LLM_STREAM=1` 时，改用 `stream: true` + SSE 逐块累积。只要模
   *       型有"心跳式"chunk 输出（包括 `delta.reasoning_content` 的思考流），
   *       连接就不会 idle，直到最终拿到 `[DONE]` 或超时。
   *
   * 抽取策略：优先累积 `choices[0].delta.content`；若流结束仍为空但收到了
   *           `delta.reasoning_content`（thinking 模型回退字段），返回推理文本
   *           交由下游 `parseJsonFromModelText` / jsonrepair 再兜底。
   */
  const useStream =
    String(process.env.SD2_LLM_STREAM || '').trim() === '1';
  if (useStream) {
    body.stream = true;
  }

  let lastErr = /** @type {Error | null} */ (null);
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(useStream ? { Accept: 'text/event-stream' } : {}),
        },
        body: JSON.stringify(body),
        ...(abortSignal ? { signal: abortSignal } : {}),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 800)}`);
      }
      if (useStream) {
        const streamed = await readSseChatStream(res);
        if (!streamed || !streamed.trim()) {
          throw new Error('LLM 返回空内容（stream）');
        }
        return streamed.trim();
      }
      const rawText = await res.text();
      /** @type {{ choices?: Array<{ message?: { content?: string } }>, error?: { message?: string } }} */
      const data = JSON.parse(rawText);
      if (data.error && data.error.message) {
        throw new Error(data.error.message);
      }
      const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : '';
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('LLM 返回空内容');
      }
      return content.trim();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const delayMs = 400 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr || new Error('LLM 调用失败');
}

/**
 * HOTFIX R · 读取 OpenAI/Claude 兼容 SSE Chat Completion 流，累积文本返回。
 *
 * 兼容点：
 *   1. `data: {"choices":[{"delta":{"content":"..."}}]}` 标准 OpenAI 格式；
 *   2. `delta.reasoning_content` — 云雾对 Anthropic thinking 模型的自定义字段，
 *      当网关把主要 payload 放在思考流时，`content` 可能为空或仅 `"\n"`；
 *   3. `data: [DONE]` 标识流结束；
 *   4. 个别供应商会在同一行 data 里塞多段 JSON 或在 chunk 边界断行，本函数
 *      用行缓冲 + `trim() === '[DONE]'` 判定结束。
 *
 * 回退逻辑：若流结束时 `content` 仍为空但 `reasoning` 非空，返回 reasoning 文本，
 * 让调用方的 `parseJsonFromModelText` 再用 jsonrepair 抽 JSON。
 *
 * @param {Response} res
 * @returns {Promise<string>} 累积的 assistant 文本
 */
export async function readSseChatStream(res) {
  if (!res.body) {
    throw new Error('SSE 响应体为空（无 res.body）');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let reasoning = '';

  const processEventData = (dataStr) => {
    const trimmed = dataStr.trim();
    if (!trimmed) return false;
    if (trimmed === '[DONE]') return true;
    try {
      const ev = JSON.parse(trimmed);
      const delta =
        ev && ev.choices && ev.choices[0] && ev.choices[0].delta
          ? ev.choices[0].delta
          : null;
      if (delta) {
        if (typeof delta.content === 'string') content += delta.content;
        if (typeof delta.reasoning_content === 'string')
          reasoning += delta.reasoning_content;
      }
    } catch {
      // 非 JSON 行静默跳过（心跳 / 注释行）
    }
    return false;
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
      const l = line.replace(/\r$/, '');
      if (!l || l.startsWith(':')) continue; // 空行 / SSE 注释
      if (l.startsWith('data:')) {
        const ended = processEventData(l.slice(5));
        if (ended) {
          try { reader.cancel(); } catch { /* noop */ }
          return content || reasoning;
        }
      }
    }
  }
  // 处理残留 buffer
  if (buffer.trim().startsWith('data:')) {
    processEventData(buffer.trim().slice(5));
  }
  return content || reasoning;
}

/**
 * 从模型输出中解析 JSON（兼容外层包裹 ```json 代码块）。
 *
 * HOTFIX R 扩展：SSE 流式 + thinking 模型（如 `claude-opus-4-6-thinking`）会把
 *   "I need to produce a single JSON..." 等思考文本也塞进 `content`，JSON 并非
 *   从首字符开始。此时先尝试严格解析；失败则扫最外层 `{...}` / `[...]` 切片后
 *   再尝试（含 jsonrepair 兜底）。不引入新 lint，语义和严格解析一致。
 *
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonFromModelText(text) {
  const trimmed = text.trim();
  const closed = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  let candidate = closed ? closed[1].trim() : trimmed;
  if (!closed && /^```(?:json)?/i.test(candidate)) {
    candidate = candidate.replace(/^```(?:json)?\s*/i, '').trim();
  }
  const tryParse = (s) => {
    try {
      return { ok: true, value: JSON.parse(s) };
    } catch (firstErr) {
      try {
        const repaired = jsonrepair(s);
        return { ok: true, value: JSON.parse(repaired) };
      } catch {
        return { ok: false, err: firstErr };
      }
    }
  };
  const first = tryParse(candidate);
  if (first.ok) return first.value;

  // 思考型模型：content 前有推理文本，JSON 不在首字符。截取最外层 {...} 或 [...]。
  const slice = extractOutermostJsonSlice(candidate);
  if (slice) {
    const second = tryParse(slice);
    if (second.ok) return second.value;
  }
  throw first.err;
}

/**
 * 扫描出字符串中最外层的 JSON 对象或数组切片（平衡 `{ }` / `[ ]`，并跳过字符串内
 * 的大括号）。仅返回第一个完整切片，失败返回空串。
 *
 * 用于 HOTFIX R：thinking 模型在 `content` 前附带推理文本的回退。
 *
 * @param {string} s
 * @returns {string}
 */
function extractOutermostJsonSlice(s) {
  if (typeof s !== 'string' || !s) return '';
  const len = s.length;
  let i = 0;
  while (i < len) {
    const c = s[i];
    if (c === '{' || c === '[') {
      const open = c;
      const close = open === '{' ? '}' : ']';
      let depth = 0;
      let inStr = false;
      let escape = false;
      for (let j = i; j < len; j += 1) {
        const ch = s[j];
        if (inStr) {
          if (escape) {
            escape = false;
          } else if (ch === '\\') {
            escape = true;
          } else if (ch === '"') {
            inStr = false;
          }
          continue;
        }
        if (ch === '"') {
          inStr = true;
          continue;
        }
        if (ch === open) depth += 1;
        else if (ch === close) {
          depth -= 1;
          if (depth === 0) return s.slice(i, j + 1);
        }
      }
      // 未平衡：继续向后找下一个可能起点
    }
    i += 1;
  }
  return '';
}
