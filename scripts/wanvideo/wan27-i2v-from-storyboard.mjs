#!/usr/bin/env node
/**
 * 从本仓库「分镜包」读取：真实首帧图 + 视频提示词 + 时长，调用 Wan 2.7 图生视频。
 *
 * 数据来源（与 `scripts/i2v/episode_prompt_test.py` 一致）：
 * - 首帧路径：`output/frames/{episode}/group_xx/Sxx.png`（按 group 字典序 + 每组内 S*.png 排序展开为 Shot 1…N）
 * - 文案与时长：`output/frames/{episode}/prompts_extracted.json`
 *   - `video_prompt`：视频运动描述
 *   - `time`：如 `0-4s` → 时长 4 秒（万相 API 要求整数秒 ∈ [2,15]）
 *
 * 用法：
 *   cd 项目根目录
 *   node --env-file=.env scripts/wanvideo/wan27-i2v-from-storyboard.mjs --shot 1
 *
 *   # 可选：指定分镜包目录名、分辨率、完成后下载到 output/wan_i2v/
 *   node --env-file=.env scripts/wanvideo/wan27-i2v-from-storyboard.mjs --shot 1 --resolution 720P --download
 *
 *   # 批量（串行，避免并发挤爆配额）：前 5 镜
 *   node --env-file=.env scripts/wanvideo/wan27-i2v-from-storyboard.mjs --shots 1-5 --download
 *
 *   # 下载到新子目录，不覆盖 output/wan_i2v/ 根目录里已有文件
 *   node --env-file=.env scripts/wanvideo/wan27-i2v-from-storyboard.mjs --shots 1-5 --download --out-dir output/wan_i2v/my_run_001
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createI2VTask,
  localImageToDataUrl,
  pollUntilDone,
  regionFromEnv,
} from "./lib/wan27-i2v-api.mjs";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 仓库根目录（scripts/wanvideo → ../../） */
const PROJECT_ROOT = resolve(__dirname, "../..");

/**
 * 与 `episode_prompt_test.get_shot_to_frame_mapping` 相同：
 * 按 group_01, group_02… 排序，每组内 S*.png 排序，展开为全局 Shot 序号。
 *
 * @param {import("node:fs").PathLike} framesDir 分镜包根目录，如 .../第2集_EP02_分镜包
 * @returns {Promise<Array<{ group: string, file: string, absPath: string }>>}
 */
async function buildShotToFrameMapping(framesDir) {
  const dir = resolve(String(framesDir));
  const entries = await readdir(dir, { withFileTypes: true });
  const groups = entries
    .filter((d) => d.isDirectory() && d.name.startsWith("group_"))
    .map((d) => d.name)
    .sort();

  /** @type {Array<{ group: string, file: string, absPath: string }>} */
  const mapping = [];
  for (const g of groups) {
    const gp = join(dir, g);
    const files = (await readdir(gp))
      .filter((f) => /^S\d+\.png$/i.test(f))
      .sort();
    for (const f of files) {
      mapping.push({
        group: g,
        file: f,
        absPath: join(gp, f),
      });
    }
  }
  return mapping;
}

/**
 * 解析 prompts_extracted 中的 `time` 字段，如 `0-4s`、`10-15s` → 时长（秒）
 * @param {string} timeStr
 * @returns {number}
 */
function durationFromTimeField(timeStr) {
  const m = String(timeStr).trim().match(/(\d+)\s*-\s*(\d+)\s*s?/i);
  if (!m) return 5;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  return Math.max(0, b - a);
}

/**
 * 万相 wan2.7-i2v duration 合法区间 [2, 15]
 * @param {number} sec
 */
function clampDuration(sec) {
  const n = Math.round(sec);
  if (Number.isNaN(n) || n < 2) return 2;
  if (n > 15) return 15;
  return n;
}

function getArg(argv, name, fallback = undefined) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  return argv[i + 1] ?? fallback;
}

/**
 * 解析待生成的分镜列表。
 * - `--shots 1-5`：闭区间
 * - `--shots 1,3,5`：枚举
 * - 未指定 `--shots` 时回退 `--shot`（默认 1）
 * @param {string[]} argv
 * @returns {number[]}
 */
function parseShotList(argv) {
  const shotsStr = getArg(argv, "--shots");
  if (shotsStr) {
    const s = shotsStr.trim();
    if (s.includes("-") && !s.includes(",")) {
      const parts = s.split("-").map((x) => parseInt(x.trim(), 10));
      if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error(`无效的 --shots 区间：${shotsStr}，示例：1-5`);
      }
      const lo = Math.min(parts[0], parts[1]);
      const hi = Math.max(parts[0], parts[1]);
      if (lo < 1) throw new Error("--shots 区间起始须 >= 1");
      return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    }
    const list = s
      .split(",")
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1);
    if (list.length === 0) throw new Error(`无效的 --shots 列表：${shotsStr}`);
    return list;
  }
  const single = Number(getArg(argv, "--shot") ?? "1");
  if (!Number.isFinite(single) || single < 1) {
    throw new Error("无效的 --shot");
  }
  return [single];
}

function printHelp() {
  console.log(`
从分镜包跑 Wan 2.7 图生视频（真实首帧 + video_prompt + 时长）

必填：环境变量 DASHSCOPE_API_KEY

参数：
  --episode <目录名>     默认：第2集_EP02_分镜包（位于 output/frames/ 下）
  --shot <n>             单个分镜序号 1-based（与 --shots 二选一，默认 1）
  --shots <范围或列表>  批量串行：如 1-5 或 1,2,4（优先于 --shot）
  --resolution 720P|1080P 默认 720P
  --watermark            水印
  --no-prompt-extend
  --poll-ms <n>          默认 8000
  --download             每个镜头成功后 curl 下载 MP4
  --out-dir <路径>       下载目录（相对项目根或绝对路径）；默认 output/wan_i2v，避免覆盖请换子目录
  --help
`);
}

/**
 * 解析下载目录：默认 output/wan_i2v；相对路径相对于项目根目录解析
 * @param {string[]} argv
 * @param {string} projectRoot
 */
function resolveDownloadDir(argv, projectRoot) {
  const raw = getArg(argv, "--out-dir");
  if (!raw || !String(raw).trim()) {
    return join(projectRoot, "output", "wan_i2v");
  }
  const p = String(raw).trim();
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) {
    return resolve(p);
  }
  return resolve(projectRoot, p);
}

/**
 * 使用 curl 下载视频（避免额外依赖）
 * @param {string} url
 * @param {string} outPath
 */
async function downloadVideo(url, outPath) {
  await execFileAsync("curl", ["-fsSL", "-o", outPath, url], {
    maxBuffer: 50 * 1024 * 1024,
  });
}

/**
 * 单个镜头：创建任务 → 轮询 → 可选下载
 * @param {object} ctx
 * @param {string} ctx.apiKey
 * @param {"cn"|"intl"} ctx.region
 * @param {string} ctx.episodeName
 * @param {number} ctx.shotNum
 * @param {{ shot: number, time: string, image_prompt: string, video_prompt: string }} ctx.row
 * @param {{ absPath: string }} ctx.frame
 * @param {string} ctx.resolution
 * @param {boolean} ctx.watermark
 * @param {boolean} ctx.promptExtend
 * @param {number} ctx.pollMs
 * @param {boolean} ctx.doDownload
 * @param {string} ctx.downloadDir --out-dir 解析后的绝对路径
 */
async function runOneShot(ctx) {
  const {
    apiKey,
    region,
    episodeName,
    shotNum,
    row,
    frame,
    resolution,
    watermark,
    promptExtend,
    pollMs,
    doDownload,
    downloadDir,
  } = ctx;

  const durationSec = clampDuration(durationFromTimeField(row.time));
  const videoPrompt = row.video_prompt?.trim() || row.image_prompt;

  console.log("\n========== shot", shotNum, "==========");
  console.log("[storyboard] episode=", episodeName);
  console.log("[storyboard] time_field=", row.time, "→ duration_s=", durationSec);
  console.log("[storyboard] first_frame=", frame.absPath);
  console.log(
    "[storyboard] video_prompt=",
    videoPrompt.slice(0, 120) + (videoPrompt.length > 120 ? "…" : ""),
  );

  const firstFrameUrl = await localImageToDataUrl(frame.absPath);

  const { taskId, raw } = await createI2VTask({
    apiKey,
    region,
    firstFrameUrl,
    prompt: videoPrompt,
    resolution,
    duration: durationSec,
    promptExtend,
    watermark,
  });

  console.log("[create] task_id=", taskId);
  console.log("[create] raw=", JSON.stringify(raw, null, 2));

  const finalJson = await pollUntilDone({
    apiKey,
    region,
    taskId,
    intervalMs: pollMs,
  });

  const videoUrl = finalJson.output?.video_url;
  console.log("\n=== shot", shotNum, "完成 ===");
  console.log("video_url:", videoUrl);

  if (doDownload && videoUrl) {
    const safeEp = episodeName.replace(/[^\w\u4e00-\u9fff_-]+/g, "_");
    const outDir = downloadDir;
    await mkdir(outDir, { recursive: true });
    const outFile = join(
      outDir,
      `wan27_${safeEp}_shot${String(shotNum).padStart(2, "0")}.mp4`,
    );
    console.log("[download] →", outFile);
    await downloadVideo(videoUrl, outFile);
    const st = await stat(outFile);
    console.log("[download] ok, bytes=", st.size);
  }

  return { shotNum, videoUrl, taskId };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    console.error("请设置 DASHSCOPE_API_KEY");
    process.exit(1);
  }

  /** @type {number[]} */
  let shotList;
  try {
    shotList = parseShotList(argv);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  const episodeName =
    getArg(argv, "--episode") ?? "第2集_EP02_分镜包";

  const promptsPath = join(
    PROJECT_ROOT,
    "output",
    "frames",
    episodeName,
    "prompts_extracted.json",
  );
  const framesRoot = join(PROJECT_ROOT, "output", "frames", episodeName);

  const promptsRaw = await readFile(promptsPath, "utf8");
  /** @type {Array<{ shot: number, time: string, image_prompt: string, video_prompt: string }>} */
  const promptsList = JSON.parse(promptsRaw);

  const mapping = await buildShotToFrameMapping(framesRoot);

  const resolution = getArg(argv, "--resolution") ?? "720P";
  const watermark = argv.includes("--watermark");
  const promptExtend = !argv.includes("--no-prompt-extend");
  const pollMs = Number(getArg(argv, "--poll-ms") ?? "8000");
  const doDownload = argv.includes("--download");
  const downloadDir = resolveDownloadDir(argv, PROJECT_ROOT);

  const region = regionFromEnv();

  console.log(
    "[batch] shots=",
    shotList.join(","),
    " total=",
    shotList.length,
    " region=",
    region,
    " download_dir=",
    doDownload ? downloadDir : "(no --download)",
  );

  /** @type {Array<{ shotNum: number, videoUrl: string | undefined, taskId: string }>} */
  const results = [];

  for (const shotNum of shotList) {
    const row = promptsList.find((p) => p.shot === shotNum);
    if (!row) {
      console.error(`prompts_extracted.json 中未找到 shot=${shotNum}，已中止批量`);
      process.exit(1);
    }

    const idx = shotNum - 1;
    if (idx < 0 || idx >= mapping.length) {
      console.error(
        `首帧映射越界：shot=${shotNum}，全包仅 ${mapping.length} 张分镜首帧，已中止批量`,
      );
      process.exit(1);
    }

    const frame = mapping[idx];
    const r = await runOneShot({
      apiKey,
      region,
      episodeName,
      shotNum,
      row,
      frame,
      resolution,
      watermark,
      promptExtend,
      pollMs,
      doDownload,
      downloadDir,
    });
    results.push(r);
  }

  console.log("\n=== 批量全部完成 ===");
  console.log(
    JSON.stringify(
      results.map((x) => ({ shot: x.shotNum, task_id: x.taskId, ok: Boolean(x.videoUrl) })),
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("[error]", e.message || e);
  process.exit(1);
});
