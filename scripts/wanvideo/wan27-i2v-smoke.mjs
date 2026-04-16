#!/usr/bin/env node
/**
 * 万相 Wan 2.7 图生视频（wan2.7-i2v）最小冒烟脚本
 *
 * 依据：`reference/wanvideo2.7/万相2.7视频生成API协议.md`
 * 逻辑复用：`./lib/wan27-i2v-api.mjs`
 *
 * 从分镜表批量跑请用：`wan27-i2v-from-storyboard.mjs`（首帧=group_xx/Sxx.png + prompts_extracted.json）
 */

import {
  createI2VTask,
  localImageToDataUrl,
  pollUntilDone,
  regionFromEnv,
} from "./lib/wan27-i2v-api.mjs";

function getArg(argv, name, fallback = undefined) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  return argv[i + 1] ?? fallback;
}

function printHelp() {
  console.log(`
Wan 2.7 图生视频冒烟（wan2.7-i2v）

必填环境变量：DASHSCOPE_API_KEY

参数：
  --prompt "..."           运动/镜头描述（必填）
  --url <https://...>      首帧图像公网 URL（与 --image 二选一）
  --image <path>           本地首帧图像路径（与 --url 二选一）
  --resolution <720P|1080P>  默认 720P（费用更低，测试推荐）
  --duration <2-15>        秒，默认 5
  --watermark              添加「AI生成」水印
  --no-prompt-extend       关闭 prompt 智能改写
  --poll-ms <n>            轮询间隔毫秒，默认 5000
  --help

可选环境：DASHSCOPE_REGION=intl 使用新加坡 endpoint
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    console.error("请设置环境变量 DASHSCOPE_API_KEY（与项目 Wan 图像 API 相同）");
    process.exit(1);
  }

  const prompt = getArg(argv, "--prompt");
  if (!prompt) {
    console.error("缺少 --prompt");
    printHelp();
    process.exit(1);
  }

  const urlArg = getArg(argv, "--url");
  const imagePath = getArg(argv, "--image");
  if (!urlArg && !imagePath) {
    console.error("请指定 --url（公网图）或 --image（本地图）作为首帧");
    process.exit(1);
  }
  if (urlArg && imagePath) {
    console.error("--url 与 --image 请勿同时指定");
    process.exit(1);
  }

  /** @type {string} */
  let firstFrameUrl;
  if (urlArg) {
    firstFrameUrl = urlArg;
  } else {
    firstFrameUrl = await localImageToDataUrl(imagePath);
  }

  const resolution = getArg(argv, "--resolution") ?? "720P";
  const duration = Number(getArg(argv, "--duration") ?? "5");
  const watermark = argv.includes("--watermark");
  const promptExtend = !argv.includes("--no-prompt-extend");
  const pollMs = Number(getArg(argv, "--poll-ms") ?? "5000");

  const region = regionFromEnv();

  console.log(
    `[i2v] region=${region} resolution=${resolution} duration=${duration}s first_frame=${urlArg ? "url" : "local-data-url"}`,
  );

  const { taskId, raw } = await createI2VTask({
    apiKey,
    region,
    firstFrameUrl,
    prompt,
    resolution,
    duration,
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
  console.log("\n=== 完成 ===");
  console.log("video_url:", videoUrl);
  console.log("\n完整 output:", JSON.stringify(finalJson.output, null, 2));
}

main().catch((e) => {
  console.error("[error]", e.message || e);
  process.exit(1);
});
