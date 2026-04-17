/**
 * EditMap-SD2 v5 归一化：
 *   1. 复用 v3/v4 的形状归一化（拆段落、合成 blocks[]、填默认字段）；
 *   2. v4 → v5 兼容层：把旧的 `block_index[i].structural_tags[]` 迁移成
 *      `block_index[i].routing.structural[]`，并补齐其它 routing 字段的默认值；
 *   3. 标记 `sd2_version = 'v5'` 便于下游判断版本；
 *   4. v5.0 HOTFIX：
 *      - 派生 `appendix.meta.target_shot_count`（片级镜头预算）；
 *      - 派生 `appendix.block_index[i].shot_budget_hint`（块级镜头预算）；
 *      - 初始化 `appendix.meta.routing_warnings = []`（软门统一告警出口）。
 *
 * 契约来源：
 *   - prompt/1_SD2Workflow/docs/v5/07_v5-schema-冻结.md §二、§六·兼容层、§七·附
 *   - prompt/1_SD2Workflow/docs/v5/06_v5-验收清单与回归基线.md §一.1.2
 */
import { normalizeEditMapSd2V3 } from './normalize_edit_map_sd2_v3.mjs';

/**
 * 受控的 routing 六字段默认值。
 * - 四个数组字段默认 `[]`；
 * - `paywall_level` 默认 `"none"`。
 */
const ROUTING_DEFAULTS = Object.freeze({
  structural: [],
  satisfaction: [],
  psychology: [],
  shot_hint: [],
  paywall_level: 'none',
});

/** v5.0 HOTFIX：镜头预算容忍系数（±15%） */
const TOTAL_SHOT_TOLERANCE_RATIO = 0.15;
/** v5.0 HOTFIX：单 block 镜头预算硬容忍（±1 镜头，短剧粒度） */
const PER_BLOCK_SHOT_TOLERANCE_ABS = 1;

/**
 * 确保 block_index[i].routing 存在且六字段齐全。若缺失就填默认值；
 * 若顶层仍有 v4 的 `structural_tags` 而 routing.structural 为空，做迁移。
 *
 * @param {Record<string, unknown>} block  单条 block_index
 */
function normalizeRoutingOnBlock(block) {
  const rawRouting = block.routing;
  /** @type {Record<string, unknown>} */
  const routing =
    rawRouting && typeof rawRouting === 'object'
      ? /** @type {Record<string, unknown>} */ (rawRouting)
      : {};

  // 四个数组字段：若不是数组就覆盖成默认 []
  for (const key of ['structural', 'satisfaction', 'psychology', 'shot_hint']) {
    if (!Array.isArray(routing[key])) {
      routing[key] = [...ROUTING_DEFAULTS[key]];
    }
  }

  // paywall_level：必须字符串，且在合法枚举内；否则 "none"
  const pl = routing.paywall_level;
  const allowed = new Set(['none', 'soft', 'hard', 'final_cliff']);
  if (typeof pl !== 'string' || !allowed.has(pl)) {
    routing.paywall_level = 'none';
  }

  // v4 → v5 迁移：若 routing.structural 为空而 block.structural_tags 有值，回填 routing.structural
  const legacyTags = block.structural_tags;
  if (
    Array.isArray(legacyTags) &&
    legacyTags.length > 0 &&
    Array.isArray(routing.structural) &&
    routing.structural.length === 0
  ) {
    routing.structural = legacyTags.map((x) => String(x));
  }

  block.routing = routing;
}

/**
 * 确保 meta.video.aspect_ratio 存在；若缺失就从已知兼容字段（meta.aspect_ratio /
 * meta.parsed_brief.aspect_ratio / meta.parsed_brief.aspectRatio）回填，都没有则填 "9:16"。
 *
 * @param {Record<string, unknown>} meta
 */
function normalizeMetaVideo(meta) {
  const rawVideo = meta.video;
  /** @type {Record<string, unknown>} */
  const video =
    rawVideo && typeof rawVideo === 'object'
      ? /** @type {Record<string, unknown>} */ (rawVideo)
      : {};

  if (typeof video.aspect_ratio !== 'string' || !video.aspect_ratio.trim()) {
    /** 回退链：meta.aspect_ratio → parsed_brief.aspect_ratio → parsed_brief.aspectRatio → "9:16" */
    const metaAR = typeof meta.aspect_ratio === 'string' ? meta.aspect_ratio : '';
    const pb =
      meta.parsed_brief && typeof meta.parsed_brief === 'object'
        ? /** @type {Record<string, unknown>} */ (meta.parsed_brief)
        : {};
    const pbAR =
      typeof pb.aspect_ratio === 'string'
        ? pb.aspect_ratio
        : typeof pb.aspectRatio === 'string'
          ? pb.aspectRatio
          : '';
    video.aspect_ratio = metaAR || pbAR || '9:16';
  }

  if (typeof video.scene_bucket_default !== 'string' || !video.scene_bucket_default.trim()) {
    video.scene_bucket_default = 'dialogue';
  }

  meta.video = video;
}

/**
 * 从 options.workflowControls / meta.parsed_brief / meta.video 逐级回退，
 * 解析出 (targetShotCount, avgShotDuration)。
 *
 * 解析优先级：
 *   1. options.workflowControls.shotCountTargetApprox  + avgShotDuration
 *   2. meta.parsed_brief.target_shot_count_range 取中点 + episode_duration_sec / 中点
 *   3. meta.video.target_duration_sec / 4    （保守回退，4s/shot）
 *   4. 放弃派生（返回 null）
 *
 * @param {Record<string, unknown>} meta
 * @param {Record<string, unknown>} [workflowControls]
 * @returns {{ target: number, avgShotDuration: number } | null}
 */
function resolveShotBudgetInputs(meta, workflowControls) {
  // ── 路径 1：显式 workflowControls ──
  if (workflowControls && typeof workflowControls === 'object') {
    const wc = workflowControls;
    const t = typeof wc.shotCountTargetApprox === 'number' ? wc.shotCountTargetApprox : 0;
    const a = typeof wc.avgShotDuration === 'number' ? wc.avgShotDuration : 0;
    if (t > 0 && a > 0) {
      return { target: Math.round(t), avgShotDuration: a };
    }
  }

  // ── 路径 2：parsed_brief.target_shot_count_range ──
  const pb =
    meta.parsed_brief && typeof meta.parsed_brief === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.parsed_brief)
      : {};
  const rng = pb.target_shot_count_range;
  if (Array.isArray(rng) && rng.length === 2) {
    const lo = Number(rng[0]);
    const hi = Number(rng[1]);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi >= lo) {
      const mid = Math.round((lo + hi) / 2);
      const dur = typeof pb.episode_duration_sec === 'number' ? pb.episode_duration_sec : 0;
      if (mid > 0 && dur > 0) {
        return { target: mid, avgShotDuration: +(dur / mid).toFixed(2) };
      }
    }
  }

  // ── 路径 3：target_duration_sec / 4（保守回退）──
  const video =
    meta.video && typeof meta.video === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.video)
      : {};
  const totalDur = typeof video.target_duration_sec === 'number' ? video.target_duration_sec : 0;
  if (totalDur > 0) {
    const assumedAvg = 4;
    return { target: Math.max(1, Math.round(totalDur / assumedAvg)), avgShotDuration: assumedAvg };
  }

  return null;
}

/**
 * v5.0 HOTFIX：派生 meta.target_shot_count + block_index[i].shot_budget_hint。
 * 若无法解析输入则跳过（保持兼容，不强制）。
 *
 * @param {Record<string, unknown>} meta
 * @param {Array<Record<string, unknown>>} rows  appendix.block_index[]
 * @param {Record<string, unknown>} [workflowControls]
 */
function deriveShotBudgets(meta, rows, workflowControls) {
  const inputs = resolveShotBudgetInputs(meta, workflowControls);
  if (!inputs) {
    return;
  }
  const { target, avgShotDuration } = inputs;

  // 片级 target_shot_count：target ± 15% 作为容忍（至少 ±2）
  const delta = Math.max(2, Math.ceil(target * TOTAL_SHOT_TOLERANCE_RATIO));
  meta.target_shot_count = {
    target,
    tolerance: [Math.max(1, target - delta), target + delta],
    avg_shot_duration_sec: avgShotDuration,
  };

  // 块级 shot_budget_hint：target = round(duration / avg)，tolerance = [max(1, t-1), t+1]
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const dur =
      typeof row.duration === 'number'
        ? row.duration
        : typeof row.duration_sec === 'number'
          ? /** @type {number} */ (row.duration_sec)
          : 0;
    if (dur <= 0) {
      continue;
    }
    const tgt = Math.max(1, Math.round(dur / avgShotDuration));
    row.shot_budget_hint = {
      target: tgt,
      tolerance: [Math.max(1, tgt - PER_BLOCK_SHOT_TOLERANCE_ABS), tgt + PER_BLOCK_SHOT_TOLERANCE_ABS],
    };
  }
}

/**
 * v5 归一化主入口。就地修改 parsed（EditMap v5 LLM 输出），返回同一引用。
 *
 * @param {unknown} parsed
 * @param {{ workflowControls?: Record<string, unknown> }} [options]
 *   可选参数；传入 workflowControls 后 normalize 会派生镜头预算字段。
 *   未传时走 parsed_brief / target_duration_sec 回退链。
 * @returns {unknown}
 */
export function normalizeEditMapSd2V5(parsed, options = {}) {
  // 基础形状复用 v3（拆段、合成 blocks[] 等）
  normalizeEditMapSd2V3(parsed);

  if (!parsed || typeof parsed !== 'object') {
    return parsed;
  }
  const obj = /** @type {Record<string, unknown>} */ (parsed);

  // 打版本标
  obj.sd2_version = 'v5';

  // ── 1. 归一化 meta.video ──
  //   注意：v5 LLM 输出里 meta 同时出现在 obj.meta 和 obj.appendix.meta
  //   （后者是合同里的 canonical 位置）。两边都归一以保证下游一致性。
  const rawTopMeta = obj.meta;
  if (rawTopMeta && typeof rawTopMeta === 'object') {
    normalizeMetaVideo(/** @type {Record<string, unknown>} */ (rawTopMeta));
  }
  const rawAppendix = obj.appendix;
  /** @type {Record<string, unknown>|null} */
  let appendix = null;
  if (rawAppendix && typeof rawAppendix === 'object') {
    appendix = /** @type {Record<string, unknown>} */ (rawAppendix);
    if (appendix.meta && typeof appendix.meta === 'object') {
      normalizeMetaVideo(/** @type {Record<string, unknown>} */ (appendix.meta));
    }
  }

  // ── 2. 归一化 appendix.block_index[i].routing ──
  /** @type {Array<Record<string, unknown>>} */
  const rows = [];
  if (appendix) {
    const rawRows = Array.isArray(appendix.block_index) ? appendix.block_index : [];
    for (const row of rawRows) {
      if (row && typeof row === 'object') {
        const r = /** @type {Record<string, unknown>} */ (row);
        normalizeRoutingOnBlock(r);
        rows.push(r);
      }
    }
  }

  // ── 3. v5.0 HOTFIX：派生镜头预算 + 初始化 routing_warnings ──
  //   派生目标是 appendix.meta（canonical 位置），并保持 obj.meta 同步以兼容旧消费者。
  const appendixMeta =
    appendix && appendix.meta && typeof appendix.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (appendix.meta)
      : rawTopMeta && typeof rawTopMeta === 'object'
        ? /** @type {Record<string, unknown>} */ (rawTopMeta)
        : null;

  if (appendixMeta) {
    deriveShotBudgets(appendixMeta, rows, options.workflowControls);

    // routing_warnings：初始化为空数组，由下游（editmap-side 软门校验 + block_chain）追加
    if (!Array.isArray(appendixMeta.routing_warnings)) {
      appendixMeta.routing_warnings = [];
    }

    // v5.0 治本 · S10/S11：EditMap 侧语义软门校验（纯数据交叉比对，无 LLM 调用）
    //   详见 07_v5-schema-冻结.md §7.10 / §7.11；06_v5-验收清单 §1.2
    checkSatisfactionSubject(appendixMeta, /** @type {Array<Record<string, unknown>>} */ (appendixMeta.routing_warnings));
    checkProofLadderCoverage(appendixMeta, rows, /** @type {Array<Record<string, unknown>>} */ (appendixMeta.routing_warnings));

    // obj.meta 与 appendix.meta 是两份引用；若都存在则同步 target_shot_count / routing_warnings
    if (rawTopMeta && typeof rawTopMeta === 'object' && rawTopMeta !== appendixMeta) {
      const topMeta = /** @type {Record<string, unknown>} */ (rawTopMeta);
      topMeta.target_shot_count = appendixMeta.target_shot_count;
      topMeta.routing_warnings = appendixMeta.routing_warnings;
    }
  }

  return parsed;
}

/**
 * v5.0 治本 · S10：`satisfaction_subject_check`（07 §7.10）
 *
 * 交叉校验 meta.satisfaction_points[i] 与 meta.status_curve[block_id == 该点].protagonist，
 * 若主角 position == "down" 或 delta_from_prev ∈ {down, down_deeper}，则说明 satisfaction_points
 * 的主体很可能是反派得逞而非主角爽点，写入 `satisfaction_subject_misaligned` 告警。
 *
 * @param {Record<string, unknown>} meta             appendix.meta
 * @param {Array<Record<string, unknown>>} warnings  appendixMeta.routing_warnings（会被 push）
 */
function checkSatisfactionSubject(meta, warnings) {
  const sp = Array.isArray(meta.satisfaction_points) ? meta.satisfaction_points : [];
  const sc = Array.isArray(meta.status_curve) ? meta.status_curve : [];
  if (sp.length === 0 || sc.length === 0) return;

  // 索引 status_curve by block_id
  /** @type {Map<string, Record<string, unknown>>} */
  const scByBlock = new Map();
  for (const entry of sc) {
    if (entry && typeof entry === 'object') {
      const e = /** @type {Record<string, unknown>} */ (entry);
      const bid = typeof e.block_id === 'string' ? e.block_id : null;
      if (bid) scByBlock.set(bid, e);
    }
  }

  const downPositions = new Set(['down']);
  const downDeltas = new Set(['down', 'down_deeper']);

  for (const p of sp) {
    if (!p || typeof p !== 'object') continue;
    const point = /** @type {Record<string, unknown>} */ (p);
    const bid = typeof point.block_id === 'string' ? point.block_id : null;
    if (!bid) continue;
    const entry = scByBlock.get(bid);
    if (!entry) continue;

    const protagonist =
      entry.protagonist && typeof entry.protagonist === 'object'
        ? /** @type {Record<string, unknown>} */ (entry.protagonist)
        : null;
    const pos = protagonist && typeof protagonist.position === 'string' ? protagonist.position : null;
    const delta = typeof entry.delta_from_prev === 'string' ? entry.delta_from_prev : null;

    const posBad = pos !== null && downPositions.has(pos);
    const deltaBad = delta !== null && downDeltas.has(delta);

    if (posBad || deltaBad) {
      warnings.push({
        code: 'satisfaction_subject_misaligned',
        severity: 'warn',
        block_id: bid,
        actual: {
          'protagonist.position': pos,
          delta_from_prev: delta,
          motif: typeof point.motif === 'string' ? point.motif : null,
        },
        expected: {
          'protagonist.position': 'mid | up',
          delta_from_prev: 'up | up_steep',
        },
        message:
          `block ${bid} 标记了 satisfaction_points（motif=${point.motif ?? '?'}），` +
          `但 status_curve 显示主角 position=${pos ?? '?'} / delta=${delta ?? '?'}，` +
          `疑似把反派得逞误当主角爽点；请检查 satisfaction 主体（见 EditMap v5 §4.4 主体校验红线）。`,
      });
    }
  }
}

/**
 * v5.0 治本 · S11：`proof_ladder_coverage_check`（07 §7.11）
 *
 * 非 `non_mystery` 题材下：
 *   - 覆盖率：非 retracted 条目覆盖的 block_id 数 / 总 block 数 < 0.6 → warn；
 *   - max_level：非 retracted 条目最高 level 未触达 `testimony` 或 `self_confession` → warn；
 *   - 例外：末 block paywall_level == "final_cliff" 时允许停在 physical / testimony。
 *
 * @param {Record<string, unknown>} meta             appendix.meta
 * @param {Array<Record<string, unknown>>} blocks    appendix.block_index[]
 * @param {Array<Record<string, unknown>>} warnings  appendixMeta.routing_warnings
 */
function checkProofLadderCoverage(meta, blocks, warnings) {
  // 题材例外：non_mystery 时跳过
  const video =
    meta.video && typeof meta.video === 'object' ? /** @type {Record<string, unknown>} */ (meta.video) : null;
  const genre = video && typeof video.genre_hint === 'string' ? video.genre_hint : null;
  if (genre === 'non_mystery') return;

  const ladder = Array.isArray(meta.proof_ladder) ? meta.proof_ladder : [];
  if (ladder.length === 0) return; // 空 ladder 由 proof_ladder_check 本身判定

  const totalBlocks = blocks.length;
  if (totalBlocks === 0) return;

  // 非 retracted 条目的 block_id 去重集合
  /** @type {Set<string>} */
  const coveredBlocks = new Set();
  /** @type {Set<string>} */
  const levels = new Set();
  for (const item of ladder) {
    if (!item || typeof item !== 'object') continue;
    const it = /** @type {Record<string, unknown>} */ (item);
    if (it.retracted === true) continue;
    const bid = typeof it.block_id === 'string' ? it.block_id : null;
    if (bid) coveredBlocks.add(bid);
    const lvl = typeof it.level === 'string' ? it.level : null;
    if (lvl) levels.add(lvl);
  }

  // 覆盖率门槛：≥ ceil(N × 0.6)
  const minCovered = Math.ceil(totalBlocks * 0.6);
  if (coveredBlocks.size < minCovered) {
    warnings.push({
      code: 'proof_ladder_coverage_insufficient',
      severity: 'warn',
      block_id: null,
      actual: {
        covered: coveredBlocks.size,
        total_blocks: totalBlocks,
      },
      expected: {
        min_covered: minCovered,
        ratio: '>= 0.6',
      },
      message:
        `proof_ladder 覆盖 ${coveredBlocks.size}/${totalBlocks} 个 block（需 ≥ ${minCovered}），` +
        `证据链贯穿度不足（见 EditMap v5 §4.7 贯穿下限）。`,
    });
  }

  // max_level：需触达 testimony 或 self_confession
  // 例外：末 block paywall_level == final_cliff 时允许 physical / testimony
  const lastBlock =
    blocks.length > 0 && blocks[blocks.length - 1] && typeof blocks[blocks.length - 1] === 'object'
      ? /** @type {Record<string, unknown>} */ (blocks[blocks.length - 1])
      : null;
  const lastRouting =
    lastBlock && lastBlock.routing && typeof lastBlock.routing === 'object'
      ? /** @type {Record<string, unknown>} */ (lastBlock.routing)
      : null;
  const lastPaywall = lastRouting && typeof lastRouting.paywall_level === 'string' ? lastRouting.paywall_level : null;
  const isFinalCliff = lastPaywall === 'final_cliff';

  const hasTestimonyOrAbove = levels.has('testimony') || levels.has('self_confession');
  const hasPhysicalOrAbove = hasTestimonyOrAbove || levels.has('physical');

  if (!hasTestimonyOrAbove) {
    if (isFinalCliff && hasPhysicalOrAbove) {
      // final_cliff 下允许停在 physical —— 不告警
    } else {
      warnings.push({
        code: 'proof_ladder_coverage_insufficient',
        severity: 'warn',
        block_id: null,
        actual: {
          max_level: bestLevel(levels),
          levels_seen: Array.from(levels),
        },
        expected: {
          max_level: 'testimony | self_confession',
          exception: 'last block paywall_level == final_cliff 时允许 physical / testimony',
        },
        message:
          `proof_ladder 最高 level 仅为 ${bestLevel(levels) ?? '(空)'}，未触达 testimony；` +
          `证据链强度不足（见 EditMap v5 §4.7 贯穿下限）。`,
      });
    }
  }
}

/**
 * 从 level 集合中返回"最高"等级（用于 message）。
 * 等级顺序：rumor < physical < testimony < self_confession
 *
 * @param {Set<string>} levels
 * @returns {string | null}
 */
function bestLevel(levels) {
  const order = ['self_confession', 'testimony', 'physical', 'rumor'];
  for (const lvl of order) {
    if (levels.has(lvl)) return lvl;
  }
  return null;
}
