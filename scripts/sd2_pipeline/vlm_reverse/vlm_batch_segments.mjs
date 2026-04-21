/**
 * 对 manifest 中全部片段批量调用 VLM（单模型），支持并发与断点跳过。
 *
 * 用法：
 *   node scripts/sd2_pipeline/vlm_reverse/vlm_batch_segments.mjs
 *
 * 环境变量：
 *   VLM_GEMINI_MODEL=gemini-3-flash-preview  必填
 *   VLM_CONCURRENCY=5                        默认 5
 *   VLM_SKIP_EXISTING=1                      若 raw 已存在则跳过（默认 1）
 *   VLM_FIRST_N=5                            只处理按 seg_id 排序后的前 N 条（与 VLM_SEG_IDS 二选一）
 *   VLM_SEG_IDS=1,2,3,4,5                    只处理指定 seg_id（优先于 VLM_FIRST_N）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnvFromDotenv } from '../lib/load_env.mjs';
import { resolveRepoRootFromHere } from './lib/asset_registry.mjs';
import { runPool } from './lib/concurrent_pool.mjs';
import { runSegmentVlm } from './lib/run_segment_vlm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnvFromDotenv(path.resolve(__dirname, '..', '..', '..'));

/**
 * @param {string} s
 * @returns {number[]}
 */
function parseSegIds(s) {
  return s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

async function main() {
  const model = process.env.VLM_GEMINI_MODEL || '';
  if (!model) {
    console.error('请设置 VLM_GEMINI_MODEL（例如 gemini-3-flash-preview）');
    process.exit(1);
  }
  const concurrency = parseInt(process.env.VLM_CONCURRENCY || '5', 10);
  const skipExisting = process.env.VLM_SKIP_EXISTING !== '0';

  const repoRoot = resolveRepoRootFromHere();
  const manifestPath = path.join(
    repoRoot,
    'output/sd2/甲方脚本/cuts_review_0.15/vlm_reverse/segments_manifest.json',
  );
  if (!fs.existsSync(manifestPath)) {
    console.error('请先运行 filter_segments.mjs');
    process.exit(1);
  }
  /** @type {{ segments: import('./lib/run_segment_vlm.mjs').SegmentRow[] }} */
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  /** @type {import('./lib/run_segment_vlm.mjs').SegmentRow[]} */
  let workSegments = [...manifest.segments].sort((a, b) => a.seg_id - b.seg_id);
  const idsEnv = process.env.VLM_SEG_IDS?.trim();
  if (idsEnv) {
    const allow = new Set(parseSegIds(idsEnv));
    workSegments = workSegments.filter((s) => allow.has(s.seg_id));
    console.log(`[batch] VLM_SEG_IDS 过滤 → ${workSegments.length} 条`);
  } else {
    const firstN = process.env.VLM_FIRST_N?.trim();
    if (firstN) {
      const n = parseInt(firstN, 10);
      if (n > 0) {
        workSegments = workSegments.slice(0, n);
        console.log(`[batch] VLM_FIRST_N=${n} → ${workSegments.length} 条`);
      }
    }
  }

  const outBase = path.join(
    repoRoot,
    'output/sd2/甲方脚本/cuts_review_0.15/vlm_reverse',
  );
  const safeModel = model.replace(/[^\w.-]+/g, '_');
  const rawDir = path.join(outBase, 'raw', 'batch', safeModel);
  const mdDir = path.join(outBase, 'normalized', 'batch', safeModel);

  /** @type {import('./lib/run_segment_vlm.mjs').SegmentRow[]} */
  const todo = [];
  for (const seg of workSegments) {
    if (!fs.existsSync(seg.video_path)) {
      console.warn(`[batch] 跳过（无视频文件）seg_id=${seg.seg_id} ${seg.video_path}`);
      continue;
    }
    const baseName = `seg_${String(seg.seg_id).padStart(2, '0')}__${safeModel}.json`;
    const rawPath = path.join(rawDir, baseName);
    if (skipExisting && fs.existsSync(rawPath)) {
      continue;
    }
    todo.push(seg);
  }

  console.log(
    `[batch] 模型=${model}，待跑 ${todo.length}/${workSegments.length}（筛选后），并发 ${concurrency}`,
  );

  const results = await runPool(todo, concurrency, async (seg) => {
    const r = await runSegmentVlm({
      repoRoot,
      segment: seg,
      model,
      rawDir,
      mdDir,
    });
    return { seg_id: seg.seg_id, r };
  });

  const failed = results.filter((x) => !x.r.ok);
  const summaryPath = path.join(outBase, `batch_summary_${safeModel}.json`);
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        model,
        at: new Date().toISOString(),
        total: results.length,
        failed: failed.map((f) => ({ seg_id: f.seg_id, error: f.r.error })),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`[batch] 摘要：${summaryPath}`);
  if (failed.length) {
    console.error(`[batch] 失败 ${failed.length} 条`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('[batch]', e.message || e);
  process.exit(1);
});
