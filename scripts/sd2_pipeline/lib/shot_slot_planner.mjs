/**
 * shot_slot_planner.mjs — SD2 Director 镜头槽位确定性派生器（v5.0-rev9）
 * ─────────────────────────────────────────────────────────────────────
 *
 * 为什么存在这个模块（治本背景）：
 *   旧架构下 Director LLM 同时扛 7 件事（读段落 + 消费 meta + 决定镜头数
 *   + 决定每镜时长 + 选 shot_code + 写画面 + 写 appendix），其中"镜头数
 *   / 每镜时长 / shot_code"三件事是**结构化可派生**的。LLM 在无强激励
 *   下会系统性压缩镜头数（1.5 秒省 30–50 tokens × 几十个 block）。
 *   所以 v5.0-rev8 把这三件事从 LLM 手里抢出来，交给确定性算法派生，
 *   LLM 只负责填 slot 内的画面 / 台词 / 音效（语义创意部分）。
 *
 * v5.0-rev9（X1 最终版 · 2026-04-17）：
 *   - **废弃"每片 ≥ 2s"硬编码下限**。原来把 brief 目标（2s/镜）当成了物理铁律，
 *     导致 13s 块 target=7 被 silent clamp 到 6。
 *   - 新语义分两层：
 *     · `minShotSec`（物理硬下限）：来自 Seedance 引擎规格，默认 1s；不可突破。
 *     · `avgShotSec`（目标平均时长）：由 brief 派生，仅用于 meta 审计，不参与分配。
 *       brief 三种输入态：①明写密度（如 "每镜 2s"）；②明写镜头数（N）→ avg=duration/N；
 *       ③什么都不写 → 缺省 avg=2s（传统短剧经验值）。
 *   - 分配算法保持不变（target 已通过 avg 在 normalize 层传导），只是物理上限改
 *     `floor(duration / minShotSec)` 取代旧 `floor(duration / 2)`。
 *
 * 输入（从 block_index[i] 与 meta 取）：
 *   - targetCount      : number          shot_budget_hint.target
 *   - tolerance        : [number, number] shot_budget_hint.tolerance
 *   - duration         : number          block 时长（秒）
 *   - rhythmTier       : number 1–5      block.rhythm_tier
 *   - shotHint         : string[]        routing.shot_hint（A_event/B_emotion/C_light/D_reveal）
 *   - psychologyGroup  : string          routing.psychology_group
 *   - sceneArchetype   : string          block.scene_archetype（hook_opening 等）
 *   - paywallLevel     : string          routing.paywall_level（none/soft/hard/final_cliff）
 *   - isLastBlock      : boolean         是否末 block
 *   - minShotSec       : number          Seedance 物理下限；默认 1（v5.0-rev9）
 *   - avgShotSec       : number          brief 目标平均时长；默认 2（v5.0-rev9）
 *
 * 输出：
 *   shot_slots[] = [
 *     { slot_id: "S1", shot_code: "A1", duration_sec: 2, role_hint: "hook", index: 0 },
 *     { slot_id: "S2", shot_code: "B3", duration_sec: 3, role_hint: "emotion_beat", index: 1 },
 *     ...
 *   ]
 *   每 slot 总时长 == duration；slot 数 == 镜头数（LLM 不再决定）。
 *
 * 设计原则：
 *   1. 确定性：同样输入总是同样输出（无随机），便于审计和回放。
 *   2. 守约束：镜头数 ∈ tolerance；每片 ∈ [minShotSec, 8]；总时长严格 == duration。
 *   3. 语义驱动：shot_code 分配参考 shot_hint + psychology_group + scene_archetype。
 *   4. 失败优雅：任何字段缺失时走默认路径，不抛异常（保证 pipeline 不阻塞）。
 *
 * harness 精神一致性：
 *   pipeline 控"结构"，LLM 负责"创意" —— slot 里画什么完全由 LLM 自由发挥，
 *   pipeline 不对画面语义做任何判断；"每片多长"由 brief 目标驱动，不硬编码。
 */

/** Seedance 2.0 物理规格：单镜头最短 1 秒（整秒派发）。v5.0-rev9 作为 minShotSec 默认值。 */
export const SEEDANCE_MIN_SHOT_SEC = 1;

/** 传统短剧经验：平均每镜 2 秒。v5.0-rev9 作为 avgShotSec 缺省值（brief 未写密度/镜数时回退）。 */
export const DEFAULT_AVG_SHOT_SEC = 2;

/** Seedance 2.0 物理规格：单镜头最长 8 秒。 */
export const SEEDANCE_MAX_SHOT_SEC = 8;

/**
 * shot_code → role_hint 映射表（用于告诉 LLM "这个 slot 要画什么类"）。
 * 不是死规则，LLM 仍可在 slot 内容里偏离，但至少有方向标。
 *
 * @type {Record<string, string>}
 */
const SHOT_CODE_ROLE_MAP = {
  A1: 'hook', // 特写钩子 / 视觉锚定
  A2: 'event', // 中/近景事件镜
  A3: 'evidence', // 证据特写（文件/物件）
  B1: 'reaction', // 主角反应特写
  B2: 'internal', // 内心戏 / 情绪凝滞
  B3: 'emotion_beat', // 情绪节拍（中近景）
  B4: 'setup', // 情绪铺垫（远景/环境）
  C1: 'ambience', // 环境/氛围（可附着）
  C2: 'transition', // 过渡/跳切
  C3: 'light_shift', // 光影切换
  D1: 'reveal', // 反转/揭示
  D2: 'freeze', // 冻帧
  D3: 'spectacle', // 炫技（竖屏慎用）
};

/**
 * 步骤 1：确定最终镜头数。
 *   - 优先 target，且限制在 tolerance 内
 *   - 物理上限 = floor(duration / minShotSec)；默认 minShotSec=1 → maxByMinShot = duration
 *   - 至少 2 片（防退化成单镜独白）
 *
 * v5.0-rev9：minShotSec 不再硬编码 2，改由调用方传入（默认 SEEDANCE_MIN_SHOT_SEC=1）。
 *   - 当 target 体现高密度意图（如 brief 指定 60 镜/120s=2s/镜；某 block 13s 要 7 片→
 *     1.86s/镜 < 旧 2s 硬下限），planner 不再 clamp 到 6，而是尊重 target=7 并派出
 *     类似 [2,2,2,2,2,2,1]s 或 [2,2,2,2,2,1,2]s 的分配。1s 触及物理底限但合法。
 *
 * @param {number} target
 * @param {[number, number] | null | undefined} tolerance
 * @param {number} duration
 * @param {number} [minShotSec]  物理硬下限（秒），默认 SEEDANCE_MIN_SHOT_SEC = 1
 * @returns {{ count: number, clampedBy: string | null }}
 */
function resolveShotCount(target, tolerance, duration, minShotSec = SEEDANCE_MIN_SHOT_SEC) {
  const [lo, hi] =
    Array.isArray(tolerance) && tolerance.length === 2
      ? [Math.max(1, tolerance[0] | 0), Math.max(1, tolerance[1] | 0)]
      : [2, 10];

  const minSec = Math.max(1, minShotSec | 0);
  const maxByMinShot = Math.max(2, Math.floor(duration / minSec));
  let n = Math.max(2, Math.round(Number.isFinite(target) ? target : (lo + hi) / 2));

  /** @type {string | null} */
  let clampedBy = null;
  if (n > maxByMinShot) {
    n = maxByMinShot;
    clampedBy = `duration_min_${minSec}s`;
  }
  if (n < lo) {
    n = Math.min(lo, maxByMinShot);
    clampedBy = clampedBy || 'tolerance_lo';
  }
  if (n > hi) {
    n = hi;
    clampedBy = clampedBy || 'tolerance_hi';
  }
  return { count: n, clampedBy };
}

/**
 * 步骤 2：按 rhythm_tier 在 n 个 slot 间分配时长，保证总和 == duration。
 *
 * 策略：
 *   base = floor(duration / n)，余数 rem = duration - base * n
 *   - tier ≤ 2（慢）：余数从末尾向前分配（末位镜头更长）
 *   - tier == 3（均）：余数从中间向两侧散开
 *   - tier ≥ 4（快）：余数从前向后分配（首位 + 节奏冲击）
 *
 * 并保证：minShotSec ≤ slot ≤ SEEDANCE_MAX_SHOT_SEC。
 *   - v5.0-rev9：下限从硬编码 2 → 参数化 minShotSec（默认 1）。
 *     当 n 较大（高密度）导致 base == 1 时不再 re-balance 减片，而是接受 1s 闪切镜头。
 *   - 上限 8s 保持不变（Seedance 规格）。
 *
 * @param {number} duration
 * @param {number} n
 * @param {number} rhythmTier
 * @param {number} [minShotSec]  物理硬下限（秒），默认 SEEDANCE_MIN_SHOT_SEC = 1
 * @returns {number[]}
 */
function distributeDurations(duration, n, rhythmTier, minShotSec = SEEDANCE_MIN_SHOT_SEC) {
  if (n <= 0) return [];

  const minSec = Math.max(1, minShotSec | 0);
  const maxSec = SEEDANCE_MAX_SHOT_SEC;

  const base = Math.floor(duration / n);
  const rem = duration - base * n;
  /** @type {number[]} */
  const slots = new Array(n).fill(base);

  if (rem > 0) {
    /** @type {number[]} */
    let positions;
    if (rhythmTier <= 2) {
      positions = Array.from({ length: rem }, (_, k) => n - 1 - k);
    } else if (rhythmTier >= 4) {
      positions = Array.from({ length: rem }, (_, k) => k);
    } else {
      const mid = Math.floor(n / 2);
      positions = Array.from({ length: rem }, (_, k) => {
        const side = k % 2 === 0 ? 1 : -1;
        return mid + side * Math.floor(k / 2);
      });
    }
    positions.forEach((idx) => {
      const i = Math.max(0, Math.min(n - 1, idx));
      slots[i] += 1;
    });
  }

  /* 兜底：保证 minSec ≤ slot ≤ maxSec；一般进入此处意味着输入参数极端 */
  for (let i = 0; i < n; i += 1) {
    if (slots[i] < minSec) {
      const need = minSec - slots[i];
      slots[i] = minSec;
      let stolen = 0;
      for (let j = 0; j < n && stolen < need; j += 1) {
        if (j === i) continue;
        if (slots[j] > minSec) {
          slots[j] -= 1;
          stolen += 1;
        }
      }
    }
  }
  for (let i = 0; i < n; i += 1) {
    if (slots[i] > maxSec) {
      const overflow = slots[i] - maxSec;
      slots[i] = maxSec;
      let parked = 0;
      for (let j = 0; j < n && parked < overflow; j += 1) {
        if (j === i) continue;
        if (slots[j] < maxSec) {
          slots[j] += 1;
          parked += 1;
        }
      }
    }
  }

  return slots;
}

/**
 * 步骤 3：为每个 slot 分配 shot_code。
 *
 * 首末 slot 用"语义锚定"确定性规则；中间 slot 轮转 shot_hint 池，避免 3 连同码。
 *
 * 约束：
 *   - A 类 ≤ 2 / block（防冲击过载）
 *   - D 类 ≤ 1 / block（仅反转/冻帧/炫技）
 *   - C 类可附着，不强占（本派生默认不独占一片）
 *   - 禁止连续 3 个同大类（首字母）
 *
 * @param {number} n
 * @param {string[]} shotHint
 * @param {string} psychologyGroup
 * @param {string} sceneArchetype
 * @param {string} paywallLevel
 * @param {boolean} isLastBlock
 * @returns {string[]}
 */
function assignShotCodes(n, shotHint, psychologyGroup, sceneArchetype, paywallLevel, isLastBlock) {
  const hints = Array.isArray(shotHint) ? shotHint : [];
  const hasA = hints.includes('A_event');
  const hasB = hints.includes('B_emotion');
  const hasD = hints.includes('D_reveal');

  /** @type {string[]} */
  const codes = new Array(n).fill('');

  /* 首 slot：锚定 */
  if (psychologyGroup === 'hook' || sceneArchetype === 'hook_opening') {
    codes[0] = 'A1';
  } else if (hasA) {
    codes[0] = 'A2';
  } else {
    codes[0] = 'B3';
  }

  /* 末 slot：情感锚点 */
  if (isLastBlock && paywallLevel === 'final_cliff') {
    codes[n - 1] = 'D1';
  } else if (psychologyGroup === 'payoff') {
    codes[n - 1] = 'B1';
  } else if (hasB) {
    codes[n - 1] = 'B2';
  } else {
    codes[n - 1] = 'A2';
  }

  /* 中间 slot：轮转池 */
  const bPool = ['B3', 'B2', 'B4', 'B1'];
  const aPool = ['A2', 'A3'];
  let bPtr = 0;
  let aPtr = 0;
  const countClass = (/** @type {string} */ cls) => codes.filter((c) => c.startsWith(cls)).length;

  for (let i = 1; i < n - 1; i += 1) {
    const prev = codes[i - 1];
    const prev2 = i >= 2 ? codes[i - 2] : '';
    const last2SameClass = prev && prev2 && prev[0] === prev2[0];

    /* 组装优先池，受 shot_hint 和配额约束 */
    /** @type {string[]} */
    const priorityPool = [];
    if (hasB) {
      priorityPool.push(bPool[bPtr % bPool.length]);
    }
    if (hasA && countClass('A') < 2) {
      priorityPool.push(aPool[aPtr % aPool.length]);
    }
    if (hasD && countClass('D') === 0 && i === n - 2) {
      priorityPool.push('D1');
    }
    /* 兜底池 */
    if (priorityPool.length === 0) {
      priorityPool.push(bPool[bPtr % bPool.length], aPool[aPtr % aPool.length]);
    }

    /* 按顺序挑第一个不违反 3 连的 */
    let chosen = priorityPool[0];
    for (const cand of priorityPool) {
      const candClass = cand[0];
      if (last2SameClass && candClass === prev[0]) continue;
      chosen = cand;
      break;
    }

    codes[i] = chosen;
    if (chosen.startsWith('B')) bPtr += 1;
    if (chosen.startsWith('A')) aPtr += 1;
  }

  return codes;
}

/**
 * 主入口：输入 block 信号 → 输出 shot_slots[]。
 *
 * @param {Object} params
 * @param {number} params.targetCount
 * @param {[number, number] | null | undefined} params.tolerance
 * @param {number} params.duration
 * @param {number} params.rhythmTier
 * @param {string[]} params.shotHint
 * @param {string} params.psychologyGroup
 * @param {string} params.sceneArchetype
 * @param {string} params.paywallLevel
 * @param {boolean} params.isLastBlock
 * @param {number} [params.minShotSec]  Seedance 物理下限，默认 1s（v5.0-rev9）
 * @param {number} [params.avgShotSec]  brief 目标平均时长，默认 2s（v5.0-rev9）
 * @returns {{
 *   slots: Array<{ slot_id: string, shot_code: string, duration_sec: number, role_hint: string, index: number }>,
 *   meta: {
 *     count: number,
 *     clamped_by: string | null,
 *     distribution_strategy: string,
 *     min_shot_sec: number,
 *     avg_shot_sec: number,
 *   },
 * }}
 */
export function planShotSlots({
  targetCount,
  tolerance,
  duration,
  rhythmTier = 3,
  shotHint = [],
  psychologyGroup = 'general',
  sceneArchetype = '',
  paywallLevel = 'none',
  isLastBlock = false,
  minShotSec = SEEDANCE_MIN_SHOT_SEC,
  avgShotSec = DEFAULT_AVG_SHOT_SEC,
}) {
  const dur = Math.max(1, duration | 0);
  const minSec = Math.max(1, minShotSec | 0);
  const avgSec = Math.max(minSec, Number.isFinite(avgShotSec) ? avgShotSec : DEFAULT_AVG_SHOT_SEC);

  const { count, clampedBy } = resolveShotCount(targetCount, tolerance, dur, minSec);
  const durations = distributeDurations(dur, count, rhythmTier, minSec);
  const codes = assignShotCodes(
    count,
    shotHint,
    psychologyGroup,
    sceneArchetype,
    paywallLevel,
    isLastBlock,
  );

  const slots = durations.map((secs, idx) => {
    const code = codes[idx] || 'A2';
    return {
      slot_id: `S${idx + 1}`,
      shot_code: code,
      duration_sec: secs,
      role_hint: SHOT_CODE_ROLE_MAP[code] || 'event',
      index: idx,
    };
  });

  const distributionStrategy =
    rhythmTier <= 2 ? 'slow_tail_heavy' : rhythmTier >= 4 ? 'fast_head_beat' : 'even_spread';

  return {
    slots,
    meta: {
      count,
      clamped_by: clampedBy,
      distribution_strategy: distributionStrategy,
      min_shot_sec: minSec,
      avg_shot_sec: avgSec,
    },
  };
}

/**
 * 便捷入口：直接从 block_index 行 + 全局信息一把生成 slots。
 *
 * v5.0-rev9：额外接收可选的密度上下文，从片级 meta 传入：
 *   - minShotSec：Seedance 物理下限（默认 1）
 *   - avgShotSec：brief 派生的目标平均时长（默认 2）
 *
 * @param {unknown} biRow           appendix.block_index[i]
 * @param {boolean} isLastBlock
 * @param {{ minShotSec?: number, avgShotSec?: number }} [densityCtx]
 * @returns {ReturnType<typeof planShotSlots> | null}
 */
export function planShotSlotsFromBlockIndex(biRow, isLastBlock, densityCtx) {
  if (!biRow || typeof biRow !== 'object') return null;
  const r = /** @type {Record<string, unknown>} */ (biRow);
  const hint =
    r.shot_budget_hint && typeof r.shot_budget_hint === 'object'
      ? /** @type {Record<string, unknown>} */ (r.shot_budget_hint)
      : null;

  const routing =
    r.routing && typeof r.routing === 'object'
      ? /** @type {Record<string, unknown>} */ (r.routing)
      : {};
  const duration = typeof r.duration === 'number' ? r.duration : 0;
  const minShotSec =
    densityCtx && Number.isFinite(densityCtx.minShotSec)
      ? /** @type {number} */ (densityCtx.minShotSec)
      : SEEDANCE_MIN_SHOT_SEC;
  const avgShotSec =
    densityCtx && Number.isFinite(densityCtx.avgShotSec)
      ? /** @type {number} */ (densityCtx.avgShotSec)
      : DEFAULT_AVG_SHOT_SEC;
  const derivedTarget = Math.max(
    1,
    Math.round(Math.max(1, duration) / Math.max(minShotSec, avgShotSec)),
  );
  const targetCount = hint && typeof hint.target === 'number' ? Number(hint.target) | 0 : derivedTarget;
  const toleranceRaw = hint && Array.isArray(hint.tolerance) ? hint.tolerance : null;
  /** @type {[number, number] | null} */
  const tolerance =
    toleranceRaw && toleranceRaw.length === 2
      ? [Number(toleranceRaw[0]) | 0, Number(toleranceRaw[1]) | 0]
      : !hint
        ? [Math.max(1, targetCount - 1), targetCount + 1]
      : null;

  const rhythmTier = typeof r.rhythm_tier === 'number' ? r.rhythm_tier : 3;
  const shotHint = Array.isArray(routing.shot_hint) ? /** @type {string[]} */ (routing.shot_hint) : [];
  const psychologyGroup =
    typeof routing.psychology_group === 'string' ? routing.psychology_group : 'general';
  const sceneArchetype = typeof r.scene_archetype === 'string' ? r.scene_archetype : '';
  const paywallLevel = typeof routing.paywall_level === 'string' ? routing.paywall_level : 'none';

  return planShotSlots({
    targetCount,
    tolerance,
    duration,
    rhythmTier,
    shotHint,
    psychologyGroup,
    sceneArchetype,
    paywallLevel,
    isLastBlock,
    minShotSec,
    avgShotSec,
  });
}
