/**
 * 汇总 batch 目录下原始 JSON，生成：
 * - segments_prompts.json
 * - scene_grouped_prompts.md
 * - review.html（本地打开即可浏览）
 *
 * 用法：
 *   node scripts/sd2_pipeline/vlm_reverse/aggregate_outputs.mjs [raw/batch/某模型目录]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveRepoRootFromHere } from './lib/asset_registry.mjs';
import { normalizeToSd2Markdown } from './lib/normalize_sd2_prompt.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} rawBatchDir
 * @returns {{ seg_id: number; file: string; parsed: object }[]}
 */
function loadAllParsed(rawBatchDir) {
  if (!fs.existsSync(rawBatchDir)) {
    throw new Error(`目录不存在: ${rawBatchDir}`);
  }
  const files = fs.readdirSync(rawBatchDir).filter((f) => f.endsWith('.json'));
  /** @type {{ seg_id: number; file: string; parsed: object }[]} */
  const rows = [];
  for (const f of files) {
    const full = path.join(rawBatchDir, f);
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const segId = data.meta?.seg_id;
    const parsed = data.parsed;
    if (typeof segId !== 'number' || !parsed || typeof parsed !== 'object') {
      continue;
    }
    /** @type {Record<string, unknown>} */
    const merged = { ...parsed, seg_id: segId };
    const vf = data.meta?.video_path
      ? path.basename(String(data.meta.video_path))
      : `seg_${String(segId).padStart(2, '0')}.mp4`;
    if (!merged.video_file) {
      merged.video_file = vf;
    }
    rows.push({ seg_id: segId, file: f, parsed: merged });
  }
  rows.sort((a, b) => a.seg_id - b.seg_id);
  return rows;
}

/**
 * @param {{ seg_id: number; parsed: object }[]} rows
 * @returns {string}
 */
function buildSceneGroupedMarkdown(rows) {
  /** @type {Map<string, number[]>} */
  const sceneToSegs = new Map();
  for (const r of rows) {
    /** @type {{ detected_assets?: { scene?: string | null } }} */
    const p = r.parsed;
    const sc =
      (p.detected_assets && p.detected_assets.scene) || '（场景未识别）';
    const key = String(sc);
    if (!sceneToSegs.has(key)) {
      sceneToSegs.set(key, []);
    }
    sceneToSegs.get(key).push(r.seg_id);
  }

  const lines = ['# 按场景聚合（连续片段 ID 列表）', ''];
  for (const [scene, ids] of sceneToSegs) {
    lines.push(`## ${scene}`);
    lines.push(`- 片段：${ids.join(', ')}`, '');
  }
  return lines.join('\n');
}

/**
 * @param {string} outDir
 * @param {string} relVideoBase  相对于 review.html 的视频路径前缀
 * @param {{ seg_id: number; parsed: object }[]} rows
 */
function writeReviewHtml(outDir, relVideoBase, rows) {
  // HTML 字符串转义：提升到函数作用域，供下方 html 模板复用
  /** @param {string} s */
  const esc = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const cards = rows
    .map((r) => {
      const norm = normalizeToSd2Markdown(
        /** @type {import('./lib/normalize_sd2_prompt.mjs').VlmSegmentJson} */ (
          r.parsed
        ),
        '',
      );
      const vid = path
        .join(relVideoBase, `seg_${String(r.seg_id).padStart(2, '0')}.mp4`)
        .replace(/\\/g, '/');
      return `<section class="card"><h2>seg_${String(r.seg_id).padStart(2, '0')}</h2>
<video controls src="${esc(vid)}" width="360"></video>
<pre class="prompt">${esc(norm.markdown)}</pre></section>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>片段提示词审阅</title>
<style>
*{box-sizing:border-box;}
body{font-family:system-ui,sans-serif;margin:16px;background:#0f1115;color:#e8eaed;}
h1{font-size:1.1rem;}
.card{border:1px solid #333;border-radius:8px;padding:12px;margin-bottom:16px;background:#16181d;}
video{max-width:100%;border-radius:6px;}
pre.prompt{white-space:pre-wrap;background:#0b0c10;padding:12px;border-radius:6px;font-size:12px;line-height:1.45;}
</style>
</head>
<body>
<h1>视频片段 · SD2 反推提示词</h1>
<p>视频路径相对于本 HTML：<code>${esc(relVideoBase)}</code></p>
${cards}
</body>
</html>`;
  fs.writeFileSync(path.join(outDir, 'review.html'), html, 'utf8');
}

async function main() {
  const repoRoot = resolveRepoRootFromHere();
  const defaultBatch = path.join(
    repoRoot,
    'output/sd2/甲方脚本/cuts_review_0.15/vlm_reverse/raw/batch',
  );
  const arg = process.argv[2];
  let rawBatchDir = arg ? path.resolve(arg) : defaultBatch;

  if (!fs.existsSync(rawBatchDir)) {
    const sub = fs
      .readdirSync(defaultBatch, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    if (sub.length === 1) {
      rawBatchDir = path.join(defaultBatch, sub[0].name);
    }
  }

  const rows = loadAllParsed(rawBatchDir);
  if (rows.length === 0) {
    throw new Error(`未找到可用的 batch JSON：${rawBatchDir}`);
  }

  const outDir = path.join(
    repoRoot,
    'output/sd2/甲方脚本/cuts_review_0.15/vlm_reverse',
  );
  fs.mkdirSync(outDir, { recursive: true });

  const jsonOut = {
    generated_at: new Date().toISOString(),
    source_raw_dir: rawBatchDir,
    segments: rows.map((r) => ({
      seg_id: r.seg_id,
      parsed: r.parsed,
    })),
  };
  fs.writeFileSync(
    path.join(outDir, 'segments_prompts.json'),
    JSON.stringify(jsonOut, null, 2),
    'utf8',
  );

  fs.writeFileSync(
    path.join(outDir, 'scene_grouped_prompts.md'),
    buildSceneGroupedMarkdown(rows),
    'utf8',
  );

  const relVideo = path.relative(outDir, path.join(repoRoot, 'output/sd2/甲方脚本/cuts_review_0.15/segments'));
  writeReviewHtml(outDir, relVideo.split(path.sep).join('/'), rows);

  console.log(`[aggregate] segments_prompts.json / scene_grouped_prompts.md / review.html → ${outDir}`);
}

main().catch((e) => {
  console.error('[aggregate]', e.message || e);
  process.exit(1);
});
