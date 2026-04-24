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

  // HOTFIX S · Bug C1 · 合法 deferred 必须先从分母剔除再比阈值。
  //   原实现先判 ratio<0.9 直接 fail，把"合法跨 block 延迟"误伤为假阳性（B14 实锤：
  //   SEG_057 defer 到 B15，ratio=0.75 导致 fail）。
  //   修复策略：
  //     1. missing_must_cover 中每条必须带 deferred_to_block（非空串）→ 合法 defer；
  //        有任一条无 deferred → 直接 fail（不进重算）。
  //     2. 若全部 missing 均合法 defer → effective_ratio = consumed / (total - deferred)
  //        再按 0.9 阈值比对。
  //     3. 对外仍透出 LLM 原填的 coverage_ratio（便于审计审阅原值），
  //        但 pass/fail 判定用 effective_ratio。
  const missing = Array.isArray(r.missing_must_cover) ? r.missing_must_cover : [];
  const deferredLegal = [];
  for (const m of missing) {
    if (!m || typeof m !== 'object') continue;
    const mm = /** @type {Record<string, unknown>} */ (m);
    const deferred = typeof mm.deferred_to_block === 'string' ? mm.deferred_to_block.trim() : '';
    if (!deferred) {
      return {
        status: 'fail',
        reason: `missing_must_cover seg_id=${mm.seg_id ?? '(unknown)'} without deferred_to_block`,
        coverage_ratio: ratio,
      };
    }
    deferredLegal.push(mm);
  }

  const total = typeof r.total_segments_in_covered_beats === 'number' ? r.total_segments_in_covered_beats : null;
  const consumed = typeof r.consumed_count === 'number' ? r.consumed_count : null;

  if (total !== null && consumed !== null) {
    const denom = Math.max(1, total - deferredLegal.length);
    const effective = consumed / denom;
    if (effective < 0.9) {
      return {
        status: 'fail',
        reason: `effective_ratio ${effective.toFixed(2)} < 0.90 (consumed=${consumed}, denom=${denom}, raw_ratio=${ratio.toFixed(2)})`,
        coverage_ratio: ratio,
      };
    }
    return { status: 'pass', reason: 'ok', coverage_ratio: ratio };
  }

  // total / consumed 字段缺失时退回原阈值判断（此时 missing 已全部合法 deferred）
  if (ratio < 0.9) {
    return { status: 'fail', reason: `coverage_ratio ${ratio.toFixed(2)} < 0.90`, coverage_ratio: ratio };
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
  // chunk 侧的 P0 KVA 集合（用于下面重算 effective_ratio 时识别分子/分母归属）。
  const p0KvaIds = new Set(
    kvas
      .filter((k) => k && typeof k === 'object' && /** @type {Record<string, unknown>} */ (k).priority === 'P0')
      .map((k) => /** @type {Record<string, unknown>} */ (k).kva_id)
      .filter((v) => typeof v === 'string'),
  );
  const hasP0 = p0KvaIds.size > 0;

  if (!dirAppendix || typeof dirAppendix !== 'object') {
    return skipKvaHard
      ? { status: 'warn', reason: 'appendix_missing (soft · skipKvaHard)', kva_ratio: null }
      : { status: 'fail', reason: 'appendix_missing', kva_ratio: null };
  }
  const app = /** @type {Record<string, unknown>} */ (dirAppendix);
  const rawRatio = typeof app.kva_coverage_ratio === 'number' ? app.kva_coverage_ratio : null;
  const report = Array.isArray(app.kva_consumption_report) ? app.kva_consumption_report : null;

  if (rawRatio === null && !report) {
    return skipKvaHard
      ? { status: 'warn', reason: 'kva_report_missing (soft · skipKvaHard)', kva_ratio: null }
      : { status: 'fail', reason: 'kva_consumption_report + kva_coverage_ratio both missing', kva_ratio: null };
  }

  // HOTFIX S · Bug C2 · LLM 手填 kva_coverage_ratio 经常与 kva_consumption_report 不一致：
  //   - B08 实锤：LLM 写 0，但 report 里实际全部 consumed_at_shot 非 null → 应该 1.0；
  //   - 反例：LLM 可能虚报 1 但 report 里实际只消费一半 → 不能放水。
  //   真相源：结构化数组 > 单一数值。report 内部的 consumed_at_shot / deferred_to_block
  //   比顶层 ratio 数值更难一致性撒谎。
  //   修复策略：
  //     1. 根据 report 重算 effective_ratio = consumed_p0 / max(1, total_p0 - deferred_p0)；
  //     2. 若与 rawRatio 偏差 < 0.1（包括 report 为空或 P0 集合为空），沿用 rawRatio；
  //     3. 若偏差 ≥ 0.1，以重算值为权威，detail 标记 recomputed=true。
  //   Director 侧的裁决可能偏严（LLM 漏登记就 fail）；真正的最终裁决需要等
  //   Prompter 产物到齐后调用 reconcileKvaWithPrompterV6 做二次合并。
  let effective = rawRatio;
  let recomputed = false;
  if (report && hasP0) {
    const summary = summarizeKvaEvidenceV6(p0KvaIds, report, null);
    const recalc = summary.ratio;
    if (rawRatio === null || Math.abs(recalc - rawRatio) >= 0.1) {
      effective = recalc;
      recomputed = true;
    }
  }

  if (hasP0 && typeof effective === 'number' && effective < 1.0) {
    const note = recomputed ? ` (recomputed from report; llm_filled=${rawRatio})` : '';
    return skipKvaHard
      ? { status: 'warn', reason: `kva_coverage_ratio ${effective.toFixed(2)} < 1.00 (soft · skipKvaHard)${note}`, kva_ratio: effective }
      : { status: 'fail', reason: `kva_coverage_ratio ${effective.toFixed(2)} < 1.00 with P0 KVA present${note}`, kva_ratio: effective };
  }
  return { status: 'pass', reason: 'ok', kva_ratio: effective };
}

/**
 * HOTFIX S.1 · consumed_at_shot 值形态兼容判定。
 *
 * 背景：LLM 回填 `kva_consumption_report[*].consumed_at_shot` 的数据形态不稳定，
 * 至少见到三种：
 *   - `number`        —— 单 shot 消费（如 `3`），最常见；
 *   - `number[]`      —— 多 shot 连续消费（B03 实锤：`[1, 2]` 表示同一 KVA 横跨 shot1-2）；
 *   - `null / undef`  —— 本 block 未消费。
 *
 * 原 Fix C2 只认 `typeof === 'number'`，会把数组形态误判成未消费 → 新假阳性。
 * 口径：**只要存在至少一个有限数字**，就算已消费。
 *
 * @param {unknown} v
 * @returns {boolean}
 */
export function isKvaConsumedShotValue(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return true;
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x === 'number' && Number.isFinite(x)) return true;
    }
  }
  return false;
}

/**
 * HOTFIX S.1 · 合并 Director 账本与 Prompter 可视化自检，重算 P0 KVA 消费证据。
 *
 * 合并口径（两侧证据取并，"有任一 positive 证据即算 consumed"）：
 *   - Director.kva_consumption_report[].consumed_at_shot 存在 → consumed
 *   - Prompter.kva_visualization_check[].pass === true       → consumed
 *   - Director.kva_consumption_report[].deferred_to_block 非空 **且** Prompter 侧
 *     对同 KVA 无 pass 证据 → 合法 deferred（从分母剔除）
 *   - 否则 → 未消费（计入分母分子差）
 *
 * 注意：
 *   - 只计 scriptChunk 里 priority=P0 的 KVA；P1/P2 不参与硬门；
 *   - Prompter 的 pass=true 会**覆盖** Director 的 deferred 意图
 *     （Prompter 是实际生成者，它画了就是画了，Director 想 defer 也晚了）；
 *   - 分母下限 1，避免 0-除；全部合法 deferred 时分母=1、分子=0 → ratio=0
 *     由上层决定是否 fail（通常 skip，因为并无 P0 负担）。
 *
 * @param {Set<string>} p0KvaIds
 * @param {unknown[] | null} directorReport  `kva_consumption_report`
 * @param {unknown[] | null} prompterCheck   `kva_visualization_check`
 * @returns {{
 *   total: number,
 *   consumed: number,
 *   deferred: number,
 *   ratio: number,
 *   evidence: Record<string, { consumed: boolean, deferred: boolean, source: string[] }>
 * }}
 */
export function summarizeKvaEvidenceV6(p0KvaIds, directorReport, prompterCheck) {
  /** @type {Record<string, { consumed: boolean, deferred: boolean, source: string[] }>} */
  const evidence = {};
  for (const id of p0KvaIds) {
    evidence[id] = { consumed: false, deferred: false, source: [] };
  }

  if (Array.isArray(directorReport)) {
    for (const item of directorReport) {
      if (!item || typeof item !== 'object') continue;
      const it = /** @type {Record<string, unknown>} */ (item);
      const kvaId = typeof it.kva_id === 'string' ? it.kva_id : '';
      if (!kvaId || !(kvaId in evidence)) continue;
      if (isKvaConsumedShotValue(it.consumed_at_shot)) {
        evidence[kvaId].consumed = true;
        evidence[kvaId].source.push('director.consumed_at_shot');
      } else if (typeof it.deferred_to_block === 'string' && it.deferred_to_block.trim()) {
        evidence[kvaId].deferred = true;
        evidence[kvaId].source.push(`director.deferred_to_block=${it.deferred_to_block.trim()}`);
      }
    }
  }

  if (Array.isArray(prompterCheck)) {
    for (const item of prompterCheck) {
      if (!item || typeof item !== 'object') continue;
      const it = /** @type {Record<string, unknown>} */ (item);
      const kvaId = typeof it.kva_id === 'string' ? it.kva_id : '';
      if (!kvaId || !(kvaId in evidence)) continue;
      if (it.pass === true) {
        evidence[kvaId].consumed = true;
        evidence[kvaId].deferred = false;
        evidence[kvaId].source.push('prompter.kva_visualization_check.pass');
      }
    }
  }

  let consumed = 0;
  let deferred = 0;
  for (const id of Object.keys(evidence)) {
    if (evidence[id].consumed) consumed += 1;
    else if (evidence[id].deferred) deferred += 1;
  }
  const total = p0KvaIds.size;
  const denom = Math.max(1, total - deferred);
  return { total, consumed, deferred, ratio: consumed / denom, evidence };
}

/**
 * HOTFIX S.1 · 用 Prompter 的 kva_visualization_check 对 Director 的 kvaOutcome 做二次裁决。
 *
 * 背景：Director 产物落地时我们就已经跑过一次 checkDirectorKvaCoverageV6 硬门，
 * 但 Director 自己常漏登记 kva_consumption_report（见 leji-v6-apimart-doubao-s 回测）。
 * 实际合同的最终履行者是 Prompter——它在生成 shots[] 时把 KVA 真的画到镜头里，
 * 并在自检字段 kva_visualization_check[] 里记录每条 KVA 的 shot_idx 与 pass。
 *
 * 因此：Prompter 到齐后，我们再合并两侧证据重算。如果合并后 ≥ 1.0，就把
 * 之前 Director 单独评出的 fail 就地改为 pass（detail 保留"Director 独判值 + Prompter 补证"供审计）。
 *
 * 本函数**只修改传入的 kvaOutcome**（原地改写），不返回新对象，保持与
 * call_sd2_block_chain_v6.mjs 里 hardgateOutcomes.push 后的引用一致。
 *
 * @param {{
 *   code: string,
 *   status: 'pass'|'fail'|'warn'|'skip',
 *   reason: string,
 *   block_id: string,
 *   detail: Record<string, unknown>
 * }} kvaOutcome           Director 侧已写入 hardgateOutcomes 的 outcome（将被原地改写）
 * @param {unknown} dirAppendix   Director 输出的 appendix（用于读 kva_consumption_report）
 * @param {unknown} prParsed      Prompter 完整产物（用于读 kva_visualization_check）
 * @param {Record<string, unknown> | null} scriptChunk  用于取 P0 KVA 集合
 * @param {boolean} skipKvaHard
 * @returns {void}
 */
export function reconcileKvaWithPrompterV6(kvaOutcome, dirAppendix, prParsed, scriptChunk, skipKvaHard) {
  // 只对 Director 侧已判 fail/warn 的 outcome 做 reconcile。pass 不用动；skip 代表无 P0 也不用动。
  if (kvaOutcome.status !== 'fail' && kvaOutcome.status !== 'warn') return;
  if (!scriptChunk) return;
  const kvas = Array.isArray(scriptChunk.key_visual_actions) ? scriptChunk.key_visual_actions : [];
  const p0KvaIds = new Set(
    kvas
      .filter((k) => k && typeof k === 'object' && /** @type {Record<string, unknown>} */ (k).priority === 'P0')
      .map((k) => /** @type {Record<string, unknown>} */ (k).kva_id)
      .filter((v) => typeof v === 'string'),
  );
  if (p0KvaIds.size === 0) return;

  const dirApp = dirAppendix && typeof dirAppendix === 'object'
    ? /** @type {Record<string, unknown>} */ (dirAppendix)
    : null;
  const dirReport = dirApp && Array.isArray(dirApp.kva_consumption_report)
    ? dirApp.kva_consumption_report
    : null;

  const pr = prParsed && typeof prParsed === 'object'
    ? /** @type {Record<string, unknown>} */ (prParsed)
    : null;
  const prCheck = pr && Array.isArray(pr.kva_visualization_check) ? pr.kva_visualization_check : null;

  // Prompter 没提供任何证据时，保持 Director 侧裁决不变。
  if (!prCheck || prCheck.length === 0) return;

  const summary = summarizeKvaEvidenceV6(p0KvaIds, dirReport, prCheck);
  const reconciledRatio = summary.ratio;
  const prevRatio = typeof kvaOutcome.detail?.kva_ratio === 'number' ? kvaOutcome.detail.kva_ratio : null;

  // 合并后仍 < 1.0 → 仍然 fail，但刷新 ratio 让审计看到 Prompter 补证后的值（通常比 Director 单独算的更高）。
  if (reconciledRatio < 1.0) {
    kvaOutcome.detail = {
      ...kvaOutcome.detail,
      kva_ratio: reconciledRatio,
      kva_ratio_director_only: prevRatio,
      reconciled_with_prompter: true,
      reconciled_consumed: summary.consumed,
      reconciled_deferred: summary.deferred,
      reconciled_total: summary.total,
    };
    kvaOutcome.reason = `kva_coverage_ratio ${reconciledRatio.toFixed(2)} < 1.00 (reconciled director+prompter; director_only=${prevRatio === null ? 'n/a' : prevRatio.toFixed(2)})`;
    return;
  }

  // 合并后 ≥ 1.0 → Director 漏登记但 Prompter 画到了；整体合同履行，降级为 pass。
  kvaOutcome.status = skipKvaHard ? 'pass' : 'pass';
  kvaOutcome.reason = `pass (reconciled director+prompter; director_only=${prevRatio === null ? 'n/a' : prevRatio.toFixed(2)}, prompter_recovered=${summary.consumed}/${summary.total})`;
  kvaOutcome.detail = {
    ...kvaOutcome.detail,
    kva_ratio: reconciledRatio,
    kva_ratio_director_only: prevRatio,
    reconciled_with_prompter: true,
    reconciled_consumed: summary.consumed,
    reconciled_deferred: summary.deferred,
    reconciled_total: summary.total,
  };
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

  const structureHits = Array.isArray(app.structure_hint_consumption) ? app.structure_hint_consumption : [];
  const lastShotIdx = meta.reduce((mx, m, i) => {
    if (!m || typeof m !== 'object') return Math.max(mx, i + 1);
    const idx = Number(/** @type {Record<string, unknown>} */ (m).shot_idx);
    return Number.isFinite(idx) && idx > 0 ? Math.max(mx, idx) : Math.max(mx, i + 1);
  }, 0);
  const terminalClosingHold = structureHits.some((hit) => {
    if (!hit || typeof hit !== 'object') return false;
    const h = /** @type {Record<string, unknown>} */ (hit);
    const type = typeof h.type === 'string' ? h.type : '';
    const shotIdx = Number(h.consumed_at_shot);
    if (!Number.isFinite(shotIdx) || shotIdx !== lastShotIdx) return false;
    return type === 'freeze_frame' || type === 'split_screen';
  });

  let noneCount = 0;
  let consecutive = 0;
  let consecutiveMax = 0;
  for (let i = 0; i < meta.length; i += 1) {
    const m = meta[i];
    if (!m || typeof m !== 'object') continue;
    const mm = /** @type {Record<string, unknown>} */ (m);
    const d = mm.info_delta;
    const shotIdx = Number(mm.shot_idx);
    const effectiveShotIdx = Number.isFinite(shotIdx) && shotIdx > 0 ? shotIdx : i + 1;
    if (d === 'none' && terminalClosingHold && effectiveShotIdx === lastShotIdx) {
      consecutive = 0;
      continue;
    }
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
  const dialogCorpus = normalizePromptDialogueCorpus(sd2Prompt);
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

    // Level 1 · exact：scriptChunk.text 在 sd2_prompt 中原样出现。
    if (sd2Prompt.indexOf(text) >= 0) continue;

    // Level 2 · shortened_by_author_hint：作者显式允许压缩时，接受 shortened_text 替代。
    const hint = seg.author_hint && typeof seg.author_hint === 'object'
      ? /** @type {Record<string, unknown>} */ (seg.author_hint)
      : null;
    const shortened = hint && typeof hint.shortened_text === 'string' ? hint.shortened_text.trim() : '';
    if (shortened && sd2Prompt.indexOf(shortened) >= 0) continue;

    // HOTFIX S · Bug B · Level 3 · annotation_stripped fallback。
    //   剧本常在对白里嵌入 "（动作指示）" 注释（B14 SEG_054 实锤），这些注释是给演员看的
    //   舞台指示、不进配音 TTS；Prompter 合法剥除后写入 [DIALOG]。原总审计器只做字符级
    //   严格比对，对这种场景会假阳性 fail。这里剥除成对的 `（...）` 和 `(...)` 再比对，
    //   保持与 Prompter 自检 match_mode=annotation_stripped 的口径一致。
    const stripped = stripInlineAnnotations(text);
    if (stripped && stripped !== text && sd2Prompt.indexOf(stripped) >= 0) continue;

    // HOTFIX T · 长对白跨多 shot 合法拆分时，允许在整个 [DIALOG] 语料拼接后命中。
    //   典型场景：同一条原文 seg 被 Director 拆到 2–4 个镜头，每个镜头各说一截。
    //   旧实现只在原始 sd2Prompt 上做整串 indexOf，会被重复 speaker 前缀 / 引号 / 换行打断。
    const textLoose = normalizeLooseText(text);
    if (dialogCorpus && textLoose && dialogCorpus.includes(textLoose)) continue;
    const strippedLoose = normalizeLooseText(stripped);
    if (dialogCorpus && strippedLoose && strippedLoose !== textLoose && dialogCorpus.includes(strippedLoose)) {
      continue;
    }

    const hintLoose = normalizeLooseText(shortened);
    if (dialogCorpus && hintLoose && dialogCorpus.includes(hintLoose)) continue;

    missing.push(sid);
  }
  return { status: missing.length === 0 ? 'pass' : 'fail', missing_seg_ids: missing };
}

/**
 * 剥除对白中成对的舞台指示注释：`（...）`（全角）和 `(...)`（半角）。
 *
 * 口径说明：
 *   - 只剥**成对**出现的括号及其内容，避免把台词中合法的反问括号误剥；
 *   - 剥完后做一次 trim，避免首尾留空白；
 *   - 不递归处理嵌套括号（目前剧本未见用例，保持简单实现）；
 *   - 不剥方括号 `[...]`，保留给 AV-split 段标签使用。
 *
 * @param {string} text
 * @returns {string}
 */
export function stripInlineAnnotations(text) {
  if (typeof text !== 'string' || !text) return '';
  // 非贪婪匹配成对括号；全角 / 半角各跑一遍；循环直至稳定（处理多个括号段）。
  let out = text;
  /* eslint-disable no-constant-condition */
  while (true) {
    const next = out.replace(/（[^（）]*）/g, '').replace(/\([^()]*\)/g, '');
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

/**
 * @param {string} sd2Prompt
 * @param {'DIALOG' | 'SFX'} label
 * @returns {string[]}
 */
function extractTaggedBodies(sd2Prompt, label) {
  const safe = String(sd2Prompt || '');
  const re = new RegExp(`\\[${label}\\]([\\s\\S]*?)(?=(?:\\n\\[(?:FRAME|DIALOG|SFX|BGM)\\])|$)`, 'g');
  /** @type {string[]} */
  const out = [];
  let m;
  while ((m = re.exec(safe)) !== null) {
    const body = (m[1] || '').trim();
    if (body) out.push(body);
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripDialogueLead(text) {
  let out = String(text || '').trim();
  while (true) {
    const next = out
      .replace(/^(?:独白|画外音|旁白|内心|心声|VO|OS)\s*[A-Za-z]*\s*[：:]\s*/i, '')
      .replace(/^[\u4e00-\u9fffA-Za-z0-9_]{1,10}(?:[（(][^）)]*[）)])?\s*[：:]\s*/, '')
      .trim();
    if (next === out) break;
    out = next;
  }
  return out.replace(/^[「『“"'‘’]+|[」』”"'‘’]+$/g, '').trim();
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeLooseText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[「」『』“”"'‘’]/g, '')
    .replace(/[，。！？、；：,.!?;:…—-]/g, '')
    .trim();
}

/**
 * 把多镜头 [DIALOG] 段落拼成一个连续可比对语料，去掉 speaker 前缀、引号与 <silent>。
 *
 * @param {string} sd2Prompt
 * @returns {string}
 */
function normalizePromptDialogueCorpus(sd2Prompt) {
  return extractTaggedBodies(sd2Prompt, 'DIALOG')
    .map((body) => body.trim())
    .filter((body) => body && body !== '<silent>')
    .map(stripDialogueLead)
    .map(normalizeLooseText)
    .filter(Boolean)
    .join('');
}
