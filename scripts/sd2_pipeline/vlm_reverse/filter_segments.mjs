/**
 * 读取 cuts_review_edited.csv，列出全部片段（不合并），写入 segments_manifest.json。
 *
 * 用法：
 *   node scripts/sd2_pipeline/vlm_reverse/filter_segments.mjs [segments目录] [csv路径] [输出manifest路径]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveRepoRootFromHere } from './lib/asset_registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} csvText
 * @returns {Record<string, string>[]}
 */
function parseCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return [];
  }
  const header = lines[0].split(',');
  /** @type {Record<string, string>[]} */
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    // 简单 CSV：notes 列可能含逗号——当前文件 notes 为空，按逗号切即可
    const parts = line.split(',');
    /** @type {Record<string, string>} */
    const row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j].trim()] = (parts[j] ?? '').trim();
    }
    rows.push(row);
  }
  return rows;
}

async function main() {
  const repoRoot = resolveRepoRootFromHere();
  const defaultSeg = path.join(
    repoRoot,
    'output/sd2/甲方脚本/cuts_review_0.15/segments',
  );
  const defaultCsv = path.join(
    repoRoot,
    'output/sd2/甲方脚本/cuts_review_0.15/cuts_review_edited.csv',
  );
  const defaultOut = path.join(
    repoRoot,
    'output/sd2/甲方脚本/cuts_review_0.15/vlm_reverse/segments_manifest.json',
  );

  const segmentsDir = path.resolve(process.argv[2] || defaultSeg);
  const csvPath = path.resolve(process.argv[3] || defaultCsv);
  const outPath = path.resolve(process.argv[4] || defaultOut);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV 不存在: ${csvPath}`);
  }
  if (!fs.existsSync(segmentsDir)) {
    throw new Error(`片段目录不存在: ${segmentsDir}`);
  }

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(csvText);

  /** @type {object[]} */
  const segments = [];
  for (const row of rows) {
    const videoFile = row.video_file || '';
    const vp = path.join(segmentsDir, videoFile);
    if (!fs.existsSync(vp)) {
      console.warn(`[filter_segments] 警告：缺少文件 ${videoFile}`);
    }
    segments.push({
      seg_id: Number(row.seg_id),
      start_s: Number(row.start_s),
      end_s: Number(row.end_s),
      duration_s: Number(row.duration_s),
      video_file: videoFile,
      first_frame: row.first_frame,
      last_frame: row.last_frame,
      action: row.action,
      notes: row.notes || '',
      video_path: vp,
    });
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    segments_dir: segmentsDir,
    csv_path: csvPath,
    total_segments: segments.length,
    segments,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[filter_segments] 写入 ${outPath}，共 ${segments.length} 条`);
}

main().catch((e) => {
  console.error('[filter_segments]', e.message || e);
  process.exit(1);
});
