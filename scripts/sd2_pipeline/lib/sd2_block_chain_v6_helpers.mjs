/**
 * SD2 v6 · 块链调度公共助手（从 call_sd2_block_chain_v5.mjs 抽取 + v6 新增）。
 *
 * 与 v5 的关系：
 *   - 前半部分（AV-split / BGM 裸名 / shot_count / @图N drift / iron_rule）是
 *     call_sd2_block_chain_v5.mjs 的等价复刻，v6 对这些校验**完全不动**，直接沿用；
 *     不从 v5 source import 的理由：v5 里是 file-internal 函数（未 export），
 *     为避免修改 v5 stable code，这里复制一份（与 v5 行为严格一致）。
 *   - 后半部分是 v6 新增的硬门/软门函数：scriptChunk 消费校验、KVA 消费校验、
 *     info_delta 密度校验、对白保真校验、style_inference 三轴推导。
 *
 * 文件行数控制：
 *   - 本文件定位为"v6 调度工具箱"；所有一次性、短小的校验/格式化函数集中在此，
 *     让 call_sd2_block_chain_v6.mjs 维持在 ~400 行聚焦在调度主干。
 *
 * 契约源：
 *   - v5 侧：`prompt/1_SD2Workflow/docs/v5/07_v5-schema-冻结.md` §七·附
 *   - v6 侧：`prompt/1_SD2Workflow/docs/v6/07_v6-schema-冻结.md` §4 / §5
 *   - `prompt/1_SD2Workflow/docs/v6/02_v6-对白保真与beat硬锚.md`
 */

/**
 * @typedef {Object} RoutingWarning
 * @property {string}  code
 * @property {'warn'|'info'} severity
 * @property {string|null} block_id
 * @property {unknown} actual
 * @property {Record<string, unknown>} expected
 * @property {string}  message
 */

// ═══════════════════ Part A · 从 v5 搬运（行为不变） ═══════════════════

/**
 * 读取 block_index 中某 block_id 对应的一行（兼容 block_id / id 两种命名）。
 *
 * @param {unknown} editMap
 * @param {string} blockId
 * @returns {Record<string, unknown> | null}
 */
export function getBlockIndexRow(editMap, blockId) {
  if (!editMap || typeof editMap !== 'object') return null;
  const em = /** @type {Record<string, unknown>} */ (editMap);
  const appendix =
    em.appendix && typeof em.appendix === 'object'
      ? /** @type {Record<string, unknown>} */ (em.appendix)
      : null;
  const rows = appendix && Array.isArray(appendix.block_index) ? appendix.block_index : [];
  const hit = rows.find((x) => {
    if (!x || typeof x !== 'object') return false;
    const r = /** @type {Record<string, unknown>} */ (x);
    return r.block_id === blockId || r.id === blockId;
  });
  return hit && typeof hit === 'object' ? /** @type {Record<string, unknown>} */ (hit) : null;
}

/**
 * 两块是否必须串行：仅当 scene_run_id 相同且均非空时，后一块才依赖前一块 Director appendix。
 *
 * @param {unknown} prevRow
 * @param {unknown} curRow
 * @returns {boolean}
 */
export function adjacentBlocksRequireSerial(prevRow, curRow) {
  const pr =
    prevRow && typeof prevRow === 'object'
      ? String(/** @type {{ scene_run_id?: unknown }} */ (prevRow).scene_run_id ?? '').trim()
      : '';
  const cr =
    curRow && typeof curRow === 'object'
      ? String(/** @type {{ scene_run_id?: unknown }} */ (curRow).scene_run_id ?? '').trim()
      : '';
  if (!pr || !cr) return false;
  return pr === cr;
}

/**
 * AV-split 四段切正则（T11 H5 副校验 · 与 v5 一致）。
 *
 * @param {string} sd2Prompt
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function checkAvSplitFormat(sd2Prompt) {
  const labels = ['[FRAME]', '[DIALOG]', '[SFX]', '[BGM]'];
  /** @type {string[]} */
  const missing = [];
  let cursor = 0;
  for (const lab of labels) {
    const at = sd2Prompt.indexOf(lab, cursor);
    if (at < 0) {
      missing.push(lab);
      continue;
    }
    cursor = at + lab.length;
  }
  return { ok: missing.length === 0, missing };
}

/**
 * BGM 裸名正则（与 v5 一致，受控方向词：tension/release/suspense/bond/none）。
 *
 * @param {string} sd2Prompt
 * @returns {string[]}
 */
export function detectBgmNameLeak(sd2Prompt) {
  const bgmSegments = [...sd2Prompt.matchAll(/\[BGM\]([^\[]*)/g)].map((m) => m[1] || '');
  const forbiddenPatterns = [
    /钢琴|吉他|弦乐|交响|架子鼓|萨克斯|电子鼓|提琴/,
    /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
    /周杰伦|林俊杰|王菲|陈奕迅/,
  ];
  /** @type {string[]} */
  const hits = [];
  for (const seg of bgmSegments) {
    for (const pat of forbiddenPatterns) {
      const m = seg.match(pat);
      if (m) hits.push(m[0]);
    }
  }
  return hits;
}

/**
 * 从 Director appendix.shot_count_per_block 取本 block 的 shot_count（与 v5 一致）。
 *
 * @param {unknown} dirParsed
 * @param {string} blockId
 * @returns {number | null}
 */
export function extractShotCountFromDirector(dirParsed, blockId) {
  if (!dirParsed || typeof dirParsed !== 'object') return null;
  const obj = /** @type {Record<string, unknown>} */ (dirParsed);
  /** @type {unknown} */
  let list = null;
  if (obj.appendix && typeof obj.appendix === 'object') {
    const app = /** @type {Record<string, unknown>} */ (obj.appendix);
    if (Array.isArray(app.shot_count_per_block)) list = app.shot_count_per_block;
  }
  if (!list && Array.isArray(obj.shot_count_per_block)) list = obj.shot_count_per_block;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const it = /** @type {Record<string, unknown>} */ (item);
    const bid = typeof it.block_id === 'string' ? it.block_id : typeof it.id === 'string' ? it.id : '';
    if (bid === blockId) {
      const sc = typeof it.shot_count === 'number' ? it.shot_count : Number(it.shot_count);
      return Number.isFinite(sc) && sc > 0 ? sc : null;
    }
  }
  return null;
}

/**
 * @图N 标签后校验 + 修正（v5.0 HOTFIX · H4 的等价复刻）。
 *
 * 返回 `{ sd2Prompt, drifts }`：
 *   - sd2Prompt：替换 @图DROP* 后的新字符串；
 *   - drifts：被替换的越界编号列表。
 *
 * @param {string} sd2PromptOrig
 * @param {number} presentCount
 * @returns {{ sd2Prompt: string, drifts: number[] }}
 */
export function repairAssetTagDrift(sd2PromptOrig, presentCount) {
  /** @type {number[]} */
  const drifts = [];
  const sd2Prompt = sd2PromptOrig.replace(/@图(\d+)/g, (match, numStr) => {
    const num = parseInt(numStr, 10);
    if (!Number.isFinite(num) || num <= presentCount + 2) return match;
    drifts.push(num);
    return `@图DROP${num}`;
  });
  return { sd2Prompt, drifts };
}

// ═══════════════════ Part B · v6 新增硬门/软门 ═══════════════════

/**
 * v6 硬门 · segment_coverage_report 消费度校验（Director 输出层）。
 *
 * 来源：07_v6-schema-冻结.md §4.1；Director v6 appendix 应返回
 * `segment_coverage_report = { consumed_segments[], total_segments_in_covered_beats,
 *  consumed_count, coverage_ratio, missing_must_cover[] }`。
 *
 * 口径：
 *   - 字段缺失 / coverage_ratio < 0.90 → hard fail（v6 L2 硬门）
 *   - missing_must_cover[].length > 0 且每条无 deferred_to_block → hard fail
 *   - Stage 0 未提供 + scriptChunk = null 时 → skip（降级到 v5 行为）
 *
 * @param {unknown} dirAppendix        Director 输出的 appendix
 * @param {Record<string, unknown> | null} scriptChunk
 * @returns {{ status: 'pass'|'fail'|'skip', reason: string, coverage_ratio: number | null }}
 */
export function checkDirectorSegmentCoverageV6(dirAppendix, scriptChunk) {
  if (!scriptChunk) {
    return { status: 'skip', reason: 'scriptChunk_is_null', coverage_ratio: null };
  }
  if (!dirAppendix || typeof dirAppendix !== 'object') {
    return { status: 'fail', reason: 'appendix_missing', coverage_ratio: null };
  }
  const app = /** @type {Record<string, unknown>} */ (dirAppendix);
  const rep = app.segment_coverage_report;
  if (!rep || typeof rep !== 'object') {
    return { status: 'fail', reason: 'segment_coverage_report_missing', coverage_ratio: null };
  }
  const r = /** @type {Record<string, unknown>} */ (rep);
  const ratio = typeof r.coverage_ratio === 'number' ? r.coverage_ratio : null;
  if (ratio === null) {
    return { status: 'fail', reason: 'coverage_ratio_missing', coverage_ratio: null };
  }
  if (ratio < 0.9) {
    return { status: 'fail', reason: `coverage_ratio ${ratio.toFixed(2)} < 0.90`, coverage_ratio: ratio };
  }
  const missing = Array.isArray(r.missing_must_cover) ? r.missing_must_cover : [];
  for (const m of missing) {
    if (!m || typeof m !== 'object') continue;
    const mm = /** @type {Record<string, unknown>} */ (m);
    const deferred = typeof mm.deferred_to_block === 'string' ? mm.deferred_to_block : '';
    if (!deferred) {
      return {
        status: 'fail',
        reason: `missing_must_cover seg_id=${mm.seg_id ?? '(unknown)'} without deferred_to_block`,
        coverage_ratio: ratio,
      };
    }
  }
  return { status: 'pass', reason: 'ok', coverage_ratio: ratio };
}

/**
 * v6 硬门 · KVA 消费率校验（Director 输出层）。
 *
 * 来源：07_v6-schema-冻结.md §4.2；Director v6 应返回
 * `kva_consumption_report[]` + `kva_coverage_ratio`（P0 KVA 消费率）。
 *
 * 口径：
 *   - scriptChunk.key_visual_actions 为空 → skip（无 KVA 可消费）
 *   - kva_coverage_ratio < 1.0 且 scriptChunk 里存在 P0 KVA → hard fail
 *   - 缺 kva_consumption_report → soft warn（不阻塞）
 *   - 支持 `--skip-kva-hard` 降级：外部传 skipKvaHard=true 时，所有 fail 降级为 warn
 *
 * @param {unknown} dirAppendix
 * @param {Record<string, unknown> | null} scriptChunk
 * @param {boolean} skipKvaHard
 * @returns {{ status: 'pass'|'fail'|'warn'|'skip', reason: string, kva_ratio: number | null }}
 */
export function checkDirectorKvaCoverageV6(dirAppendix, scriptChunk, skipKvaHard) {
  if (!scriptChunk) {
    return { status: 'skip', reason: 'scriptChunk_is_null', kva_ratio: null };
  }
  const kvas = Array.isArray(scriptChunk.key_visual_actions) ? scriptChunk.key_visual_actions : [];
  if (kvas.length === 0) {
    return { status: 'skip', reason: 'no_kva_in_chunk', kva_ratio: null };
  }
  const hasP0 = kvas.some((k) => {
    if (!k || typeof k !== 'object') return false;
    return /** @type {Record<string, unknown>} */ (k).priority === 'P0';
  });

  if (!dirAppendix || typeof dirAppendix !== 'object') {
    return skipKvaHard
      ? { status: 'warn', reason: 'appendix_missing (soft · skipKvaHard)', kva_ratio: null }
      : { status: 'fail', reason: 'appendix_missing', kva_ratio: null };
  }
  const app = /** @type {Record<string, unknown>} */ (dirAppendix);
  const ratio = typeof app.kva_coverage_ratio === 'number' ? app.kva_coverage_ratio : null;
  const report = Array.isArray(app.kva_consumption_report) ? app.kva_consumption_report : null;

  if (ratio === null && !report) {
    return skipKvaHard
      ? { status: 'warn', reason: 'kva_report_missing (soft · skipKvaHard)', kva_ratio: null }
      : { status: 'fail', reason: 'kva_consumption_report + kva_coverage_ratio both missing', kva_ratio: null };
  }
  if (hasP0 && typeof ratio === 'number' && ratio < 1.0) {
    return skipKvaHard
      ? { status: 'warn', reason: `kva_coverage_ratio ${ratio.toFixed(2)} < 1.00 (soft · skipKvaHard)`, kva_ratio: ratio }
      : { status: 'fail', reason: `kva_coverage_ratio ${ratio.toFixed(2)} < 1.00 with P0 KVA present`, kva_ratio: ratio };
  }
  return { status: 'pass', reason: 'ok', kva_ratio: ratio };
}

/**
 * v6 硬门 · info_delta 密度校验（Director 输出层）。
 *
 * 来源：07_v6-schema-冻结.md §4.4；Director v6 应返回每 shot 的
 * `shot_meta[].info_delta ∈ {identity, motion, relation, prop, dialogue, setting, none}`。
 *
 * 口径：
 *   - none_ratio > infoDensityContract.max_none_ratio → fail
 *   - 连续 N 个 none（N > consecutive_none_limit）→ fail
 *   - shot_meta 缺失 → soft warn
 *   - Stage 0 未提供（contract 使用默认值）时仍执行检查，但阈值用默认（0.20 / 1）
 *
 * @param {unknown} dirAppendix
 * @param {{ max_none_ratio: number, consecutive_none_limit: number }} infoDensityContract
 * @returns {{ status: 'pass'|'fail'|'warn'|'skip', reason: string, none_ratio: number | null, consecutive_max: number }}
 */
export function checkDirectorInfoDensityV6(dirAppendix, infoDensityContract) {
  if (!dirAppendix || typeof dirAppendix !== 'object') {
    return { status: 'warn', reason: 'appendix_missing', none_ratio: null, consecutive_max: 0 };
  }
  const app = /** @type {Record<string, unknown>} */ (dirAppendix);
  const meta = Array.isArray(app.shot_meta) ? app.shot_meta : null;
  if (!meta || meta.length === 0) {
    return { status: 'warn', reason: 'shot_meta_missing_or_empty', none_ratio: null, consecutive_max: 0 };
  }

  let noneCount = 0;
  let consecutive = 0;
  let consecutiveMax = 0;
  for (const m of meta) {
    if (!m || typeof m !== 'object') continue;
    const d = /** @type {Record<string, unknown>} */ (m).info_delta;
    if (d === 'none') {
      noneCount += 1;
      consecutive += 1;
      if (consecutive > consecutiveMax) consecutiveMax = consecutive;
    } else {
      consecutive = 0;
    }
  }
  const ratio = meta.length > 0 ? noneCount / meta.length : 0;

  if (ratio > infoDensityContract.max_none_ratio) {
    return {
      status: 'fail',
      reason: `none_ratio ${ratio.toFixed(2)} > max ${infoDensityContract.max_none_ratio.toFixed(2)}`,
      none_ratio: ratio,
      consecutive_max: consecutiveMax,
    };
  }
  if (consecutiveMax > infoDensityContract.consecutive_none_limit) {
    return {
      status: 'fail',
      reason: `consecutive_none ${consecutiveMax} > limit ${infoDensityContract.consecutive_none_limit}`,
      none_ratio: ratio,
      consecutive_max: consecutiveMax,
    };
  }
  return { status: 'pass', reason: 'ok', none_ratio: ratio, consecutive_max: consecutiveMax };
}

/**
 * v6 硬门 · 对白保真（Prompter 输出层）。
 *
 * 来源：02_v6-对白保真与beat硬锚.md + 07_v6-schema-冻结.md §5.2。
 * 要求：scriptChunk.segments[].segment_type ∈ {dialogue, monologue, vo} 的 text 必须
 *       **原样**出现在 sd2_prompt 的某个 `[DIALOG]` 段；仅当该 segment 携带
 *       `author_hint.shortened_text` 时允许用压缩后的 shortened_text 原样替代。
 *
 * 实现策略（字符级 indexOf，避免 regex 转义问题）：
 *   - scriptChunk=null → skip
 *   - 所有 dialogue segments 的 text 必须能在 sd2_prompt 中找到其子串；
 *     存在 author_hint.shortened_text 时，`match_mode=shortened_by_author_hint` 也算通过。
 *   - 任一 segment 未命中 → fail（记录 seg_id）
 *
 * @param {string} sd2Prompt
 * @param {Record<string, unknown> | null} scriptChunk
 * @returns {{ status: 'pass'|'fail'|'skip', missing_seg_ids: string[] }}
 */
export function checkPrompterDialogueFidelityV6(sd2Prompt, scriptChunk) {
  if (!scriptChunk || !sd2Prompt) {
    return { status: 'skip', missing_seg_ids: [] };
  }
  const segs = Array.isArray(scriptChunk.segments) ? scriptChunk.segments : [];
  /** @type {string[]} */
  const missing = [];
  for (const s of segs) {
    if (!s || typeof s !== 'object') continue;
    const seg = /** @type {Record<string, unknown>} */ (s);
    const type = typeof seg.segment_type === 'string' ? seg.segment_type : '';
    if (type !== 'dialogue' && type !== 'monologue' && type !== 'vo') continue;
    const text = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (!text) continue;
    const sid = typeof seg.seg_id === 'string' ? seg.seg_id : '(unknown)';

    if (sd2Prompt.indexOf(text) >= 0) continue;

    // author_hint.shortened_text 兜底：允许原样替代
    const hint = seg.author_hint && typeof seg.author_hint === 'object'
      ? /** @type {Record<string, unknown>} */ (seg.author_hint)
      : null;
    const shortened = hint && typeof hint.shortened_text === 'string' ? hint.shortened_text.trim() : '';
    if (shortened && sd2Prompt.indexOf(shortened) >= 0) continue;

    missing.push(sid);
  }
  return { status: missing.length === 0 ? 'pass' : 'fail', missing_seg_ids: missing };
}
