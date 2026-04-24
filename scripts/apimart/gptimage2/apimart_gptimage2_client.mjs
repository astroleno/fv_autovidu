/**
 * APIMart GPT-Image-2 官方：文生图提交 + 任务轮询 + 图片下载到本地。
 * - 提交：`reference/apimart/gptimage2.md`
 * - 任务查询：`reference/apimart/query.md`（GET `/v1/tasks/{task_id}`，建议带 `language`）
 */
import fs from 'fs';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';

const DEFAULT_BASE = 'https://api.apimart.ai/v1';
const SUBMIT_PATH = 'images/generations';

/**
 * 以 `baseUrl` 为目录基底拼接子路径。注意 `new URL('/x', 'https://host/v1')` 会**丢掉** `/v1`，
 * 子路径须无前置 `/` 且 base 以 `/` 结尾。
 * @param {string} baseUrl  例如 `https://api.apimart.ai/v1`
 * @param {string} pathSegment  例如 `images/generations` 或 `tasks/xxx`
 * @returns {URL}
 */
function v1Url(baseUrl, pathSegment) {
  const base = baseUrl.replace(/\/?$/, '/');
  const seg = pathSegment.startsWith('/') ? pathSegment.slice(1) : pathSegment;
  return new URL(seg, base);
}

/**
 * @typedef {object} GptImage2RequestOptions
 * @property {string} model
 * @property {string} prompt
 * @property {string} [size]  例如 `9:16`
 * @property {string} [resolution] `1k` | `2k` | `4k`
 * @property {string} [quality] `low` | `medium` | `high` | `auto`
 * @property {string} [outputFormat] `png` | `jpeg` | `webp`
 * @property {number} [n] 1-4
 */

/**
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {GptImage2RequestOptions} body
 * @returns {Promise<string>} task_id
 */
export async function submitImageGeneration(
  baseUrl,
  apiKey,
  body,
) {
  const url = v1Url(baseUrl, SUBMIT_PATH);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: body.model,
      prompt: body.prompt,
      size: body.size,
      resolution: body.resolution,
      quality: body.quality,
      output_format: body.outputFormat,
      n: body.n ?? 1,
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = /** @type {unknown} */ (JSON.parse(text));
  } catch {
    throw new Error(
      `提交响应非 JSON（HTTP ${res.status}）: ${text.slice(0, 200)}...`,
    );
  }
  if (!res.ok) {
    const msg =
      /** @type {{ error?: { message?: string } }} */ (json).error?.message ?? res.statusText;
    throw new Error(`提交失败 HTTP ${res.status}: ${msg}`);
  }
  const code = /** @type {{ code?: number }} */ (json).code;
  if (code !== 200) {
    throw new Error(`提交返回 code 非 200: ${JSON.stringify(json)}`);
  }
  const data = /** @type {{ data?: Array<{ task_id?: string }> }} */ (json).data;
  const taskId = data?.[0]?.task_id;
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw new Error(`无 task_id: ${JSON.stringify(json)}`);
  }
  return taskId;
}

/**
 * 与 `query.md` 一致：成功终态为 `completed`；`failed` / `cancelled` 为失败终态；
 * `pending` / `processing` 为排队与处理中。部分模型文档仍写 `submitted` / `in_progress`，
 * 凡非终态均继续轮询。
 * @param {string | undefined} status
 * @returns {'done_ok' | 'done_err' | 'poll'}
 */
function classifyTaskStatus(status) {
  if (status === 'completed') {
    return 'done_ok';
  }
  if (status === 'failed' || status === 'cancelled') {
    return 'done_err';
  }
  return 'poll';
}

/**
 * 轮询任务直到拿到图片 URL 或失败。实现对照 `reference/apimart/query.md`。
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} taskId
 * @param {object} [opt]
 * @param {number} [opt.firstDelayMs] 首次查询前等待
 * @param {number} [opt.pollIntervalMs]
 * @param {number} [opt.maxWaitMs]
 * @param {string} [opt.language]  查询串 `language`，如 `zh` / `en`（见 query.md，默认 `zh`）
 * @returns {Promise<string[]>} 图片 URL 列表
 */
export async function pollTaskUntilImageUrls(
  baseUrl,
  apiKey,
  taskId,
  opt = {},
) {
  const firstDelayMs = opt.firstDelayMs ?? 15_000;
  const pollIntervalMs = opt.pollIntervalMs ?? 4_000;
  const maxWaitMs = opt.maxWaitMs ?? 200_000;
  const language =
    opt.language ?? process.env.APIMART_TASK_LANGUAGE?.trim() ?? 'zh';
  const started = Date.now();
  await delay(firstDelayMs);
  for (;;) {
    if (Date.now() - started > maxWaitMs) {
      throw new Error(`轮询超时 ${maxWaitMs}ms，task_id=${taskId}`);
    }
    const pathSeg = `tasks/${encodeURIComponent(taskId)}`;
    const getUrl = v1Url(baseUrl, pathSeg);
    if (language) {
      getUrl.searchParams.set('language', language);
    }
    const res = await fetch(getUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const pollText = await res.text();
    let json;
    try {
      json = /** @type {unknown} */ (JSON.parse(pollText));
    } catch {
      throw new Error(
        `任务查询响应非 JSON（HTTP ${res.status}）: ${pollText.slice(0, 200)}...`,
      );
    }
    if (!res.ok) {
      const msg =
        /** @type {{ error?: { message?: string } }} */ (json).error?.message ?? res.statusText;
      throw new Error(`任务查询失败 HTTP ${res.status}: ${msg}`);
    }
    const code = /** @type {{ code?: number }} */ (json).code;
    if (code !== 200) {
      throw new Error(`任务查询 code 非 200: ${JSON.stringify(json)}`);
    }
    const d = /** @type {{
      data?: {
        status?: string;
        result?: { images?: Array<{ url?: string[] }> };
        error?: { code?: number; message?: string; type?: string };
      };
    }} */ (json).data;
    const status = d?.status;
    const kind = classifyTaskStatus(status);
    if (kind === 'done_err') {
      const inner = d?.error;
      const errMsg = inner
        ? `${inner.message ?? JSON.stringify(inner)} (code=${String(inner.code)}, type=${String(inner.type)})`
        : JSON.stringify(json);
      throw new Error(`任务终态为 ${String(status)}: ${errMsg}`);
    }
    if (kind === 'done_ok') {
      const urls = d?.result?.images?.[0]?.url;
      if (Array.isArray(urls) && urls.length > 0 && typeof urls[0] === 'string') {
        return urls;
      }
      throw new Error(`完成但无 URL: ${JSON.stringify(json)}`);
    }
    await delay(pollIntervalMs);
  }
}

/**
 * 将单张图下载到 `destPath`（父目录会创建）。
 * @param {string} imageUrl
 * @param {string} destPath
 * @returns {Promise<void>}
 */
export async function downloadImageToFile(imageUrl, destPath) {
  const res = await fetch(imageUrl, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`下载失败 HTTP ${res.status} ${imageUrl}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(destPath, buf);
}

export function resolveApimartBase() {
  return process.env.APIMART_BASE_URL?.trim() || DEFAULT_BASE;
}
