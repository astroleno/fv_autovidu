/**
 * 解析 cuts_review_edited.csv，按 action 合并时间轴。
 *
 * 约定：
 * - keep：新起一段
 * - merge_prev：并入上一段（延长 end）
 * - drop：丢弃
 * - merge_next：本仓库 CSV 未使用；若出现则抛错提示
 *
 * 特殊：原 seg_id=23 且为独立 keep 段时，可在指定时间点再切一刀（见 apply 脚本）。
 */

/**
 * @typedef {{
 *   seg_id: number,
 *   start_s: number,
 *   end_s: number,
 *   action: string,
 *   notes: string,
 * }} CutsRow
 */

/**
 * @typedef {{
 *   start: number,
 *   end: number,
 *   merged_from_seg_ids: number[],
 * }} MergedSpan
 */

/**
 * 简单 CSV 行解析（支持双引号字段；本导出无内含逗号时也可工作）。
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
  /** @type {string[]} */
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * @param {string} text
 * @returns {CutsRow[]}
 */
export function parseCutsReviewCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('[cuts_review_merge] CSV 无数据行');
  }
  const header = parseCsvLine(lines[0]);
  const idx = {
    seg_id: header.indexOf('seg_id'),
    start_s: header.indexOf('start_s'),
    end_s: header.indexOf('end_s'),
    action: header.indexOf('action'),
    notes: header.indexOf('notes'),
  };
  if (idx.seg_id < 0 || idx.start_s < 0 || idx.end_s < 0 || idx.action < 0) {
    throw new Error('[cuts_review_merge] CSV 表头缺少 seg_id/start_s/end_s/action');
  }
  /** @type {CutsRow[]} */
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const segId = Number.parseInt(cols[idx.seg_id], 10);
    const start = Number.parseFloat(cols[idx.start_s]);
    const end = Number.parseFloat(cols[idx.end_s]);
    const action = (cols[idx.action] || 'keep').trim();
    const notes = idx.notes >= 0 ? (cols[idx.notes] || '').trim() : '';
    if (!Number.isFinite(segId) || !Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }
    rows.push({ seg_id: segId, start_s: start, end_s: end, action, notes });
  }
  return rows;
}

/**
 * @param {CutsRow[]} rows
 * @returns {MergedSpan[]}
 */
export function mergeRowsToSpans(rows) {
  /** @type {MergedSpan[]} */
  const spans = [];
  for (const r of rows) {
    const a = r.action.toLowerCase();
    if (a === 'drop') {
      continue;
    }
    if (a === 'merge_next') {
      throw new Error('[cuts_review_merge] 暂不支持 merge_next，请改用 merge_prev 或改 CSV');
    }
    if (a === 'merge_prev') {
      if (spans.length === 0) {
        throw new Error(`[cuts_review_merge] seg_id=${r.seg_id} 的 merge_prev 无上一条可合并`);
      }
      const last = spans[spans.length - 1];
      last.end = r.end_s;
      last.merged_from_seg_ids.push(r.seg_id);
      continue;
    }
    if (a === 'keep' || a === '') {
      spans.push({
        start: r.start_s,
        end: r.end_s,
        merged_from_seg_ids: [r.seg_id],
      });
      continue;
    }
    throw new Error(`[cuts_review_merge] 未知 action: ${r.action}`);
  }
  return spans;
}

/**
 * 若某段仅由原 seg_id=splitSourceId 组成且时长跨过 splitAt，则拆成两段。
 * @param {MergedSpan[]} spans
 * @param {number} splitSourceId 例如 23
 * @param {number} splitAt 秒
 * @returns {MergedSpan[]}
 */
export function splitSpanBySourceId(spans, splitSourceId, splitAt) {
  /** @type {MergedSpan[]} */
  const out = [];
  for (const s of spans) {
    const ids = s.merged_from_seg_ids;
    const only =
      ids.length === 1 && ids[0] === splitSourceId && s.start < splitAt && splitAt < s.end;
    if (!only) {
      out.push(s);
      continue;
    }
    out.push({
      start: s.start,
      end: splitAt,
      merged_from_seg_ids: [splitSourceId],
    });
    out.push({
      start: splitAt,
      end: s.end,
      merged_from_seg_ids: [splitSourceId],
    });
  }
  return out;
}
