/**
 * 审片时间轴热修复：在 mergeRowsToSpans 之后、导出前调整区间。
 *
 * 当前规则（与业务约定一致）：
 * - 若曾对原分镜 23 在 47.8s 做过二次切分，先合并回一段 [42.867,53.933]
 * - 21/22 在 **54.1s** 相接（21 到 54.1，22 从 54.1 到原 24 段末）
 * - 原「当前审片」里的第 24、25 段（时间约 55.667–56.233 与 56.233–58.433）合并为一段
 */

/**
 * @typedef {{
 *   start: number,
 *   end: number,
 *   merged_from_seg_ids: number[],
 * }} MergedSpan
 */

const EPS = 0.05;

/**
 * @param {number[]} ids
 */
function isOnly23(ids) {
  return ids.length === 1 && ids[0] === 23;
}

/**
 * 合并相邻两段「仅原 23」的 span（曾用 47.8 切过一刀的情况）。
 * @param {MergedSpan[]} spans
 * @returns {MergedSpan[]}
 */
function collapseDouble23(spans) {
  /** @type {MergedSpan[]} */
  const out = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const n = spans[i + 1];
    if (
      n &&
      isOnly23(s.merged_from_seg_ids) &&
      isOnly23(n.merged_from_seg_ids) &&
      Math.abs(s.end - n.start) < EPS
    ) {
      out.push({
        start: s.start,
        end: n.end,
        merged_from_seg_ids: [23],
      });
      i++;
      continue;
    }
    out.push({
      start: s.start,
      end: s.end,
      merged_from_seg_ids: [...s.merged_from_seg_ids],
    });
  }
  return out;
}

/**
 * @param {MergedSpan[]} spans
 * @param {{ split21_22_at: number }} opts
 * @returns {MergedSpan[]}
 */
export function reshapeSpans21To25(spans, opts) {
  const splitAt = opts.split21_22_at;
  if (!Number.isFinite(splitAt)) {
    throw new Error('[cuts_review_hotfix] split21_22_at 无效');
  }

  let s = collapseDouble23(spans);

  const i23 = s.findIndex(
    (x) =>
      isOnly23(x.merged_from_seg_ids) &&
      Math.abs(x.start - 42.866667) < 0.2 &&
      Math.abs(x.end - 53.933333) < 0.2,
  );
  if (i23 < 0) {
    throw new Error('[cuts_review_hotfix] 未找到原分镜 23 对应区间 [~42.87,~53.93]');
  }

  const i24 = s.findIndex(
    (x, j) =>
      j > i23 &&
      x.merged_from_seg_ids.length === 1 &&
      x.merged_from_seg_ids[0] === 24 &&
      Math.abs(x.start - 53.933333) < 0.2,
  );
  if (i24 < 0) {
    throw new Error('[cuts_review_hotfix] 未找到原分镜 24 段');
  }

  const i25a = s.findIndex(
    (x, j) =>
      j > i24 &&
      x.merged_from_seg_ids.length === 1 &&
      x.merged_from_seg_ids[0] === 25 &&
      Math.abs(x.start - 55.666667) < 0.2,
  );
  if (i25a < 0) {
    throw new Error('[cuts_review_hotfix] 未找到原分镜 25 段（短段）');
  }

  const i25b = s.findIndex(
    (x, j) =>
      j > i25a &&
      x.merged_from_seg_ids.includes(26) &&
      x.merged_from_seg_ids.includes(35),
  );
  if (i25b < 0) {
    throw new Error('[cuts_review_hotfix] 未找到原 26–35 合并段');
  }

  const span23 = s[i23];
  const span24 = s[i24];
  const span25a = s[i25a];
  const span25b = s[i25b];

  if (!(splitAt > span23.start + EPS && splitAt < span24.end - EPS)) {
    throw new Error(
      `[cuts_review_hotfix] split21_22_at=${splitAt} 须落在 (${span23.start}, ${span24.end}) 内`,
    );
  }

  const new21 = {
    start: span23.start,
    end: splitAt,
    merged_from_seg_ids: [23, 24],
  };
  const new22 = {
    start: splitAt,
    end: span24.end,
    merged_from_seg_ids: [24],
  };
  const mergedTailIds = [...span25a.merged_from_seg_ids, ...span25b.merged_from_seg_ids];
  const new23 = {
    start: span25a.start,
    end: span25b.end,
    merged_from_seg_ids: mergedTailIds,
  };

  /** @type {MergedSpan[]} */
  const out = [];
  for (let k = 0; k < s.length; k++) {
    if (k === i24 || k === i25a || k === i25b) {
      continue;
    }
    if (k === i23) {
      out.push(new21, new22, new23);
      continue;
    }
    out.push({
      start: s[k].start,
      end: s[k].end,
      merged_from_seg_ids: [...s[k].merged_from_seg_ids],
    });
  }
  return out;
}
