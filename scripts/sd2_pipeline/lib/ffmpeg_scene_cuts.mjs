/**
 * ffmpeg 场景切点检测与分段区间构建（供人工审片 + VLM 分段管线使用）。
 *
 * 设计要点：
 * - 使用 `select='gt(scene,TH)'` 输出 showinfo，解析 pts_time 作为切点候选
 * - 与 ffprobe 时长合并为 [start,end) 区间列表
 */

import { execFileSync, spawnSync } from 'child_process';

/**
 * @typedef {{ start: number, end: number, duration: number }} SegmentRange
 */

/**
 * 调用 ffprobe 读取视频时长（秒，浮点）。
 * @param {string} videoPath
 * @returns {number}
 */
export function probeVideoDurationSeconds(videoPath) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ],
    { encoding: 'utf8' },
  );
  const v = Number.parseFloat(String(out).trim());
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`[ffmpeg_scene_cuts] 无法解析视频时长: ${videoPath}`);
  }
  return v;
}

/**
 * 解析 ffmpeg showinfo 输出中的 pts_time 列表。
 * @param {string} mergedStderrStdout
 * @returns {number[]}
 */
export function parsePtsTimesFromShowinfo(mergedStderrStdout) {
  /** @type {number[]} */
  const times = [];
  const lines = mergedStderrStdout.split('\n');
  for (const line of lines) {
    const m = line.match(/pts_time:([0-9.]+)/);
    if (!m) {
      continue;
    }
    const t = Number.parseFloat(m[1]);
    if (Number.isFinite(t)) {
      times.push(t);
    }
  }
  return times;
}

/**
 * 去重、排序。
 * @param {number[]} times
 * @returns {number[]}
 */
export function normalizeCutTimes(times) {
  const sorted = [...times].sort((a, b) => a - b);
  /** @type {number[]} */
  const out = [];
  const eps = 1e-4;
  for (const t of sorted) {
    if (!Number.isFinite(t)) {
      continue;
    }
    if (out.length === 0 || Math.abs(t - out[out.length - 1]) > eps) {
      out.push(t);
    }
  }
  return out;
}

/**
 * 运行 ffmpeg scene filter，返回检测到的切点时间戳（秒）。
 * 说明：ffmpeg 将 showinfo 打在 stderr；用 `2>&1` 合并后解析。
 * @param {string} videoPath
 * @param {number} threshold 例如 0.15
 * @returns {number[]}
 */
export function detectSceneCutTimes(videoPath, threshold) {
  if (!(threshold > 0 && threshold < 1)) {
    throw new Error(`[ffmpeg_scene_cuts] threshold 应在 (0,1) 内: ${threshold}`);
  }
  const vf = `select='gt(scene,${threshold})',showinfo`;
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', videoPath, '-vf', vf, '-an', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  const merged = `${r.stdout || ''}\n${r.stderr || ''}`;
  const times = parsePtsTimesFromShowinfo(merged);
  return normalizeCutTimes(times);
}

/**
 * 将切点列表转为连续区间 [0, t0), [t0, t1), ... [t_{n-1}, duration)
 * @param {number[]} cutTimes
 * @param {number} duration
 * @returns {SegmentRange[]}
 */
export function cutTimesToSegments(cutTimes, duration) {
  if (!(duration > 0)) {
    throw new Error(`[ffmpeg_scene_cuts] duration 非法: ${duration}`);
  }
  const cuts = normalizeCutTimes(cutTimes).filter((t) => t > 0 && t < duration);
  /** @type {number[]} */
  const boundaries = [0, ...cuts, duration];
  /** @type {SegmentRange[]} */
  const segments = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const dur = end - start;
    if (dur <= 1e-6) {
      continue;
    }
    segments.push({ start, end, duration: dur });
  }
  return segments;
}
