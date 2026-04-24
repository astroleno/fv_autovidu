#!/usr/bin/env node
/**
 * 读取 `public/assets/末日重生/prompt.md`，调用 APIMart `gpt-image-2-official`：
 * **默认只提交 1 次**，生成**单张**「5×5=25 宫格」竖屏分镜主图，参数 **4K + quality=high**，
 * 比例默认 **9:16**（`reference/apimart/gptimage2.md` 无 `9:1`；若传 `9:1` 会提示并按 **9:16** 提交），
 * 保存为 `public/assets/末日重生/images/grid_5x5_storyboard.png`。
 *
 * 仅当你需要「每条分镜单独一张图」时，加 `--per-shot`（会多次调用 API，费用高）。
 *
 * 用法:
 *   node scripts/apimart/gptimage2/generate_moshi_reborn.mjs
 *   node scripts/apimart/gptimage2/generate_moshi_reborn.mjs --size 9:16
 *   node scripts/apimart/gptimage2/generate_moshi_reborn.mjs --dry-run
 *   node scripts/apimart/gptimage2/generate_moshi_reborn.mjs --per-shot --from 21 --to 25
 *
 * 环境:
 *   APIMART_API_KEY   必填（默认从项目根 `.env` 注入）
 *   APIMART_BASE_URL  默认 https://api.apimart.ai/v1
 *   APIMART_TASK_LANGUAGE  任务轮询时 GET 查询参数 `language`（见 `reference/apimart/query.md`），默认 `zh`
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadEnvFromFile } from './env.mjs';
import { extractShotsFromPromptMarkdown } from './parse_prompt_md.mjs';
import {
  downloadImageToFile,
  pollTaskUntilImageUrls,
  resolveApimartBase,
  submitImageGeneration,
} from './apimart_gptimage2_client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const DEFAULT_PROMPT_MD = path.join(
  REPO_ROOT,
  'public',
  'assets',
  '末日重生',
  'prompt.md',
);
const DEFAULT_OUT_DIR = path.join(
  REPO_ROOT,
  'public',
  'assets',
  '末日重生',
  'images',
);
/** 单张 5×5 宫格图默认文件名 */
const DEFAULT_SINGLE_FILENAME = 'grid_5x5_storyboard.png';

const MODEL = 'gpt-image-2-official';
/** 与文档一致，4K 仅支持 16:9 / 9:16 / 2:1 / 1:2 / 21:9 / 9:21 等 */
const DEFAULT_SIZE = '9:16';
const RESOLUTION = '4k';
const QUALITY = 'high';
const OUTPUT_FORMAT = 'png';

/**
 * CLI 的 `--size`；`9:1` 在官方 13 种比例中不存在，按竖屏短剧惯例映射为 9:16 并打日志。
 * @param {string} raw
 * @returns {string}
 */
function normalizeImageSize(raw) {
  const s = raw.trim();
  if (s === '9:1' || s === '9：1') {
    console.warn(
      '提示: API 无 9:1 档位，已按 9:16 竖屏提交（4K+high 可用）。',
    );
    return '9:16';
  }
  return s;
}

/**
 * 单图模式：在用户的 prompt.md 全文前加「只出 1 张、25 格布局」的硬性说明，减少模型画成 25 张的歧义。
 * @param {string} fileContent prompt.md 原始全文
 * @returns {string} 供 API 的完整 prompt
 */
function buildSingleGridPrompt(fileContent) {
  const head = `【出图要求】只输出 1 张成品图、1 个文件。整张图为竖向画面，5 列×5 行共 25 个宫格，按阅读顺序为从左到右、再自上而下依次对应下方各条分镜（shot 与画面一一对应）。每格是独立小场景，格间可有细线分隔。电影级用光、叙事连贯。若格内需文字（招牌、合同等）须为清晰中文。以下为分镜与画面说明原文：\n\n`;
  const tail =
    '\n\n【再确认】合成为单张、非多张拼接文件；一图内包含全部 25 格。';
  return `${head}${fileContent.trim()}${tail}`;
}

/**
 * 逐格出图模式用：风格前缀
 */
const PER_SHOT_PREFIX =
  '竖屏电影分镜，超清细节，戏剧光效。若画面含招牌/文件/屏幕等文字须为清晰中文。';

/**
 * @param {string[]} argv
 * @returns {{
 *   dryRun: boolean
 *   perShot: boolean
 *   from?: number
 *   to?: number
 *   promptPath: string
 *   outDir: string
 *   singleFileName: string
 *   size: string
 * }}
 */
function parseArgs(argv) {
  let dryRun = false;
  let perShot = false;
  /** @type {number | undefined} */
  let from;
  /** @type {number | undefined} */
  let to;
  let promptPath = DEFAULT_PROMPT_MD;
  let outDir = DEFAULT_OUT_DIR;
  let singleFileName = DEFAULT_SINGLE_FILENAME;
  let size = DEFAULT_SIZE;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (a === '--size' && argv[i + 1]) {
      size = normalizeImageSize(String(argv[i + 1]));
      i += 1;
      continue;
    }
    if (a === '--per-shot') {
      perShot = true;
      continue;
    }
    if (a === '--from' && argv[i + 1]) {
      from = Number.parseInt(argv[i + 1], 10);
      i += 1;
      continue;
    }
    if (a === '--to' && argv[i + 1]) {
      to = Number.parseInt(argv[i + 1], 10);
      i += 1;
      continue;
    }
    if (a === '--prompt' && argv[i + 1]) {
      promptPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (a === '--out' && argv[i + 1]) {
      outDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (a === '--single-name' && argv[i + 1]) {
      singleFileName = argv[i + 1];
      i += 1;
      continue;
    }
  }
  return { dryRun, perShot, from, to, promptPath, outDir, singleFileName, size };
}

/**
 * 单图出图 + 写盘 + manifest
 * @param {string} fullPrompt
 * @param {string} destFile
 * @param {string} base
 * @param {string} apiKey
 * @param {string} imageSize 如 9:16
 * @param {string} [modeLabel]
 */
async function runOneGeneration(
  fullPrompt,
  destFile,
  base,
  apiKey,
  imageSize,
  modeLabel = '单张 5×5 宫格',
) {
  console.log(`→ 提交 [${modeLabel}]...`);
  const taskId = await submitImageGeneration(base, apiKey, {
    model: MODEL,
    prompt: fullPrompt,
    size: imageSize,
    resolution: RESOLUTION,
    quality: QUALITY,
    outputFormat: OUTPUT_FORMAT,
    n: 1,
  });
  const urls = await pollTaskUntilImageUrls(base, apiKey, taskId, {
    firstDelayMs: 15_000,
    pollIntervalMs: 4_000,
    maxWaitMs: 300_000,
  });
  const firstUrl = urls[0];
  if (typeof firstUrl !== 'string') {
    throw new Error('无图片 URL');
  }
  await downloadImageToFile(firstUrl, destFile);
  console.log(`  ✓ ${destFile}`);
  return { taskId, urls };
}

async function main() {
  const envFile = path.join(REPO_ROOT, '.env');
  loadEnvFromFile(envFile);

  const { dryRun, perShot, from, to, promptPath, outDir, singleFileName, size } =
    parseArgs(process.argv.slice(2));
  const apiKey = process.env.APIMART_API_KEY?.trim();
  if (!dryRun && (!apiKey || apiKey.length === 0)) {
    console.error('缺少 APIMART_API_KEY，请在 .env 中配置或 export。');
    process.exit(2);
  }

  if (!fs.existsSync(promptPath)) {
    console.error('找不到 prompt 文件:', promptPath);
    process.exit(2);
  }

  const raw = fs.readFileSync(promptPath, 'utf8');
  const base = resolveApimartBase();

  if (perShot) {
    const allShots = extractShotsFromPromptMarkdown(raw);
    if (allShots.length === 0) {
      console.error('未从 prompt 解析到任何 shot/img_prompt（--per-shot 需要）。');
      process.exit(2);
    }
    const shots = allShots.filter((s) => {
      if (from !== undefined && s.shot < from) {
        return false;
      }
      if (to !== undefined && s.shot > to) {
        return false;
      }
      return true;
    });
    console.log(
      `【逐格模式】分镜: ${shots.length} 次请求 | model=${MODEL} size=${size} resolution=${RESOLUTION} quality=${QUALITY} | 输出: ${outDir}`,
    );
    if (dryRun) {
      for (const s of shots) {
        console.log(
          `[dry-run] shot ${s.shot}: ${PER_SHOT_PREFIX} ${s.imgPrompt}`,
        );
      }
      return;
    }
    /** @type {Array<{ shot: number; file: string; taskId: string; urls: string[] }>} */
    const manifest = [];
    for (const s of shots) {
      const fullPrompt = `${PER_SHOT_PREFIX} ${s.imgPrompt}`;
      const ext = OUTPUT_FORMAT === 'jpeg' ? 'jpg' : OUTPUT_FORMAT;
      const dest = path.join(
        outDir,
        `shot_${String(s.shot).padStart(2, '0')}.${ext}`,
      );
      const { taskId, urls } = await runOneGeneration(
        fullPrompt,
        dest,
        base,
        apiKey,
        size,
        `逐格 shot ${s.shot}`,
      );
      manifest.push({
        shot: s.shot,
        file: path.relative(REPO_ROOT, dest),
        taskId,
        urls,
      });
    }
    const manifestPath = path.join(outDir, 'manifest.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          mode: 'per-shot',
          generatedAt: new Date().toISOString(),
          model: MODEL,
          size,
          resolution: RESOLUTION,
          quality: QUALITY,
          items: manifest,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log('manifest:', manifestPath);
    return;
  }

  const fullPrompt = buildSingleGridPrompt(raw);
  const destFile = path.join(outDir, singleFileName);
  console.log(
    `【单图 5×5 宫格】1 次请求 | model=${MODEL} size=${size} resolution=${RESOLUTION} quality=${QUALITY} | 输出: ${destFile}`,
  );
  if (dryRun) {
    console.log('--- full prompt 预览（开头 1200 字）---\n');
    console.log(fullPrompt.slice(0, 1200));
    console.log(
      `\n...（共 ${fullPrompt.length} 字，已截断；完整内容见上方文件）\n`,
    );
    return;
  }

  const { taskId, urls } = await runOneGeneration(
    fullPrompt,
    destFile,
    base,
    apiKey,
    size,
    '单张 5×5 宫格',
  );
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        mode: 'single_grid_5x5',
        generatedAt: new Date().toISOString(),
        model: MODEL,
        size,
        resolution: RESOLUTION,
        quality: QUALITY,
        outputFile: path.relative(REPO_ROOT, destFile),
        taskId,
        urls,
        promptSource: path.relative(REPO_ROOT, promptPath),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('manifest:', manifestPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
