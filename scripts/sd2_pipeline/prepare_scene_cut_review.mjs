#!/usr/bin/env node
/**
 * 场景切分审片包生成器：
 * - ffmpeg scene 检测（默认阈值 0.15）
 * - 每段导出：整段 mp4（-c copy，不二次压码率）、首/尾帧 PNG（母带时间戳抽取，避免 JPEG 编码与 copy 切片异常）
 * - 生成 cuts_review.csv + cuts_review.html（同屏表格 + 视频预览 + 资产侧栏）
 * - 资产列表引用 public/assets/生死边缘/assets_list.json（供 VLM 分段理解时对齐）
 *
 * 用法：
 *   node scripts/sd2_pipeline/prepare_scene_cut_review.mjs <视频路径> [输出目录]
 *
 * 环境：需已安装 ffmpeg/ffprobe，Node 18+。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

import {
  probeVideoDurationSeconds,
  detectSceneCutTimes,
  cutTimesToSegments,
} from './lib/ffmpeg_scene_cuts.mjs';
import { buildReviewHtml } from './lib/scene_cut_review_html.mjs';
import {
  rowsToCsv,
  readJsonFile,
  parseAssetManifest,
} from './lib/review_csv_write.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** 默认资产清单（生死边缘） */
const DEFAULT_ASSETS_JSON = path.join(
  REPO_ROOT,
  'public',
  'assets',
  '生死边缘',
  'assets_list.json',
);

/**
 * @typedef {{ assetName: string, assetDescription?: string }} AssetItem
 * @typedef {{ characters: AssetItem[], props: AssetItem[], scenes: AssetItem[], vfx: AssetItem[] }} AssetManifest
 */

/**
 * @param {string} p
 * @returns {void}
 */
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * @param {string} videoPath
 * @returns {void}
 */
function runFfmpegOrThrow(args) {
  const r = spawnSync('ffmpeg', args, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const err = `${r.stderr || ''}\n${r.stdout || ''}`;
    throw new Error(`[prepare_scene_cut_review] ffmpeg 失败: ${err.slice(0, 800)}`);
  }
}

/**
 * 从完整母带在绝对时间戳处抽一帧（比从 copy 切片再抽更稳，避免无关键帧导致空流）。
 * @param {string} sourceMp4
 * @param {number} tSeconds
 * @param {string} outJpg
 */
function extractFrameAt(sourceMp4, tSeconds, outPng) {
  const t = Math.max(0, tSeconds);
  runFfmpegOrThrow([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(t),
    '-i',
    sourceMp4,
    '-frames:v',
    '1',
    '-f',
    'image2',
    '-c:v',
    'png',
    '-compression_level',
    '6',
    outPng,
  ]);
}

/**
 * 尾帧：取区间结束前一帧（约 1/30s），避免越过切点。
 * @param {string} sourceMp4
 * @param {number} endExclusive
 * @param {string} outJpg
 */
function extractLastFrameNearEnd(sourceMp4, endExclusive, outJpg) {
  const t = Math.max(0, endExclusive - 1 / 30);
  extractFrameAt(sourceMp4, t, outJpg);
}

/**
 * 将区间切为独立 mp4（流复制，不重新编码）。
 * @param {string} input
 * @param {number} start
 * @param {number} end
 * @param {string} outMp4
 */
function cutSegmentCopy(input, start, end, outMp4) {
  runFfmpegOrThrow([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-ss',
    String(start),
    '-to',
    String(end),
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    outMp4,
  ]);
}

function main() {
  const argv = process.argv.slice(2);
  const videoArg = argv[0];
  if (!videoArg) {
    console.error(
      '用法: node scripts/sd2_pipeline/prepare_scene_cut_review.mjs <视频路径> [输出目录] [--threshold=0.15] [--assets=path/to/assets_list.json]',
    );
    process.exit(1);
  }

  let outDir = '';
  let threshold = 0.15;
  let assetsPath = DEFAULT_ASSETS_JSON;

  /** @type {string[]} */
  const positionals = [];
  for (const a of argv.slice(1)) {
    if (a.startsWith('--threshold=')) {
      threshold = Number.parseFloat(a.slice('--threshold='.length));
    } else if (a.startsWith('--assets=')) {
      const p = a.slice('--assets='.length);
      assetsPath = path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
    } else if (!a.startsWith('--')) {
      positionals.push(a);
    }
  }
  if (positionals[0]) {
    outDir = positionals[0];
  }

  const videoPath = path.isAbsolute(videoArg) ? videoArg : path.resolve(REPO_ROOT, videoArg);
  if (!fs.existsSync(videoPath)) {
    throw new Error(`视频不存在: ${videoPath}`);
  }

  const baseName = path.basename(videoPath, path.extname(videoPath));
  const outRoot =
    outDir && outDir.length > 0
      ? path.isAbsolute(outDir)
        ? outDir
        : path.resolve(REPO_ROOT, outDir)
      : path.join(path.dirname(videoPath), `cuts_review_${threshold}`);

  const segmentsDir = path.join(outRoot, 'segments');
  ensureDir(segmentsDir);

  console.log('[prepare_scene_cut_review] 视频:', videoPath);
  console.log('[prepare_scene_cut_review] 输出:', outRoot);
  console.log('[prepare_scene_cut_review] scene 阈值:', threshold);

  const duration = probeVideoDurationSeconds(videoPath);
  const cutTimes = detectSceneCutTimes(videoPath, threshold);
  const segments = cutTimesToSegments(cutTimes, duration);

  console.log('[prepare_scene_cut_review] 时长:', duration.toFixed(3), 's');
  console.log('[prepare_scene_cut_review] 切点数:', cutTimes.length, '→ 段数:', segments.length);

  /** @type {Record<string, string>[]} */
  const csvRows = [];
  /** @type {Record<string, unknown>[]} */
  const manifestSegs = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const id = i + 1;
    const pad = String(id).padStart(2, '0');
    const base = `seg_${pad}`;
    const mp4Name = `${base}.mp4`;
    const firstName = `${base}_first.png`;
    const lastName = `${base}_last.png`;

    const outMp4 = path.join(segmentsDir, mp4Name);
    const outFirst = path.join(segmentsDir, firstName);
    const outLast = path.join(segmentsDir, lastName);

    cutSegmentCopy(videoPath, seg.start, seg.end, outMp4);
    extractFrameAt(videoPath, seg.start, outFirst);
    extractLastFrameNearEnd(videoPath, seg.end, outLast);

    const startS = seg.start.toFixed(6);
    const endS = seg.end.toFixed(6);
    const durS = seg.duration.toFixed(6);

    const row = {
      seg_id: String(id),
      start_s: startS,
      end_s: endS,
      duration_s: durS,
      video_file: `segments/${mp4Name}`,
      first_frame: `segments/${firstName}`,
      last_frame: `segments/${lastName}`,
      action: 'keep',
      notes: '',
    };
    csvRows.push(row);

    manifestSegs.push({
      seg_id: id,
      start_s: startS,
      end_s: endS,
      duration_s: durS,
      video_file: mp4Name,
      first_frame: firstName,
      last_frame: lastName,
      video_rel: `segments/${mp4Name}`,
      first_frame_rel: `segments/${firstName}`,
      last_frame_rel: `segments/${lastName}`,
      action: 'keep',
      notes: '',
    });
  }

  let assetsManifest = parseAssetManifest({});
  if (fs.existsSync(assetsPath)) {
    const raw = readJsonFile(assetsPath);
    assetsManifest = parseAssetManifest(raw);
    console.log('[prepare_scene_cut_review] 资产列表:', assetsPath);
  } else {
    console.warn('[prepare_scene_cut_review] 未找到资产文件，侧栏为空:', assetsPath);
  }

  const manifest = {
    video: path.relative(REPO_ROOT, videoPath),
    video_abs: videoPath,
    threshold,
    duration_s: duration,
    cut_count: cutTimes.length,
    segment_count: segments.length,
    assets_path: path.relative(REPO_ROOT, assetsPath),
    segments: manifestSegs.map((s) => {
      const o = { ...s };
      return o;
    }),
  };

  fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const headers = [
    'seg_id',
    'start_s',
    'end_s',
    'duration_s',
    'video_file',
    'first_frame',
    'last_frame',
    'action',
    'notes',
  ];
  fs.writeFileSync(path.join(outRoot, 'cuts_review.csv'), rowsToCsv(csvRows, headers), 'utf8');

  const html = buildReviewHtml({
    title: `${baseName} · 场景切分审片 (${segments.length} 段, threshold=${threshold})`,
    segments: manifestSegs,
    assets: assetsManifest,
  });
  fs.writeFileSync(path.join(outRoot, 'cuts_review.html'), html, 'utf8');

  console.log('[prepare_scene_cut_review] 完成:');
  console.log('  ', path.join(outRoot, 'cuts_review.html'));
  console.log('  ', path.join(outRoot, 'cuts_review.csv'));
  console.log('  ', path.join(outRoot, 'manifest.json'));
}

try {
  main();
} catch (e) {
  console.error('[prepare_scene_cut_review] 失败:', e instanceof Error ? e.message : e);
  process.exit(1);
}
