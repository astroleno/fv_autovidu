#!/usr/bin/env node
/**
 * 根据 cuts_review_edited.csv **原地**更新审片目录：
 * - 覆盖 `segments/seg_XX.mp4`、首尾帧 PNG（与 prepare 命名一致）
 * - 重写 `manifest.json`、`cuts_review.csv`（全 keep）、`cuts_review.html`（前台可直接刷新预览）
 *
 * 默认审片目录 = CSV 所在目录（例如 .../cuts_review_0.15/）。
 *
 * 用法：
 *   node scripts/sd2_pipeline/apply_cuts_review_edited.mjs \
 *     --csv=output/sd2/甲方脚本/cuts_review_0.15/cuts_review_edited.csv \
 *     --video=output/sd2/甲方脚本/视频.mp4
 *
 * 可选：
 *   --review-dir=...   覆盖默认（仍应含 segments/、cuts_review.html）
 *   --split21-22-at=54.1  默认：21 接到此时间、22 从此时间起；并合并原 24+25 时段（热修复）
 *   --no-hotfix        关闭热修复，改用旧逻辑 --split23-at=47.8 在原 23 内切一刀
 *   --split23-at=47.8  仅在与 --no-hotfix 同用时生效
 *   --no-split23       与 --no-hotfix 同用时跳过对原 23 的切分
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

import {
  parseCutsReviewCsv,
  mergeRowsToSpans,
  splitSpanBySourceId,
} from './lib/cuts_review_merge.mjs';
import { reshapeSpans21To25 } from './lib/cuts_review_hotfix.mjs';
import { buildReviewHtml } from './lib/scene_cut_review_html.mjs';
import {
  rowsToCsv,
  readJsonFile,
  parseAssetManifest,
} from './lib/review_csv_write.mjs';
import { probeVideoDurationSeconds } from './lib/ffmpeg_scene_cuts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_ASSETS_JSON = path.join(
  REPO_ROOT,
  'public',
  'assets',
  '生死边缘',
  'assets_list.json',
);

const DEFAULT_SPLIT_23_AT = 47.8;
const DEFAULT_SPLIT_21_22_AT = 54.1;

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  let csvPath = '';
  let videoPath = '';
  let reviewDir = '';
  let split23At = DEFAULT_SPLIT_23_AT;
  let noSplit23 = false;
  let noHotfix = false;
  let split21_22_at = DEFAULT_SPLIT_21_22_AT;

  for (const a of argv) {
    if (a.startsWith('--csv=')) {
      csvPath = a.slice('--csv='.length);
    } else if (a.startsWith('--video=')) {
      videoPath = a.slice('--video='.length);
    } else if (a.startsWith('--review-dir=')) {
      reviewDir = a.slice('--review-dir='.length);
    } else if (a.startsWith('--out=')) {
      reviewDir = a.slice('--out='.length);
    } else if (a.startsWith('--split23-at=')) {
      split23At = Number.parseFloat(a.slice('--split23-at='.length));
    } else if (a.startsWith('--split21-22-at=')) {
      split21_22_at = Number.parseFloat(a.slice('--split21-22-at='.length));
    } else if (a === '--no-split23') {
      noSplit23 = true;
    } else if (a === '--no-hotfix') {
      noHotfix = true;
    }
  }

  return { csvPath, videoPath, reviewDir, split23At, noSplit23, noHotfix, split21_22_at };
}

/**
 * @param {string} input
 * @param {number} start
 * @param {number} end
 * @param {string} outMp4
 * @param {boolean} reencode
 */
function ffmpegCut(input, start, end, outMp4, reencode) {
  if (reencode) {
    const r = spawnSync(
      'ffmpeg',
      [
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
        '-c:v',
        'libx264',
        '-crf',
        '18',
        '-preset',
        'fast',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outMp4,
      ],
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
    );
    if (r.status !== 0) {
      throw new Error(`ffmpeg 重编码失败: ${r.stderr || r.stdout}`);
    }
    return;
  }
  const r = spawnSync(
    'ffmpeg',
    [
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
    ],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg copy 失败: ${r.stderr || r.stdout}`);
  }
}

/**
 * @param {string} input
 * @param {number} t
 * @param {string} outPng
 */
function extractFramePng(input, t, outPng) {
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(Math.max(0, t)),
      '-i',
      input,
      '-frames:v',
      '1',
      '-f',
      'image2',
      '-c:v',
      'png',
      '-compression_level',
      '6',
      outPng,
    ],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    throw new Error(`抽帧失败: ${r.stderr || r.stdout}`);
  }
}

/**
 * @param {number[]} ids
 */
/**
 * 原分镜 2/13：copy 易坏；原分镜 37：对应审片 seg_27 曾出现无法播放，重编码修复。
 * @param {number[]} ids
 */
function spanNeedsReencode(ids) {
  return ids.some((id) => id === 2 || id === 13 || id === 37);
}

/**
 * 清空旧 seg_* 与历史 final_*，避免段数变少后残留文件误导预览。
 * @param {string} segmentsDir
 */
function clearOldSegmentFiles(segmentsDir) {
  if (!fs.existsSync(segmentsDir)) {
    return;
  }
  for (const name of fs.readdirSync(segmentsDir)) {
    if (
      /^seg_\d+\.mp4$/.test(name) ||
      /^seg_\d+_first\.png$/.test(name) ||
      /^seg_\d+_last\.png$/.test(name) ||
      /^final_\d+\.mp4$/.test(name) ||
      /^final_\d+_first\.png$/.test(name) ||
      /^final_\d+_last\.png$/.test(name)
    ) {
      fs.unlinkSync(path.join(segmentsDir, name));
    }
  }
}

function main() {
  const raw = parseArgs(process.argv.slice(2));
  let csvPath = raw.csvPath;
  let videoPath = raw.videoPath;
  let reviewDir = raw.reviewDir;

  if (!csvPath || !videoPath) {
    console.error(
      '用法: node apply_cuts_review_edited.mjs --csv=... --video=... [--review-dir=审片目录默认=csv同目录]',
    );
    process.exit(1);
  }

  csvPath = path.isAbsolute(csvPath) ? csvPath : path.resolve(REPO_ROOT, csvPath);
  videoPath = path.isAbsolute(videoPath) ? videoPath : path.resolve(REPO_ROOT, videoPath);

  if (!reviewDir) {
    reviewDir = path.dirname(csvPath);
  } else {
    reviewDir = path.isAbsolute(reviewDir) ? reviewDir : path.resolve(REPO_ROOT, reviewDir);
  }

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV 不存在: ${csvPath}`);
  }
  if (!fs.existsSync(videoPath)) {
    throw new Error(`视频不存在: ${videoPath}`);
  }

  const baseName = path.basename(videoPath, path.extname(videoPath));
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCutsReviewCsv(text);
  let spans = mergeRowsToSpans(rows);

  if (raw.noHotfix) {
    if (!raw.noSplit23 && Number.isFinite(raw.split23At)) {
      spans = splitSpanBySourceId(spans, 23, raw.split23At);
    }
  } else {
    spans = reshapeSpans21To25(spans, { split21_22_at: raw.split21_22_at });
  }

  const segmentsDir = path.join(reviewDir, 'segments');
  fs.mkdirSync(segmentsDir, { recursive: true });
  clearOldSegmentFiles(segmentsDir);

  const duration = probeVideoDurationSeconds(videoPath);

  /** @type {Record<string, string>[]} */
  const csvRows = [];
  /** @type {Record<string, unknown>[]} */
  const manifestSegs = [];

  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const id = i + 1;
    const pad = String(id).padStart(2, '0');
    const base = `seg_${pad}`;
    const mp4Name = `${base}.mp4`;
    const firstName = `${base}_first.png`;
    const lastName = `${base}_last.png`;

    const outMp4 = path.join(segmentsDir, mp4Name);
    const outFirst = path.join(segmentsDir, firstName);
    const outLast = path.join(segmentsDir, lastName);

    const reencode = spanNeedsReencode(s.merged_from_seg_ids);
    ffmpegCut(videoPath, s.start, s.end, outMp4, reencode);
    extractFramePng(videoPath, s.start, outFirst);
    extractFramePng(videoPath, Math.max(s.start, s.end - 1 / 30), outLast);

    const startS = s.start.toFixed(6);
    const endS = s.end.toFixed(6);
    const durS = (s.end - s.start).toFixed(6);

    csvRows.push({
      seg_id: String(id),
      start_s: startS,
      end_s: endS,
      duration_s: durS,
      video_file: `segments/${mp4Name}`,
      first_frame: `segments/${firstName}`,
      last_frame: `segments/${lastName}`,
      action: 'keep',
      notes: '',
    });

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
      merged_from_seg_ids: s.merged_from_seg_ids,
      reencoded: reencode,
    });
  }

  let assetsManifest = parseAssetManifest({});
  let assetsPath = DEFAULT_ASSETS_JSON;
  if (fs.existsSync(assetsPath)) {
    assetsManifest = parseAssetManifest(readJsonFile(assetsPath));
  }

  const manifest = {
    video: path.relative(REPO_ROOT, videoPath),
    video_abs: videoPath,
    applied_from_csv: path.relative(REPO_ROOT, csvPath),
    hotfix_21_22_merge2425: raw.noHotfix ? false : true,
    split21_22_at: raw.noHotfix ? null : raw.split21_22_at,
    split23_at_legacy: raw.noHotfix && !raw.noSplit23 ? raw.split23At : null,
    duration_s: duration,
    segment_count: spans.length,
    assets_path: path.relative(REPO_ROOT, assetsPath),
    segments: manifestSegs,
  };

  fs.writeFileSync(path.join(reviewDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

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
  fs.writeFileSync(path.join(reviewDir, 'cuts_review.csv'), rowsToCsv(csvRows, headers), 'utf8');

  const html = buildReviewHtml({
    title: `${baseName} · 已应用合并 (${spans.length} 段)`,
    segments: manifestSegs,
    assets: assetsManifest,
  });
  fs.writeFileSync(path.join(reviewDir, 'cuts_review.html'), html, 'utf8');

  console.log('[apply_cuts_review_edited] 已原地更新审片目录:', reviewDir);
  console.log('  段数:', spans.length);
  console.log(
    '  重编码（原分镜 2 / 13 / 37）:',
    manifestSegs.filter((p) => p.reencoded).length,
  );
  if (!raw.noHotfix) {
    console.log('  21/22 切点:', raw.split21_22_at, 's（热修复 + 合并 24+25）');
  } else if (!raw.noSplit23) {
    console.log('  原 23 内切分（旧）:', raw.split23At, 's');
  }
  console.log('  请刷新打开: cuts_review.html');
}

try {
  main();
} catch (e) {
  console.error('[apply_cuts_review_edited] 失败:', e instanceof Error ? e.message : e);
  process.exit(1);
}
