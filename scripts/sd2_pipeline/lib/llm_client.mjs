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

  let lastErr = /** @type {Error | null} */ (null);
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        ...(abortSignal ? { signal: abortSignal } : {}),
      });
      const rawText = await res.text();
      if (!res.ok) {
        throw new Error(`LLM HTTP ${res.status}: ${rawText.slice(0, 800)}`);
      }
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
 * 从模型输出中解析 JSON（兼容外层包裹 ```json 代码块）。
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
  try {
    return JSON.parse(candidate);
  } catch (firstErr) {
    /** LLM 常在长字符串（如 diagnosis.warning_msg）内夹入未转义的英文双引号，导致严格 JSON 失败；jsonrepair 做常见修补。 */
    try {
      const repaired = jsonrepair(candidate);
      return JSON.parse(repaired);
    } catch {
      throw firstErr;
    }
  }
}
