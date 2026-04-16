/**
 * 万相 Wan 2.7 图生视频 HTTP 封装（DashScope 异步任务）
 * 供 `wan27-i2v-smoke.mjs`、`wan27-i2v-from-storyboard.mjs` 复用。
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

/** @typedef {"cn" | "intl"} DashscopeRegion */

/**
 * 根据地域返回「创建任务」与「查询任务」的根 URL
 * @param {DashscopeRegion} region
 */
export function endpointsForRegion(region) {
  const host =
    region === "intl"
      ? "dashscope-intl.aliyuncs.com"
      : "dashscope.aliyuncs.com";
  return {
    create: `https://${host}/api/v1/services/aigc/video-generation/video-synthesis`,
    task: (taskId) =>
      `https://${host}/api/v1/tasks/${encodeURIComponent(taskId)}`,
  };
}

/**
 * 从环境变量解析地域：DASHSCOPE_REGION=intl → 新加坡，其余视为北京
 * @returns {DashscopeRegion}
 */
export function regionFromEnv() {
  const r = (process.env.DASHSCOPE_REGION || "cn").toLowerCase();
  if (r === "intl" || r === "sg" || r === "singapore") return "intl";
  return "cn";
}

/**
 * 按扩展名推断 MIME，用于构造 data URL
 * @param {string} filePath
 */
export function mimeForPath(filePath) {
  const e = extname(filePath).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".bmp") return "image/bmp";
  return "image/jpeg";
}

/**
 * 读取本地文件为 data:image/...;base64,... 字符串
 * @param {string} filePath
 */
export async function localImageToDataUrl(filePath) {
  const buf = await readFile(filePath);
  const mime = mimeForPath(filePath);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * 发起图生视频任务（仅首帧）
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {DashscopeRegion} opts.region
 * @param {string} opts.firstFrameUrl
 * @param {string} opts.prompt
 * @param {string} [opts.resolution]
 * @param {number} [opts.duration]
 * @param {boolean} [opts.promptExtend]
 * @param {boolean} [opts.watermark]
 */
export async function createI2VTask(opts) {
  const { create } = endpointsForRegion(opts.region);
  const body = {
    model: "wan2.7-i2v",
    input: {
      prompt: opts.prompt,
      media: [{ type: "first_frame", url: opts.firstFrameUrl }],
    },
    parameters: {
      resolution: opts.resolution ?? "720P",
      duration: opts.duration ?? 5,
      prompt_extend: opts.promptExtend ?? true,
      watermark: opts.watermark ?? false,
    },
  };

  const res = await fetch(create, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`创建任务：非 JSON 响应 HTTP ${res.status}：${text.slice(0, 500)}`);
  }

  if (!res.ok) {
    const msg = json.message || json.code || text;
    throw new Error(`创建任务失败 HTTP ${res.status}: ${msg}`);
  }

  const taskId = json.output?.task_id;
  if (!taskId) {
    throw new Error(`创建任务未返回 task_id：${JSON.stringify(json)}`);
  }
  return { taskId, raw: json };
}

/**
 * 单次查询任务
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {DashscopeRegion} opts.region
 * @param {string} opts.taskId
 */
export async function getTask(opts) {
  const { task } = endpointsForRegion(opts.region);
  const url = task(opts.taskId);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`查询任务：非 JSON 响应 HTTP ${res.status}：${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const msg = json.message || json.code || text;
    throw new Error(`查询任务失败 HTTP ${res.status}: ${msg}`);
  }
  return json;
}

/**
 * 轮询直到终态
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {DashscopeRegion} opts.region
 * @param {string} opts.taskId
 * @param {number} [opts.intervalMs]
 * @param {number} [opts.maxWaitMs]
 */
export async function pollUntilDone(opts) {
  const intervalMs = opts.intervalMs ?? 5000;
  const maxWaitMs = opts.maxWaitMs ?? 15 * 60 * 1000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const data = await getTask({
      apiKey: opts.apiKey,
      region: opts.region,
      taskId: opts.taskId,
    });
    const status = data.output?.task_status;
    const videoUrl = data.output?.video_url;

    console.log(
      `[poll] ${new Date().toISOString()} task_status=${status ?? "?"}${videoUrl ? " video_url=..." : ""}`,
    );

    if (status === "SUCCEEDED") {
      return data;
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw new Error(
        `任务结束：${status}，详情：${JSON.stringify(data.output ?? data)}`,
      );
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`轮询超时（>${maxWaitMs}ms），task_id=${opts.taskId}`);
}
