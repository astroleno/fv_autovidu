/**
 * 万相 2.7：以本地参考图 `public/shoe1.png` + 四格分镜文案，生成 4 张竖幅 1080×1920 组图。
 *
 * 使用 `enable_sequential` + 单张参考图（图生组图 / 多图参考叙事），异步轮询后下载到
 * `output/wan27-shoe-4panel-runs/<时间戳>/`，**不会覆盖**历史目录 `output/wan27-shoe-4panel/`。
 *
 * 用法（仓库根目录）：
 *   npm run build && node --env-file=.env scripts/wan27-shoe-4panel.mjs
 */

import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Wan27Client,
  extractImageUrlsFromTaskResponse,
  loadDashscopeApiKeyFromEnv,
  resolveDashscopeBaseUrl,
} from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

/** 参考图：黑白帆布鞋商品图（与分镜中的 classic canvas sneakers 一致） */
const REF_IMAGE_PATH = join(REPO_ROOT, "public", "shoe1.png");

/** 竖幅 9:16，文档「方式二」为 宽*高 */
const SIZE = "1080*1920";

/**
 * 四格分镜合并为单条提示词（单轮 messages，模型按叙事拆成 n 张）。
 * 说明：格内标注「客厅」与画面英文（旧金山坡道街景）不一致时，以画面描述为准以保证连贯街景。
 * 追加「竖构图」段：减轻街景广角带来的「像横屏」观感（画布仍为 1080×1920）。
 */
const PROMPT = `Film storyboard vertical 9:16, exactly 4 sequential panels. Keep the same classic black-and-white canvas sneakers as the reference image (low-top, white toe cap, white laces, white side stitching). Same misty San Francisco street slope location across all panels. No subtitles, no text in frame.

【Vertical framing lock — must follow】Portrait / Stories / TikTok vertical format (taller-than-wide canvas). Full-bleed 9:16 composition: emphasize vertical depth (road receding uphill, lampposts, buildings along the vertical thirds), strong foreground-to-background layering on the Z-axis. Keep hero subject (sneakers / legs / hands) in the vertical center band; avoid ultra-wide cinematic letterbox or panoramic horizon that reads as landscape crop. Camera angles may be low or tracking but framing must stay clearly vertical-first; no rotated landscape plates.

格1: authentic low-angle shot on a misty San Francisco street slope, a pair of classic canvas sneakers walking firmly on the pavement, warm cinematic film tone, natural lighting, grain texture.

格2: same street slope scene, cut to next action state — static close-up, hands adjusting the laces of the canvas shoe, white contrast stitching and durable fabric texture, warm golden hour light.

格3: same scene continuity, cut to next action state — shoe fully laced and stepping forward (skip tying), sneaker moves into a stride on the inclined road, shaky cam.

格4: same scene continuity, cut to next action state — medium-wide tracking shot from behind as they ascend the slope, product centered, warm hazy vintage film aesthetic.`;

async function fileToDataUrlPng(absPath) {
  const buf = await readFile(absPath);
  const b64 = buf.toString("base64");
  return `data:image/png;base64,${b64}`;
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, buf);
}

/**
 * 生成本次运行目录名（本地时间），避免覆盖 `output/wan27-shoe-4panel/` 下旧文件。
 * 可通过环境变量 `WAN27_SHOE_RUN_ID` 指定固定子目录名。
 */
function resolveRunOutputDir() {
  const custom = process.env.WAN27_SHOE_RUN_ID?.trim();
  if (custom) {
    return join(REPO_ROOT, "output", "wan27-shoe-4panel-runs", custom);
  }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return join(REPO_ROOT, "output", "wan27-shoe-4panel-runs", stamp);
}

async function main() {
  const apiKey = loadDashscopeApiKeyFromEnv();
  const client = new Wan27Client({
    apiKey,
    baseUrl: resolveDashscopeBaseUrl(),
  });

  const dataUrl = await fileToDataUrlPng(REF_IMAGE_PATH);
  const content = [{ image: dataUrl }, { text: PROMPT }];

  const charCount = [...PROMPT].length;
  if (charCount > 5000) {
    console.error(`提示词过长（${charCount}），请删减。`);
    process.exit(1);
  }

  console.log(`参考图: ${REF_IMAGE_PATH}`);
  console.log(`提示词字符数: ${charCount}`);
  console.log(`尺寸 ${SIZE}，组图 n=4，异步提交…`);

  const body = Wan27Client.buildBody("wan2.7-image-pro", content, {
    enable_sequential: true,
    n: 4,
    size: SIZE,
    watermark: false,
    /** 显式传入；文档称组图/有参考图时可能不生效，仍便于请求可追溯 */
    thinking_mode: true,
  });

  const created = await client.createAsyncTask(body);
  const taskId = created.output?.task_id;
  console.log("创建任务:", JSON.stringify(created, null, 2));
  if (!taskId) {
    process.exit(1);
  }

  const done = await client.pollTaskUntilDone(taskId, {
    intervalMs: 3000,
    timeoutMs: 600_000,
  });

  const urls = extractImageUrlsFromTaskResponse(done);
  console.log(`生成 ${urls.length} 张，usage:`, JSON.stringify(done.usage ?? {}, null, 2));

  const outDir = resolveRunOutputDir();
  console.log(`输出目录（不覆盖旧版 wan27-shoe-4panel/）: ${outDir}`);

  for (let i = 0; i < urls.length; i++) {
    const fp = join(outDir, `shoe-panel-${String(i + 1).padStart(2, "0")}.png`);
    await downloadToFile(urls[i], fp);
    console.log("已保存:", fp);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
