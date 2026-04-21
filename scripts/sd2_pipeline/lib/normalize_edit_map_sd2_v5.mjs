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
 * v5.0-rev4 · genre 白名单（与 1_EditMap-SD2-v5.md §0.0 保持同步）。
 * `sweet_romance` / `revenge` / `suspense` / `fantasy` / `general`。
 */
const GENRE_ENUM = Object.freeze(['sweet_romance', 'revenge', 'suspense', 'fantasy', 'general']);

/**
 * v5.0-rev4 · genre 关键词→枚举 同义词映射表。
 *
 * 用于 LLM 把 brief / 剧本题材写成"drama / 都市情感 / 医疗情感 / 职场"等枚举外
 * 自然语言值时，normalize 层防御性归位到 5 元枚举之一。
 *
 * 命中优先级：从上到下、从具体到宽泛（top-down，先命中先停）。
 */
const GENRE_KEYWORD_MAP = Object.freeze(
  /** @type {Array<{ enum: string; patterns: RegExp[] }>} */ ([
    {
      enum: 'revenge',
      patterns: [
        /复仇|打脸|虐渣|反杀|追妻火葬场|夺权|逆袭|商战|宫斗|斗渣/,
        /revenge|comeback|dominance/i,
      ],
    },
    {
      enum: 'sweet_romance',
      patterns: [
        /甜宠|糖分|先婚后爱|契约婚|闪婚|总裁爱上|恋爱脑|CP|强制爱|甜剧/,
        /romance|sweet|love/i,
      ],
    },
    {
      enum: 'suspense',
      patterns: [/悬疑|查真相|破案|反转|惊悚|神秘|身份之谜|真相/, /mystery|suspense|thriller/i],
    },
    {
      enum: 'fantasy',
      patterns: [/玄幻|仙侠|穿越|重生|系统|修真|异世|魔法|超能力/, /fantasy|isekai|supernatural/i],
    },
    // general 是最终兜底，不列关键词
  ]),
);

/**
 * v5.0-rev4 · 把 LLM / brief 里可能写错的 genre 归位到 5 元枚举之一。
 *
 * 归位策略（逐条尝试，首个命中即停；全失败 → `general`）：
 *   1. 若 raw 已在白名单内，直接用；
 *   2. 按 GENRE_KEYWORD_MAP 扫 raw 字符串 + 辅助文本（extraConstraints 拼接、title、artStyle）；
 *   3. 兜底 `general`。
 *
 * @param {string | null | undefined} raw     LLM 给的原值（可能为"drama" / "都市情感" / 空）
 * @param {string[]} auxHints                 辅助文本（title、extraConstraints 列表、artStyle 等）
 * @returns {string}  始终返回 GENRE_ENUM 中的一个
 */
function coerceGenreEnum(raw, auxHints) {
  const rawStr = typeof raw === 'string' ? raw.trim() : '';

  if (rawStr && GENRE_ENUM.includes(rawStr)) {
    return rawStr;
  }

  // 扫描 raw + 辅助文本，命中关键词返回对应枚举
  const haystack = [rawStr, ...auxHints.filter((x) => typeof x === 'string')]
    .filter((s) => s && s.length > 0)
    .join(' | ');

  for (const { enum: target, patterns } of GENRE_KEYWORD_MAP) {
    for (const re of patterns) {
      if (re.test(haystack)) {
        return target;
      }
    }
  }

  return 'general';
}

/**
 * v5.0-rev4 · 把 meta.parsed_brief.genre / meta.genre / meta.video.genre_hint 三处统一
 * 收敛到 5 元枚举之一，并返回最终值（用于下游软门判断）。
 *
 * 统一策略：
 *   - 以 `parsed_brief.genre` 为主；若它不在白名单内，按 coerceGenreEnum 归位；
 *   - 把归位结果同时写入 `meta.genre`、`meta.video.genre_hint` 与 `parsed_brief.genre`；
 *   - 若原来三者里有合法值就保留该值（避免 LLM 填对了但 parsed_brief 空的情况被覆盖）。
 *
 * @param {Record<string, unknown>} meta  appendix.meta（canonical）
 * @returns {string}  归位后的最终 genre 枚举值
 */
function normalizeGenreEnum(meta) {
  const pb =
    meta.parsed_brief && typeof meta.parsed_brief === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.parsed_brief)
      : null;
  const video =
    meta.video && typeof meta.video === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.video)
      : null;

  const candidates = [
    pb && typeof pb.genre === 'string' ? pb.genre : null,
    typeof meta.genre === 'string' ? meta.genre : null,
    video && typeof video.genre_hint === 'string' ? video.genre_hint : null,
  ];

  // 找第一个已经在白名单内的值；没有则对首个非空值做归位
  let finalGenre = candidates.find((v) => typeof v === 'string' && GENRE_ENUM.includes(v));
  if (!finalGenre) {
    const firstRaw = candidates.find((v) => typeof v === 'string' && v.trim().length > 0) || '';
    const auxHints = /** @type {string[]} */ ([]);
    if (pb) {
      if (Array.isArray(pb.extraConstraints)) {
        for (const ec of pb.extraConstraints) {
          if (typeof ec === 'string') auxHints.push(ec);
        }
      }
      if (typeof pb.artStyle === 'string') auxHints.push(pb.artStyle);
      if (typeof pb.renderingStyle === 'string') auxHints.push(pb.renderingStyle);
    }
    if (typeof meta.title === 'string') auxHints.push(meta.title);
    finalGenre = coerceGenreEnum(firstRaw, auxHints);
  }

  // 回写三处
  if (pb) pb.genre = finalGenre;
  meta.genre = finalGenre;
  if (video) video.genre_hint = finalGenre;

  return finalGenre;
}

/**
 * v5.0-rev5 · brief 镜头数字硬锚防御（F5）。
 *
 * 当 `directorBrief` 里明写具体镜头数（如 "35 个镜头左右" / "60 镜" / "镜头 60 左右"）时：
 *   1. 从 `parsed_brief.extraConstraints` 与 `parsed_brief.directorBrief` 全文抽取 N_user（首个命中）；
 *   2. 计算允许区间 `[round(N*0.85), round(N*1.15)]`；
 *   3. 若 LLM 推理的 `target_shot_count_range` 与允许区间**无交集**，视为严重违规 → 强制收窄覆盖；
 *   4. 若 LLM 已自填 `meta.target_shot_count.target` 且越界，同步收窄 target 与 tolerance。
 *
 * 命中即追加 `routing_warnings`（code=`target_shot_count_anchor_drift`），但不阻塞 pipeline。
 * 设计意图：保留 Scheme B 的 LLM 主权，只在 LLM 自由发挥大幅偏离 brief 数字时托底。
 *
 * @param {Record<string, unknown>} meta
 * @param {Array<Record<string, unknown>>} warnings  appendix.meta.routing_warnings（会被 push）
 */
function coerceBriefShotCountAnchor(meta, warnings) {
  const pb =
    meta.parsed_brief && typeof meta.parsed_brief === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.parsed_brief)
      : null;
  if (!pb) return;

  // ── 1. 收集 brief 相关文本片段 ──
  /** @type {string[]} */
  const chunks = [];
  if (Array.isArray(pb.extraConstraints)) {
    for (const c of pb.extraConstraints) {
      if (typeof c === 'string') chunks.push(c);
    }
  }
  if (typeof pb.directorBrief === 'string') chunks.push(pb.directorBrief);
  const combined = chunks.join('\n');
  if (!combined) return;

  // ── 2. 正则匹配「N 个镜头 / N 镜」，排除「X 秒 / X 分」等误伤 ──
  const m = combined.match(/(\d+)\s*(?:个)?\s*(?:镜头|镜)(?!\s*\/|\s*秒|\s*分)/);
  if (!m) return;
  const nUser = Number(m[1]);
  if (!Number.isFinite(nUser) || nUser < 10 || nUser > 300) return;

  const lo = Math.round(nUser * 0.85);
  const hi = Math.round(nUser * 1.15);

  // ── 3. 比较 LLM 推理的 target_shot_count_range ──
  const rng = pb.target_shot_count_range;
  if (!Array.isArray(rng) || rng.length !== 2) return;
  const lo0 = Number(rng[0]);
  const hi0 = Number(rng[1]);
  if (!Number.isFinite(lo0) || !Number.isFinite(hi0)) return;

  const hasOverlap = !(hi0 < lo || lo0 > hi);
  if (hasOverlap) return; // LLM 推理至少部分落入允许区间，放行

  // ── 4. 完全偏离 → 强制收窄覆盖 + 写 warn ──
  warnings.push({
    code: 'target_shot_count_anchor_drift',
    severity: 'warn',
    message: `LLM 推理的 target_shot_count_range=[${lo0}, ${hi0}] 与 brief 明写的 "${nUser} 个镜头" 允许区间 [${lo}, ${hi}] 无交集；编排层按 ±15% 收窄覆盖`,
    llm_value: [lo0, hi0],
    brief_anchor: nUser,
    coerced_range: [lo, hi],
  });
  pb.target_shot_count_range = [lo, hi];

  // 若 LLM 自填 meta.target_shot_count.target 也越界，同步收窄
  const existing = meta.target_shot_count;
  if (existing && typeof existing === 'object') {
    const r = /** @type {Record<string, unknown>} */ (existing);
    const t = typeof r.target === 'number' ? r.target : 0;
    if (t > 0 && (t < lo || t > hi)) {
      r.target = nUser;
      r.tolerance = [lo, hi];
      // avg_shot_duration_sec 让 deriveShotBudgets 按新 target 重算（若 meta 已存在会被 deriveShotBudgets 的 fromLlm 分支保留，所以这里不清）
    }
  }
}

/**
 * v5.0-rev5 · 字段名软兼容：`block_id` vs `id`。
 *
 * 历史背景：v5 prompt §III 早期示例误写成 `"id": "B01"`，部分 LLM 模型会严格按示例输出。
 * schema 冻结文档与 normalize 下游统一以 `block_id` 为准；本函数在入口处做一次迁移兼容：
 *   - `block_id` 存在且合法（形如 `B\d+`） → 原样保留；
 *   - `block_id` 缺失但 `id` 合法 → 提升 `id` 为 `block_id`，并移除 `id` 以避免下游歧义；
 *   - 两者都缺失或非法 → 保持现状，交给后续 skeleton_integrity_check 捕获。
 *
 * @param {Record<string, unknown>} block  单条 block_index
 */
function coerceBlockIdField(block) {
  const BLOCK_ID_RE = /^B\d+$/;
  const raw = block.block_id;
  const rawId = block.id;
  if (typeof raw === 'string' && BLOCK_ID_RE.test(raw)) {
    if (typeof rawId === 'string' && rawId === raw) delete block.id;
    return;
  }
  if (typeof rawId === 'string' && BLOCK_ID_RE.test(rawId)) {
    block.block_id = rawId;
    delete block.id;
  }
}

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
 * v5.0-rev3 · Scheme B 兜底默认：
 *   当 LLM / brief 完全没给镜头数线索时，以"2 秒/镜"作为保守默认（120s → 60 镜），
 *   比原来的 "4 秒/镜"（120s → 30 镜，偏稀疏）更贴近真人短剧节奏。
 */
const FALLBACK_AVG_SHOT_DURATION_SEC = 2;

/**
 * 解析出 (targetShotCount, avgShotDuration)。
 *
 * v5.0-rev3 · Scheme B 改造 · 2026-04-17：
 *   - **删除路径「options.workflowControls」**（prepare 层已不再生成此字段）；
 *   - **新增路径 0**：若 LLM 自填了 `meta.target_shot_count.{target, avg_shot_duration_sec}`
 *     则直接采信，不再覆盖（让 LLM 保留权威）；
 *   - **保留 parsed_brief 路径**：兼容 `target_shot_count_range: [lo, hi]`（v5 新格式）
 *     与 `episodeShotCount: N`（v4 兼容格式）。
 *
 * 解析优先级（从高到低）：
 *   0. meta.target_shot_count（LLM 自填；最高权威）
 *   1. meta.parsed_brief.target_shot_count_range 取中点
 *   2. meta.parsed_brief.episodeShotCount（v4 单值）
 *   3. meta.video.target_duration_sec / FALLBACK_AVG_SHOT_DURATION_SEC
 *   4. 放弃派生（返回 null）
 *
 * @param {Record<string, unknown>} meta
 * @returns {{ target: number, avgShotDuration: number, fromLlm?: boolean } | null}
 */
function resolveShotBudgetInputs(meta) {
  // ── 路径 0：LLM 自填 meta.target_shot_count（最高权威） ──
  const existing = meta.target_shot_count;
  if (existing && typeof existing === 'object') {
    const r = /** @type {Record<string, unknown>} */ (existing);
    const t = typeof r.target === 'number' ? r.target : 0;
    const a = typeof r.avg_shot_duration_sec === 'number' ? r.avg_shot_duration_sec : 0;
    if (t > 0 && a > 0) {
      return { target: Math.round(t), avgShotDuration: a, fromLlm: true };
    }
  }

  // ── 路径 1/2：parsed_brief（LLM 从 directorBrief 自然语言解析的产物） ──
  const pb =
    meta.parsed_brief && typeof meta.parsed_brief === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.parsed_brief)
      : {};
  const dur =
    typeof pb.episode_duration_sec === 'number' && pb.episode_duration_sec > 0
      ? pb.episode_duration_sec
      : typeof pb.episodeDuration === 'number' && pb.episodeDuration > 0
        ? pb.episodeDuration
        : 0;

  // 路径 1：区间中点（v5 推荐）
  const rng = pb.target_shot_count_range;
  if (Array.isArray(rng) && rng.length === 2) {
    const lo = Number(rng[0]);
    const hi = Number(rng[1]);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi >= lo) {
      const mid = Math.round((lo + hi) / 2);
      if (mid > 0 && dur > 0) {
        return { target: mid, avgShotDuration: +(dur / mid).toFixed(2) };
      }
    }
  }

  // 路径 2：单值 episodeShotCount（v4 兼容）
  const singleShot =
    typeof pb.episodeShotCount === 'number' && pb.episodeShotCount > 0
      ? pb.episodeShotCount
      : typeof pb.target_shot_count === 'number' && pb.target_shot_count > 0
        ? pb.target_shot_count
        : 0;
  if (singleShot > 0 && dur > 0) {
    return { target: Math.round(singleShot), avgShotDuration: +(dur / singleShot).toFixed(2) };
  }

  // ── 路径 3：target_duration_sec / FALLBACK_AVG_SHOT_DURATION_SEC（保守回退） ──
  const video =
    meta.video && typeof meta.video === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.video)
      : {};
  const totalDur =
    typeof video.target_duration_sec === 'number' && video.target_duration_sec > 0
      ? video.target_duration_sec
      : typeof video.total_duration_sec === 'number' && video.total_duration_sec > 0
        ? video.total_duration_sec
        : dur;
  if (totalDur > 0) {
    return {
      target: Math.max(1, Math.round(totalDur / FALLBACK_AVG_SHOT_DURATION_SEC)),
      avgShotDuration: FALLBACK_AVG_SHOT_DURATION_SEC,
    };
  }

  return null;
}

/**
 * v5.0-rev3 · Scheme B：派生 meta.target_shot_count + block_index[i].shot_budget_hint。
 *
 * 关键变更：
 *   - 不再接收 workflowControls 参数（prepare 层已删）；
 *   - 输入源全部来自 LLM（自填 meta.target_shot_count）或 LLM-解析-后 brief（meta.parsed_brief）；
 *   - 若 LLM 已自填完整 meta.target_shot_count.{target, tolerance, avg_shot_duration_sec}，
 *     尊重其权威不覆盖；仅补齐缺失字段（如 tolerance）。
 *
 * @param {Record<string, unknown>} meta
 * @param {Array<Record<string, unknown>>} rows  appendix.block_index[]
 */
function deriveShotBudgets(meta, rows) {
  const inputs = resolveShotBudgetInputs(meta);
  if (!inputs) {
    return;
  }
  const { target, avgShotDuration, fromLlm } = inputs;

  /**
   * 片级 target_shot_count：
   *   - 若 LLM 自填了完整对象（含 tolerance），保留；仅当 tolerance 缺失时自动补齐 ±15%。
   *   - 否则用解析出的值构造完整对象。
   */
  const existing = meta.target_shot_count;
  if (fromLlm && existing && typeof existing === 'object') {
    const r = /** @type {Record<string, unknown>} */ (existing);
    if (!Array.isArray(r.tolerance) || r.tolerance.length !== 2) {
      const delta = Math.max(2, Math.ceil(target * TOTAL_SHOT_TOLERANCE_RATIO));
      r.tolerance = [Math.max(1, target - delta), target + delta];
    }
  } else {
    const delta = Math.max(2, Math.ceil(target * TOTAL_SHOT_TOLERANCE_RATIO));
    meta.target_shot_count = {
      target,
      tolerance: [Math.max(1, target - delta), target + delta],
      avg_shot_duration_sec: avgShotDuration,
    };
  }

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
 * v5.0-rev3 · Scheme B 改造：options 不再接收 workflowControls；镜头预算推导链路：
 *   meta.target_shot_count（LLM 自填） > meta.parsed_brief（LLM 解析 brief） > meta.video（兜底）
 *
 * @param {unknown} parsed
 * @param {{}} [_options]  预留参数对象（当前无字段；保留签名供未来扩展）
 * @returns {unknown}
 */
export function normalizeEditMapSd2V5(parsed, _options = {}) {
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
        coerceBlockIdField(r);
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
    // v5.0-rev5：先初始化 routing_warnings，让后续所有校验（含 brief anchor 防御）可以 push
    if (!Array.isArray(appendixMeta.routing_warnings)) {
      appendixMeta.routing_warnings = [];
    }
    const warningsRef = /** @type {Array<Record<string, unknown>>} */ (appendixMeta.routing_warnings);

    // v5.0-rev4：先收敛 genre 到 5 元枚举（后续软门判断依赖 genre_hint）
    normalizeGenreEnum(appendixMeta);

    // v5.0-rev5：brief 明写镜头数字时，硬收窄 LLM 推理出界的 target_shot_count_range
    //   详见 1_EditMap-SD2-v5.md §0.0 "target_shot_count_range 推理规则（硬口径）"
    coerceBriefShotCountAnchor(appendixMeta, warningsRef);

    deriveShotBudgets(appendixMeta, rows);

    // v5.0 治本 · S10/S11：EditMap 侧语义软门校验（纯数据交叉比对，无 LLM 调用）
    //   详见 07_v5-schema-冻结.md §7.10 / §7.11；06_v5-验收清单 §1.2
    checkSatisfactionSubject(appendixMeta, warningsRef);
    checkProofLadderCoverage(appendixMeta, rows, warningsRef);

    // obj.meta 与 appendix.meta 是两份引用；若都存在则同步 target_shot_count / routing_warnings / genre
    if (rawTopMeta && typeof rawTopMeta === 'object' && rawTopMeta !== appendixMeta) {
      const topMeta = /** @type {Record<string, unknown>} */ (rawTopMeta);
      topMeta.target_shot_count = appendixMeta.target_shot_count;
      topMeta.routing_warnings = appendixMeta.routing_warnings;
      if (typeof appendixMeta.genre === 'string') topMeta.genre = appendixMeta.genre;
      if (
        appendixMeta.video &&
        typeof appendixMeta.video === 'object' &&
        topMeta.video &&
        typeof topMeta.video === 'object'
      ) {
        const topVideo = /** @type {Record<string, unknown>} */ (topMeta.video);
        const apxVideo = /** @type {Record<string, unknown>} */ (appendixMeta.video);
        if (typeof apxVideo.genre_hint === 'string') topVideo.genre_hint = apxVideo.genre_hint;
      }
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
 * v5.0 治本 · S11：`proof_ladder_coverage_check`（07 §7.11 · v5.0-rev4 调整）
 *
 * 阈值调整（v5.0-rev4）：
 *   - 覆盖率阈值从 0.6 下调到 **0.5**（实战：医疗情感剧不可能每块都摆证据）；
 *   - "跳过条件"从 `genre_hint == non_mystery` 统一到 **5 元白名单**：
 *     `sweet_romance` 与 `fantasy` 视作 non_mystery 跳过覆盖率校验；
 *     `revenge` / `suspense` / `general` 仍需校验（其中 general 门槛略低）。
 *
 * @param {Record<string, unknown>} meta             appendix.meta
 * @param {Array<Record<string, unknown>>} blocks    appendix.block_index[]
 * @param {Array<Record<string, unknown>>} warnings  appendixMeta.routing_warnings
 */
function checkProofLadderCoverage(meta, blocks, warnings) {
  // 题材例外：sweet_romance / fantasy / 旧口径 non_mystery 跳过
  const video =
    meta.video && typeof meta.video === 'object' ? /** @type {Record<string, unknown>} */ (meta.video) : null;
  const genre = video && typeof video.genre_hint === 'string' ? video.genre_hint : null;
  const NON_MYSTERY_GENRES = new Set(['non_mystery', 'sweet_romance', 'fantasy']);
  if (genre !== null && NON_MYSTERY_GENRES.has(genre)) return;

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

  // 覆盖率门槛（v5.0-rev4）：≥ ceil(N × 0.5)
  //   - 旧口径 0.6 对医疗情感、家庭伦理这类"并非每块都摆证据"的剧型过于苛刻；
  //   - 0.5 的门槛在"至少半数 block 有证据"这个直觉下仍具判别力。
  const COVERAGE_MIN_RATIO = 0.5;
  const minCovered = Math.ceil(totalBlocks * COVERAGE_MIN_RATIO);
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
        ratio: `>= ${COVERAGE_MIN_RATIO}`,
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
