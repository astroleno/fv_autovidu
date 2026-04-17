/**
 * SD2 v5 知识切片加载器（injection_map.yaml v2.0 专用）。
 *
 * 与 v4 的核心差异：
 *   1. match 字段从 `structural_tags` / `scene_bucket` 升级为 canonical routing：
 *      - `structural.any_of`     ← block_index[i].routing.structural[]
 *      - `satisfaction.any_of`   ← block_index[i].routing.satisfaction[]
 *      - `psychology_group.any_of` ← block_index[i].routing.psychology_group（派生字段）
 *      - `shot_hint.any_of`      ← block_index[i].routing.shot_hint[]
 *      - `paywall_level.equals`  ← block_index[i].routing.paywall_level
 *      - `aspect_ratio.equals`   ← meta.video.aspect_ratio（Prompter 侧专用）
 *   2. 新增 `psychology_group` 派生：编排层扫描 meta.psychology_plan[] 按 block_id 映射 group，
 *      回填到 block_index[i].routing.psychology_group（LLM 不感知，只给切片路由用）。
 *   3. 新增 `overflow_policy`：若 (always + conditional) 总估算 token 超过
 *      rules.max_total_tokens_per_consumer.<director|prompter>，按 priority 从大到小
 *      裁剪 conditional 切片，被裁切片记录到 routing_trace[].truncated。
 *   4. 输出 `routing_trace` 条目（含 applied[]、truncated[]）供编排层写入 meta.routing_trace。
 *
 * 注意：为了保留 v4 行为独立，本文件不修改 lib/knowledge_slices.mjs，只新开并行模块。
 *
 * 契约源：
 *   - prompt/1_SD2Workflow/4_KnowledgeSlices/injection_map.yaml (v2.0)
 *   - prompt/1_SD2Workflow/docs/v5/07_v5-schema-冻结.md
 *   - prompt/1_SD2Workflow/docs/v5/02_v5-路由与切片扩展.md
 */
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

/**
 * v5.0 HOTFIX：psychology_group canonical 合法槽（切片路由唯一依据）。
 * 与 07_v5-schema-冻结.md §五 `psychology_group` 保持一致。
 */
export const PSYCHOLOGY_GROUP_CANONICAL = Object.freeze([
  'hook',
  'retention',
  'payoff',
  'bonding',
  'relationship',
  'conversion',
]);

/**
 * v5.0 HOTFIX：LLM 自由词 → canonical 合法槽 的同义词兜底表。
 * 契约源：07_v5-schema-冻结.md §五 `psychology_group_synonym_map`。
 *
 * 策略：宽松。EditMap LLM 允许写自由词，pipeline 用这张表兜底到 6 个合法槽，
 * 未命中的写 `severity: warn` 告警（不注入 psychology 切片）。
 */
export const PSYCHOLOGY_GROUP_SYNONYM_MAP = Object.freeze({
  // → hook
  opening: 'hook',
  cold_open: 'hook',
  attention: 'hook',
  intro: 'hook',
  setup: 'hook',

  // → retention
  pressure: 'retention',
  stakes: 'retention',
  tension: 'retention',
  suspense: 'retention',
  curiosity: 'retention',
  masking: 'retention',
  concealment: 'retention',
  anticipation: 'retention',

  // → payoff
  reversal: 'payoff',
  twist: 'payoff',
  revelation: 'payoff',
  catharsis: 'payoff',
  release: 'payoff',
  climax: 'payoff',
  resolution: 'payoff',

  // → bonding
  emotion: 'bonding',
  empathy: 'bonding',
  vulnerability: 'bonding',
  intimacy: 'bonding',
  warmth: 'bonding',

  // → relationship
  conflict: 'relationship',
  power_dynamic: 'relationship',
  confrontation: 'relationship',
  alliance: 'relationship',
  rivalry: 'relationship',

  // → conversion
  cliff: 'conversion',
  cliffhanger: 'conversion',
  cta: 'conversion',
  hook_next: 'conversion',
});

/**
 * 把任意字符串（LLM 自由写入的 psychology group）解析到 canonical 合法槽。
 *
 * 返回值 source 语义：
 *   - `canonical`：输入已是 6 个合法词之一；直接返回；不告警。
 *   - `synonym`  ：输入命中 synonym_map；返回映射后的合法词；写 info 级告警。
 *   - `none`     ：输入为空或未命中；返回 ''；写 warn 级告警（不注入 psychology 切片）。
 *
 * @param {unknown} raw
 * @returns {{ canonical: string, source: 'canonical'|'synonym'|'none' }}
 */
export function resolvePsychologyGroup(raw) {
  const lc = String(raw ?? '').trim().toLowerCase();
  if (!lc) {
    return { canonical: '', source: 'none' };
  }
  if (PSYCHOLOGY_GROUP_CANONICAL.includes(lc)) {
    return { canonical: lc, source: 'canonical' };
  }
  const mapped = /** @type {Record<string, string>} */ (PSYCHOLOGY_GROUP_SYNONYM_MAP)[lc];
  if (typeof mapped === 'string' && mapped) {
    return { canonical: mapped, source: 'synonym' };
  }
  return { canonical: '', source: 'none' };
}

/**
 * @typedef {Object} SliceEntry
 * @property {string} slice_id
 * @property {string} path
 * @property {number} max_tokens
 * @property {number} priority
 * @property {Record<string, unknown>} [match]
 */

/**
 * @typedef {Object} AppliedRecord
 * @property {string} slice_id
 * @property {number} tokens    估算 token 数（取 max_tokens 声明值）
 * @property {string} from      "director.always" | "director.conditional" | "prompter.always" | ...
 */

/**
 * @typedef {Object} TruncatedRecord
 * @property {string} slice_id
 * @property {number} tokens
 * @property {string} reason   "budget_exceeded"
 */

/**
 * @typedef {Object} SliceLoadResult
 * @property {string[]} slices          切片正文数组，按 priority 排序后注入
 * @property {AppliedRecord[]} applied  被采用的切片记录（按采用顺序）
 * @property {TruncatedRecord[]} truncated  被裁掉的切片记录（overflow）
 * @property {number} total_tokens      applied 的 token 总和
 * @property {number} budget            该 consumer 的总预算
 */

/**
 * 读取 injection_map.yaml（v2.0）
 * @param {string} slicesRoot  4_KnowledgeSlices 目录绝对路径
 * @returns {Record<string, unknown>}
 */
function loadInjectionConfig(slicesRoot) {
  const mapPath = path.join(slicesRoot, 'injection_map.yaml');
  if (!fs.existsSync(mapPath)) {
    console.warn(`[knowledge_slices_v5] 未找到 ${mapPath}，不注入切片`);
    return {};
  }
  const raw = fs.readFileSync(mapPath, 'utf8');
  return /** @type {Record<string, unknown>} */ (parseYaml(raw));
}

/**
 * 读取单份切片文件为字符串；文件缺失返回空串并警告。
 * @param {SliceEntry} entry
 * @param {string} slicesRoot
 * @returns {string}
 */
function readSliceText(entry, slicesRoot) {
  const p = entry.path;
  if (typeof p !== 'string' || !p.trim()) {
    return '';
  }
  const abs = path.join(slicesRoot, p.trim());
  if (!fs.existsSync(abs)) {
    console.warn(`[knowledge_slices_v5] 切片文件不存在，跳过: ${abs}`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

/**
 * 从 YAML 的 entry 对象里安全解出 SliceEntry。
 * @param {unknown} raw
 * @returns {SliceEntry|null}
 */
function toSliceEntry(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof r.slice_id === 'string' ? r.slice_id : '';
  const p = typeof r.path === 'string' ? r.path : '';
  if (!id || !p) {
    return null;
  }
  const mt = typeof r.max_tokens === 'number' ? r.max_tokens : 0;
  const pr = typeof r.priority === 'number' ? r.priority : 999;
  const match =
    r.match && typeof r.match === 'object'
      ? /** @type {Record<string, unknown>} */ (r.match)
      : undefined;
  return { slice_id: id, path: p, max_tokens: mt, priority: pr, match };
}

/**
 * @typedef {Object} PsychologyGroupResolution
 * @property {string} block_id      块号
 * @property {string} raw           EditMap 原始写入值（可能是自由词）
 * @property {string} canonical     映射后的合法槽；`none` 时为空串
 * @property {'canonical'|'synonym'|'none'} source  分类
 */

/**
 * 编排层派生：把 meta.psychology_plan[] 按 block_id 反查出 group，
 * 通过 `resolvePsychologyGroup` 规范化到 canonical 合法槽后，
 * 回填到 block_index[i].routing.psychology_group（v5.0 HOTFIX：同义词兜底）。
 *
 * - 若 routing.psychology_group 已存在且非空，也会**重算**以统一口径（LLM 可能写了自由词）。
 * - 源数据优先顺序：`psychology_plan[].block_id` → 若 block_id 缺失则回退 `id`。
 * - 返回 resolutions[]：每 block 一条，供上游写入 `meta.routing_warnings[]`。
 *
 * @param {unknown} editMap  完整 EditMap（含 meta.psychology_plan、appendix.block_index）
 * @returns {PsychologyGroupResolution[]}  resolution 事件列表（canonical 的也包含，便于对账）
 */
export function derivePsychologyGroupOnBlocks(editMap) {
  if (!editMap || typeof editMap !== 'object') {
    return [];
  }
  const em = /** @type {Record<string, unknown>} */ (editMap);
  const meta =
    em.meta && typeof em.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (em.meta)
      : {};
  const appendix =
    em.appendix && typeof em.appendix === 'object'
      ? /** @type {Record<string, unknown>} */ (em.appendix)
      : {};

  // psychology_plan 可能位于 meta 或 appendix.meta，两处都扫一下
  const appendixMeta =
    appendix.meta && typeof appendix.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (appendix.meta)
      : {};
  const planRaw = Array.isArray(meta.psychology_plan)
    ? meta.psychology_plan
    : Array.isArray(appendixMeta.psychology_plan)
      ? appendixMeta.psychology_plan
      : [];

  /** @type {Map<string, string>} */
  const blockIdToRawGroup = new Map();
  for (const item of planRaw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const it = /** @type {Record<string, unknown>} */ (item);
    const bid =
      typeof it.block_id === 'string' && it.block_id
        ? it.block_id
        : typeof it.id === 'string'
          ? it.id
          : '';
    const grp = typeof it.group === 'string' ? it.group : '';
    if (bid && grp) {
      blockIdToRawGroup.set(bid, grp);
    }
  }

  const rows = Array.isArray(appendix.block_index) ? appendix.block_index : [];
  /** @type {PsychologyGroupResolution[]} */
  const resolutions = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const r = /** @type {Record<string, unknown>} */ (row);
    const bid =
      typeof r.block_id === 'string' && r.block_id
        ? r.block_id
        : typeof r.id === 'string'
          ? r.id
          : '';
    if (!bid) {
      continue;
    }

    const routing =
      r.routing && typeof r.routing === 'object'
        ? /** @type {Record<string, unknown>} */ (r.routing)
        : {};

    // 候选 raw：plan 里的 group（优先）→ routing 上已有的 psychology_group（LLM 自己直写的情况）
    const planRawGroup = blockIdToRawGroup.get(bid) || '';
    const existing =
      typeof routing.psychology_group === 'string' ? routing.psychology_group : '';
    const rawGroup = planRawGroup || existing;

    const { canonical, source } = resolvePsychologyGroup(rawGroup);
    routing.psychology_group = canonical; // 空串也写入，避免沿用非法旧值
    r.routing = routing;

    resolutions.push({ block_id: bid, raw: String(rawGroup || ''), canonical, source });
  }

  return resolutions;
}

/**
 * 判断条件是否命中。支持三种匹配类型：
 *   - `{ any_of: [...] }` —— 字段（数组或字符串）与任一值相交即命中
 *   - `{ equals: "x" }`   —— 字段值必须严格等于 x
 *   - 其它形态统一视为未命中
 *
 * 可匹配字段（左边键名由 YAML 决定）：
 *   - routing.*：structural / satisfaction / psychology_group / shot_hint / paywall_level
 *   - meta.video.aspect_ratio（专供 Prompter）
 *
 * @param {Record<string, unknown>} matchObj  YAML 的 match 子对象
 * @param {Record<string, unknown>} routing   block_index[i].routing（含派生 psychology_group）
 * @param {string} aspectRatio                meta.video.aspect_ratio
 * @returns {boolean}
 */
function matchSliceConditions(matchObj, routing, aspectRatio) {
  if (!matchObj || typeof matchObj !== 'object') {
    return true;
  }

  for (const key of Object.keys(matchObj)) {
    const rule = /** @type {Record<string, unknown>} */ (matchObj[key]);

    // 定位匹配源
    /** @type {unknown} */
    let source = null;
    if (key === 'aspect_ratio') {
      source = aspectRatio;
    } else if (key === 'psychology_group') {
      source = routing.psychology_group;
    } else {
      // 其余键（structural / satisfaction / shot_hint / paywall_level）均从 routing 取同名字段
      source = routing[key];
    }

    // equals 模式
    if (rule && typeof rule === 'object' && 'equals' in rule) {
      const want = String((/** @type {{ equals: unknown }} */ (rule)).equals);
      const got = typeof source === 'string' ? source : '';
      if (got !== want) {
        return false;
      }
      continue;
    }

    // any_of 模式
    if (rule && typeof rule === 'object' && 'any_of' in rule) {
      const anyOf = Array.isArray((/** @type {{ any_of: unknown }} */ (rule)).any_of)
        ? /** @type {unknown[]} */ ((/** @type {{ any_of: unknown[] }} */ (rule)).any_of).map(String)
        : [];
      const srcArr = Array.isArray(source)
        ? source.map((x) => String(x))
        : typeof source === 'string' && source
          ? [source]
          : [];
      const hit = anyOf.some((t) => srcArr.includes(t));
      if (!hit) {
        return false;
      }
      continue;
    }

    // 不认识的规则直接判未命中，避免误注入
    return false;
  }
  return true;
}

/**
 * 读取某个 consumer（director / prompter）的全部切片入口，筛选出被路由命中的 conditional，
 * 再叠加 always，按 priority 升序排序。
 *
 * @param {Record<string, unknown>} config        injection_map.yaml 解析结果
 * @param {'director'|'prompter'} consumer
 * @param {Record<string, unknown>} routing       block_index[i].routing
 * @param {string} aspectRatio                    meta.video.aspect_ratio
 * @returns {Array<SliceEntry & { _bucket: 'always'|'conditional' }>}
 */
function gatherMatchedEntries(config, consumer, routing, aspectRatio) {
  const section = config[consumer];
  if (!section || typeof section !== 'object') {
    return [];
  }
  const sec = /** @type {{ always?: unknown[], conditional?: unknown[] }} */ (section);

  /** @type {Array<SliceEntry & { _bucket: 'always'|'conditional' }>} */
  const out = [];

  for (const raw of Array.isArray(sec.always) ? sec.always : []) {
    const entry = toSliceEntry(raw);
    if (entry) {
      out.push({ ...entry, _bucket: 'always' });
    }
  }

  for (const raw of Array.isArray(sec.conditional) ? sec.conditional : []) {
    const entry = toSliceEntry(raw);
    if (!entry) {
      continue;
    }
    const m = entry.match || {};
    if (matchSliceConditions(m, routing, aspectRatio)) {
      out.push({ ...entry, _bucket: 'conditional' });
    }
  }

  /**
   * 排序：always 优先于 conditional；同 bucket 内 priority 越小越优先。
   * 这与 YAML rules.priority_order: "always_first_then_by_priority_asc" 对齐。
   */
  out.sort((a, b) => {
    if (a._bucket !== b._bucket) {
      return a._bucket === 'always' ? -1 : 1;
    }
    return (a.priority ?? 999) - (b.priority ?? 999);
  });

  return out;
}

/**
 * 按 overflow_policy 的 `drop_low_priority_conditional_first` 策略裁剪：
 *   - always 不裁；
 *   - 总预算超限时，从 conditional 里 priority 大的开始裁（后者优先级更低）；
 *   - 裁剪后仍超限就继续裁。
 *
 * @param {Array<SliceEntry & { _bucket: 'always'|'conditional' }>} entries   已排序的候选
 * @param {number} budget  max_total_tokens_per_consumer
 * @returns {{ kept: typeof entries, dropped: typeof entries }}
 */
function applyOverflowPolicy(entries, budget) {
  if (budget <= 0) {
    return { kept: entries, dropped: [] };
  }
  /** @type {typeof entries} */
  const kept = [];
  /** @type {typeof entries} */
  const dropped = [];

  // 先把 always 全部纳入（它们的预算是 "地板线"，即便超也留下）
  let used = 0;
  for (const e of entries) {
    if (e._bucket === 'always') {
      kept.push(e);
      used += e.max_tokens || 0;
    }
  }

  // 再按优先级升序把 conditional 能塞则塞
  /** @type {typeof entries} */
  const conditional = entries.filter((x) => x._bucket === 'conditional');
  for (const e of conditional) {
    const tk = e.max_tokens || 0;
    if (used + tk <= budget) {
      kept.push(e);
      used += tk;
    } else {
      dropped.push(e);
    }
  }

  // 保持 always 在前 + 原排序不变
  kept.sort((a, b) => {
    if (a._bucket !== b._bucket) {
      return a._bucket === 'always' ? -1 : 1;
    }
    return (a.priority ?? 999) - (b.priority ?? 999);
  });
  return { kept, dropped };
}

/**
 * 对外主入口：给定 consumer + 某 block 的 routing + 全局 aspect_ratio，返回注入切片及审计记录。
 *
 * @param {Object} opts
 * @param {'director'|'prompter'} opts.consumer
 * @param {Record<string, unknown>} opts.routing         block_index[i].routing（已派生 psychology_group）
 * @param {string} opts.aspectRatio                      meta.video.aspect_ratio
 * @param {string} opts.slicesRoot                        4_KnowledgeSlices 目录绝对路径
 * @returns {SliceLoadResult}
 */
export function loadKnowledgeSlicesV5({ consumer, routing, aspectRatio, slicesRoot }) {
  const config = loadInjectionConfig(slicesRoot);

  // 取预算
  const rules =
    config.rules && typeof config.rules === 'object'
      ? /** @type {Record<string, unknown>} */ (config.rules)
      : {};
  const budgetsObj =
    rules.max_total_tokens_per_consumer && typeof rules.max_total_tokens_per_consumer === 'object'
      ? /** @type {Record<string, unknown>} */ (rules.max_total_tokens_per_consumer)
      : {};
  const budget =
    typeof budgetsObj[consumer] === 'number'
      ? /** @type {number} */ (budgetsObj[consumer])
      : consumer === 'director'
        ? 3000
        : 2000;

  // 匹配 + 排序 + overflow
  const entries = gatherMatchedEntries(config, consumer, routing, aspectRatio);
  const { kept, dropped } = applyOverflowPolicy(entries, budget);

  // 读取正文 + 生成 applied / truncated 记录
  /** @type {string[]} */
  const slices = [];
  /** @type {AppliedRecord[]} */
  const applied = [];
  let totalTokens = 0;
  for (const e of kept) {
    const text = readSliceText(e, slicesRoot);
    if (!text) {
      continue;
    }
    slices.push(text);
    applied.push({
      slice_id: e.slice_id,
      tokens: e.max_tokens || 0,
      from: `${consumer}.${e._bucket}`,
    });
    totalTokens += e.max_tokens || 0;
  }

  /** @type {TruncatedRecord[]} */
  const truncated = dropped.map((e) => ({
    slice_id: e.slice_id,
    tokens: e.max_tokens || 0,
    reason: 'budget_exceeded',
  }));

  return { slices, applied, truncated, total_tokens: totalTokens, budget };
}

/**
 * 把切片拼到系统提示词末尾（与 v4 行为一致）。
 * 合同：注入在 system prompt 末尾，用 "## 编排层注入" 一级分隔标题包裹。
 *
 * @param {string} baseSystemPrompt
 * @param {string[]} slices
 * @returns {string}
 */
export function appendKnowledgeSlicesToSystemPrompt(baseSystemPrompt, slices) {
  if (!slices.length) {
    return baseSystemPrompt;
  }
  const body = slices
    .map((s, i) => `### 注入切片 ${i + 1}\n\n${s.trim()}`)
    .join('\n\n---\n\n');
  return `${baseSystemPrompt.trim()}\n\n---\n\n## 编排层注入：知识切片（knowledgeSlices · v5）\n\n${body}\n`;
}

/**
 * 供 user JSON 使用：避免与 system 内切片重复，可从 payload 中剔除 knowledgeSlices。
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
export function omitKnowledgeSlicesFromPayload(payload) {
  const { knowledgeSlices: _ks, ...rest } = payload;
  return rest;
}

/**
 * 从 block_index[i] 中安全取出 routing（含派生 psychology_group）；
 * 缺失则返回一个六字段默认对象，保证下游匹配逻辑不 NPE。
 *
 * @param {unknown} blockIndexRow
 * @returns {Record<string, unknown>}
 */
export function extractRoutingForBlock(blockIndexRow) {
  if (!blockIndexRow || typeof blockIndexRow !== 'object') {
    return {
      structural: [],
      satisfaction: [],
      psychology: [],
      psychology_group: '',
      shot_hint: [],
      paywall_level: 'none',
    };
  }
  const row = /** @type {Record<string, unknown>} */ (blockIndexRow);
  const r = row.routing && typeof row.routing === 'object'
    ? /** @type {Record<string, unknown>} */ (row.routing)
    : {};
  return {
    structural: Array.isArray(r.structural) ? r.structural : [],
    satisfaction: Array.isArray(r.satisfaction) ? r.satisfaction : [],
    psychology: Array.isArray(r.psychology) ? r.psychology : [],
    psychology_group: typeof r.psychology_group === 'string' ? r.psychology_group : '',
    shot_hint: Array.isArray(r.shot_hint) ? r.shot_hint : [],
    paywall_level: typeof r.paywall_level === 'string' ? r.paywall_level : 'none',
  };
}
