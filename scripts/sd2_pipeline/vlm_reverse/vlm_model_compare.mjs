/**
 * A/B：对固定 3 个片段并发调用两种 Gemini 模型，输出对比报告。
 *
 * 用法：
 *   node scripts/sd2_pipeline/vlm_reverse/vlm_model_compare.mjs
 *
 * 环境变量：
 *   VLM_COMPARE_SEG_IDS=1,23,10   默认 1,23,10（需与 segments 目录中已有 mp4 对应；若仅导出 seg_01–53 勿选 55）
 *   VLM_MODEL_PRO=gemini-3-pro-preview
 *   VLM_MODEL_FLASH=gemini-3-flash-preview
 *   VLM_CONCURRENCY=6             默认 6（3 段 × 2 模型）
 *   VLM_COMPARE_ROUND=1           可选：多轮稳定性测试轮次（1/2/3...），输出到 compare_r{N}/
 *                                 未设置则走原行为，输出到 compare/
 *   VLM_COMPARE_ONLY_MODEL=flash  可选：仅跑其中一个模型（pro|flash|both），默认 both
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
function parseIdList(s) {
  return s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

async function main() {
  const repoRoot = resolveRepoRootFromHere();
  const manifestPath = path.join(
    repoRoot,
    'output/sd2/甲方脚本/cuts_review_0.15/vlm_reverse/segments_manifest.json',
  );
  if (!fs.existsSync(manifestPath)) {
    console.error('请先运行: node scripts/sd2_pipeline/vlm_reverse/filter_segments.mjs');
    process.exit(1);
  }
  /** @type {{ segments: { seg_id: number; video_path: string; video_file: string; duration_s: number; notes?: string }[] }} */
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const idEnv = process.env.VLM_COMPARE_SEG_IDS || '1,23,10';
  const ids = parseIdList(idEnv);
  const modelPro = process.env.VLM_MODEL_PRO || 'gemini-3-pro-preview';
  const modelFlash = process.env.VLM_MODEL_FLASH || 'gemini-3-flash-preview';
  const concurrency = parseInt(process.env.VLM_CONCURRENCY || '6', 10);

  const roundRaw = (process.env.VLM_COMPARE_ROUND || '').trim();
  const roundN = roundRaw ? parseInt(roundRaw, 10) : 0;
  const roundSuffix = Number.isInteger(roundN) && roundN > 0 ? `_r${roundN}` : '';

  const onlyModel = (process.env.VLM_COMPARE_ONLY_MODEL || 'both').toLowerCase();
  const useFlash = onlyModel === 'both' || onlyModel === 'flash';
  const usePro = onlyModel === 'both' || onlyModel === 'pro';
  if (!useFlash && !usePro) {
    throw new Error('VLM_COMPARE_ONLY_MODEL 必须是 both | pro | flash');
  }

  const outBase = path.join(
    repoRoot,
    'output/sd2/甲方脚本/cuts_review_0.15/vlm_reverse',
  );
  const rawDir = path.join(outBase, 'raw', `compare${roundSuffix}`);
  const mdDir = path.join(outBase, 'normalized', `compare${roundSuffix}`);

  /** @type {{ segment: import('./lib/run_segment_vlm.mjs').SegmentRow; model: string }[]} */
  const tasks = [];
  for (const id of ids) {
    const seg = manifest.segments.find((s) => s.seg_id === id);
    if (!seg) {
      console.warn(`[compare] 找不到 seg_id=${id}，跳过`);
      continue;
    }
    if (usePro) tasks.push({ segment: seg, model: modelPro });
    if (useFlash) tasks.push({ segment: seg, model: modelFlash });
  }

  if (tasks.length === 0) {
    throw new Error('没有可执行任务');
  }

  console.log(
    `[compare] 任务数 ${tasks.length}，并发 ${concurrency}，Pro=${usePro ? modelPro : '-'} Flash=${useFlash ? modelFlash : '-'}${roundSuffix ? `，轮次=${roundSuffix.slice(2)}` : ''}`,
  );

  const t0 = Date.now();
  const results = await runPool(tasks, concurrency, async (task) => {
    const r = await runSegmentVlm({
      repoRoot,
      segment: task.segment,
      model: task.model,
      rawDir,
      mdDir,
    });
    return { task, result: r };
  });

  const lines = [
    `# VLM 模型对比（视频反推提示词）${roundSuffix ? `· 轮次 ${roundSuffix.slice(2)}` : ''}`,
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 片段 ID：${ids.join(', ')}`,
    `- 输出目录：normalized/compare${roundSuffix}/`,
    '',
    '| seg_id | model | ok | elapsed_ms | error |',
    '|--------|-------|----|------------|-------|',
  ];

  for (const { task, result } of results) {
    const e = result.elapsedMs != null ? String(result.elapsedMs) : '';
    const err = result.error ? result.error.slice(0, 120).replace(/\|/g, '/') : '';
    lines.push(
      `| ${task.segment.seg_id} | ${task.model} | ${result.ok} | ${e} | ${err} |`,
    );
  }

  lines.push('', `总耗时（墙钟）：${Date.now() - t0} ms`, '');
  lines.push('## 人工评审建议', '');
  lines.push(
    `请打开 \`normalized/compare${roundSuffix}/\` 下同名 \`.md\`，对比两种模型在「资产命中 / 动作细节 / 运镜 / 画面文字」上的差异。`,
  );

  const reportPath = path.join(
    outBase,
    `model_compare_report${roundSuffix}.md`,
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`[compare] 报告：${reportPath}`);

  const failed = results.filter((x) => !x.result.ok);
  if (failed.length > 0) {
    console.error(`[compare] 失败 ${failed.length} 个任务`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('[compare]', e.message || e);
  process.exit(1);
});
