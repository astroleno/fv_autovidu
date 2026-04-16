/**
 * 万相 Wan 2.7 多功能命令行：文生图、图像编辑、组图、交互式框选编辑。
 *
 * 依赖：先 `npm run build`，再运行本脚本（引用 `dist/`）。
 *
 * 用法摘要：
 *   DASHSCOPE_API_KEY=sk-xxx node scripts/wan27-cli.mjs help
 *   DASHSCOPE_API_KEY=sk-xxx node scripts/wan27-cli.mjs t2i --prompt "花店门面"
 *   DASHSCOPE_API_KEY=sk-xxx node scripts/wan27-cli.mjs edit --images "https://a.png,https://b.png" --text "把图2画到图1上"
 *   DASHSCOPE_API_KEY=sk-xxx node scripts/wan27-cli.mjs sequential --prompt "同一橘猫四季四张图..." --n 4
 *   DASHSCOPE_API_KEY=sk-xxx node scripts/wan27-cli.mjs interactive --images "u1,u2" --text "把图1物体放到图2框选区" --bbox-json '[[],[[100,100,200,200]]]'
 *
 * 环境变量：DASHSCOPE_API_KEY（必填）、DASHSCOPE_REGION、WAN27_MODEL、WAN27_SIZE 等可用 CLI 覆盖。
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  Wan27Client,
  extractImageUrlsFromSyncResponse,
  extractImageUrlsFromTaskResponse,
  loadDashscopeApiKeyFromEnv,
} from "../dist/index.js";

/** 根据扩展名推断 data URL 的 MIME（文档支持 jpeg/png/webp/bmp） */
function mimeForPath(filePath) {
  const e = extname(filePath).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".bmp") return "image/bmp";
  return "image/png";
}

/**
 * 将逗号分隔的「URL 或本地路径」转为 API 可用的 image 字段（URL 或 data:...;base64,...）
 */
async function resolveImageList(commaSeparated) {
  const parts = commaSeparated
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (/^https?:\/\//i.test(p)) {
      out.push({ image: p });
      continue;
    }
    if (p.startsWith("data:image/")) {
      out.push({ image: p });
      continue;
    }
    const buf = await readFile(p);
    const b64 = buf.toString("base64");
    const mime = mimeForPath(p);
    out.push({ image: `data:${mime};base64,${b64}` });
  }
  return out;
}

function getArg(argv, name, fallback = undefined) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  return argv[i + 1] ?? fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function printHelp() {
  console.log(`
Wan 2.7 CLI — 子命令：t2i | edit | sequential | interactive | help

全局可选参数：
  --model <wan2.7-image-pro|wan2.7-image>   默认环境变量 WAN27_MODEL 或 wan2.7-image-pro
  --size <1K|2K|4K|WxH>                    默认 WAN27_SIZE 或 2K
  --n <number>                             张数（影响计费，见官方定价）
  --async                                  走异步接口并轮询（默认同步）
  --watermark                              添加「AI生成」水印

t2i — 文生图
  --prompt "..."                           提示词（也可用环境变量 WAN27_PROMPT）

edit — 多图 + 文本编辑（图序与文档一致：按 content 数组顺序）
  --images "url1,url2 或 本地路径"         必填，逗号分隔
  --text "..."                             编辑指令

sequential — 组图（enable_sequential）
  --prompt "..."
  --n <1-12>                               组图最大张数

interactive — 交互式框选编辑
  --images "图1,图2,..."
  --text "..."
  --bbox-json '[[x1,y1,x2,y2],[]]'         每张图对应一组框；JSON 数组，长度须与图数一致

输出：打印完整 JSON；成功时列出提取的图片 URL（24 小时内请下载保存）。
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "help";

  if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp();
    return;
  }

  const apiKey = loadDashscopeApiKeyFromEnv();
  const client = new Wan27Client({ apiKey });

  const model =
    getArg(argv, "--model") ??
    process.env.WAN27_MODEL ??
    "wan2.7-image-pro";
  const size = getArg(argv, "--size") ?? process.env.WAN27_SIZE ?? "2K";
  const nRaw = getArg(argv, "--n");
  const n = nRaw !== undefined ? Number(nRaw) : undefined;
  const useAsync = hasFlag(argv, "--async");
  const watermark = hasFlag(argv, "--watermark");

  /** @type {import('../dist/index.js').Wan27Parameters} */
  const baseParams = {
    size,
    watermark,
    ...(Number.isFinite(n) ? { n } : {}),
  };

  let body;

  if (cmd === "t2i") {
    const prompt = getArg(argv, "--prompt") ?? process.env.WAN27_PROMPT;
    if (!prompt) {
      console.error("t2i 需要 --prompt 或 WAN27_PROMPT");
      process.exit(1);
    }
    body = Wan27Client.buildBody(
      model,
      [{ text: prompt }],
      {
        ...baseParams,
        thinking_mode:
          (process.env.WAN27_THINKING_MODE ?? "true").toLowerCase() !==
          "false",
      },
    );
  } else if (cmd === "edit") {
    const images = getArg(argv, "--images") ?? process.env.WAN27_IMAGES;
    const text = getArg(argv, "--text") ?? process.env.WAN27_TEXT;
    if (!images || !text) {
      console.error("edit 需要 --images 与 --text");
      process.exit(1);
    }
    const imgs = await resolveImageList(images);
    const content = [...imgs, { text }];
    body = Wan27Client.buildBody(model, content, {
      ...baseParams,
      thinking_mode: hasFlag(argv, "--thinking")
        ? true
        : (process.env.WAN27_THINKING_MODE ?? "true").toLowerCase() !==
          "false",
    });
  } else if (cmd === "sequential") {
    const prompt = getArg(argv, "--prompt") ?? process.env.WAN27_PROMPT;
    if (!prompt) {
      console.error("sequential 需要 --prompt");
      process.exit(1);
    }
    const nSeq = Number.isFinite(n) ? n : 4;
    body = Wan27Client.buildBody(
      model,
      [{ text: prompt }],
      {
        ...baseParams,
        enable_sequential: true,
        n: nSeq,
      },
    );
  } else if (cmd === "interactive") {
    const images = getArg(argv, "--images") ?? process.env.WAN27_IMAGES;
    const text = getArg(argv, "--text") ?? process.env.WAN27_TEXT;
    const bboxJson = getArg(argv, "--bbox-json") ?? process.env.WAN27_BBOX_JSON;
    if (!images || !text || !bboxJson) {
      console.error("interactive 需要 --images、--text、--bbox-json");
      process.exit(1);
    }
    let bbox_list;
    try {
      bbox_list = JSON.parse(bboxJson);
    } catch {
      console.error("--bbox-json 须为合法 JSON 数组");
      process.exit(1);
    }
    const imgs = await resolveImageList(images);
    const content = [...imgs, { text }];
    body = Wan27Client.buildBody(model, content, {
      ...baseParams,
      bbox_list,
    });
  } else {
    console.error(`未知子命令: ${cmd}`);
    printHelp();
    process.exit(1);
  }

  if (useAsync) {
    const created = await client.createAsyncTask(body);
    const taskId = created.output?.task_id;
    console.log(JSON.stringify(created, null, 2));
    if (!taskId) {
      process.exit(1);
    }
    const done = await client.pollTaskUntilDone(taskId);
    console.log(JSON.stringify(done, null, 2));
    const urls = extractImageUrlsFromTaskResponse(done);
    console.log("--- image urls ---");
    urls.forEach((u) => console.log(u));
  } else {
    const res = await client.generateSync(body);
    console.log(JSON.stringify(res, null, 2));
    const urls = extractImageUrlsFromSyncResponse(res);
    console.log("--- image urls ---");
    urls.forEach((u) => console.log(u));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
