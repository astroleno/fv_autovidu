/**
 * SD2 v6 知识切片加载器（`injection_map.yaml` v2.1 专用）。
 *
 * 与 v5 的核心差异（仅限编排层路由扩展）：
 *   1. **新匹配键 `has_kva`**：`injection_map.yaml` v2.1 的 conditional 切片
 *      `v6_kva_examples` 使用 `has_kva.equals: true` 匹配。`has_kva` 是
 *      **编排层派生字段**，不在 EditMap schema 里；由本模块在 block 级派生：
 *        `has_kva = scriptChunk.key_visual_actions.length > 0`
 *      并通过 `loadKnowledgeSlicesV6(...)` 的 `hasKva` 入参传入，由 `matchSliceConditionsV6`
 *      在遇到 `has_kva` 键时专门分支匹配。
 *   2. **v6 新切片自动命中**：director 新增 2 份切片（`v6_segment_consumption_priority`
 *      无条件、`v6_kva_examples` 条件），本模块完整读取 injection_map v2.1 结构。
 *   3. **Director 预算上调**：v2.1 `max_total_tokens_per_consumer.director=3600`
 *      由 YAML 驱动，无需本模块额外处理（本模块只读 YAML 声明值）。
 *   4. **Psychology group 派生复用 v5**：v6 对心理学分组路由规则无调整，直接
 *      re-export v5 的 `derivePsychologyGroupOnBlocks`。
 *
 * 为什么不继承 v5：v5 的 `matchSliceConditions` 是 module-internal、遇到
 * 未知键直接判"未命中"，会把 `has_kva` 当成未知键拒绝。为避免侵入 v5，
 * v6 **完整独立实现**路由/匹配/overflow 逻辑，但功能逻辑与 v5 保持一致
 * （structural / satisfaction / psychology_group / shot_hint / paywall_level /
 *   aspect_ratio / has_kva 七个匹配键）。
 *
 * 契约源：
 *   - `prompt/1_SD2Workflow/4_KnowledgeSlices/injection_map.yaml` (v2.1)
 *   - `prompt/1_SD2Workflow/docs/v6/07_v6-schema-冻结.md` §3.2
 *   - `prompt/1_SD2Workflow/docs/v6/04_v6-并发链路剧本透传.md`
 *
 * 注意：本文件**不**修改 `knowledge_slices_v5.mjs`，v5 行为完全隔离。
 */
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

import {
  PSYCHOLOGY_GROUP_CANONICAL,
  PSYCHOLOGY_GROUP_SYNONYM_MAP,
  derivePsychologyGroupOnBlocks,
  resolvePsychologyGroup,
} from './knowledge_slices_v5.mjs';

export {
  PSYCHOLOGY_GROUP_CANONICAL,
  PSYCHOLOGY_GROUP_SYNONYM_MAP,
  derivePsychologyGroupOnBlocks,
  resolvePsychologyGroup,
};

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
 * @property {number} tokens   估算 token 数（取 YAML 声明的 max_tokens）
 * @property {string} from     "director.always" | "director.conditional" | "prompter.always" | ...
 */

/**
 * @typedef {Object} TruncatedRecord
 * @property {string} slice_id
 * @property {number} tokens
 * @property {string} reason   "budget_exceeded"
 */

/**
 * @typedef {Object} SliceLoadResultV6
 * @property {string[]} slices          切片正文数组（注入顺序）
 * @property {AppliedRecord[]} applied  采用记录
 * @property {TruncatedRecord[]} truncated  被 overflow 裁掉的记录
 * @property {number} total_tokens      applied token 总和（max_tokens 声明值之和）
 * @property {number} budget            本 consumer 总预算
 */

/**
 * 读取 `injection_map.yaml` v2.1。
 *
 * @param {string} slicesRoot  `4_KnowledgeSlices/` 目录绝对路径
 * @returns {Record<string, unknown>}
 */
function loadInjectionConfig(slicesRoot) {
  const mapPath = path.join(slicesRoot, 'injection_map.yaml');
  if (!fs.existsSync(mapPath)) {
    console.warn(`[knowledge_slices_v6] 未找到 ${mapPath}，不注入切片`);
    return {};
  }
  const raw = fs.readFileSync(mapPath, 'utf8');
  return /** @type {Record<string, unknown>} */ (parseYaml(raw));
}

/**
 * 读取单份切片正文；文件缺失返回空串并 warn。
 *
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
    console.warn(`[knowledge_slices_v6] 切片文件不存在，跳过: ${abs}`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8');
}

/**
 * 从 YAML entry 安全解出 SliceEntry。
 *
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
 * v6 匹配条件判断。支持 v5 的全部匹配键 + **新增 `has_kva.equals`**。
 *
 * 支持的匹配键：
 *   - routing.structural / satisfaction / psychology_group / shot_hint /
 *     paywall_level（来自 block_index[i].routing）
 *   - aspect_ratio（来自 meta.video.aspect_ratio，专供 Prompter）
 *   - **has_kva**（v6 新增，来自编排层 context.hasKva）
 *
 * 支持的匹配形态：
 *   - `{ any_of: [...] }` —— 字段（数组或字符串）与任一值相交即命中
 *   - `{ equals: "x" }` / `{ equals: true }` —— 严格等值
 *   - 其它形态统一视为未命中
 *
 * @param {Record<string, unknown>} matchObj
 * @param {Record<string, unknown>} routing   block_index[i].routing（含派生 psychology_group）
 * @param {string} aspectRatio                meta.video.aspect_ratio
 * @param {boolean} hasKva                    本 block 是否有 KVA（v6 派生）
 * @returns {boolean}
 */
function matchSliceConditionsV6(matchObj, routing, aspectRatio, hasKva) {
  if (!matchObj || typeof matchObj !== 'object') {
    return true;
  }

  for (const key of Object.keys(matchObj)) {
    const rule = /** @type {Record<string, unknown>} */ (matchObj[key]);

    /** @type {unknown} */
    let source = null;
    if (key === 'aspect_ratio') {
      source = aspectRatio;
    } else if (key === 'psychology_group') {
      source = routing.psychology_group;
    } else if (key === 'has_kva') {
      // v6 新增：编排层派生字段，走 context 通道
      source = hasKva;
    } else {
      // 其余键（structural / satisfaction / shot_hint / paywall_level）
      source = routing[key];
    }

    // equals 模式（v6 需区分 string / boolean，因 has_kva 是 boolean）
    if (rule && typeof rule === 'object' && 'equals' in rule) {
      const want = (/** @type {{ equals: unknown }} */ (rule)).equals;
      if (typeof want === 'boolean') {
        // boolean 等值（has_kva 专用）
        if (source !== want) {
          return false;
        }
      } else {
        const wantStr = String(want);
        const got = typeof source === 'string' ? source : '';
        if (got !== wantStr) {
          return false;
        }
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

    // 不认识的规则 → 未命中（避免误注入）
    return false;
  }
  return true;
}

/**
 * 汇总某 consumer 被路由命中的条目（always + conditional），按 priority 升序排序。
 *
 * @param {Record<string, unknown>} config
 * @param {'director'|'prompter'} consumer
 * @param {Record<string, unknown>} routing
 * @param {string} aspectRatio
 * @param {boolean} hasKva
 * @returns {Array<SliceEntry & { _bucket: 'always'|'conditional' }>}
 */
function gatherMatchedEntriesV6(config, consumer, routing, aspectRatio, hasKva) {
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
    if (matchSliceConditionsV6(m, routing, aspectRatio, hasKva)) {
      out.push({ ...entry, _bucket: 'conditional' });
    }
  }

  /** always 优先；同 bucket 内 priority 升序（与 v5 完全一致） */
  out.sort((a, b) => {
    if (a._bucket !== b._bucket) {
      return a._bucket === 'always' ? -1 : 1;
    }
    return (a.priority ?? 999) - (b.priority ?? 999);
  });

  return out;
}

/**
 * overflow_policy: `drop_low_priority_conditional_first`（与 v5 完全一致）。
 *   - always 不裁；
 *   - 超预算时从 conditional 里 priority 大的开始裁。
 *
 * @param {Array<SliceEntry & { _bucket: 'always'|'conditional' }>} entries
 * @param {number} budget
 */
function applyOverflowPolicy(entries, budget) {
  if (budget <= 0) {
    return { kept: entries, dropped: [] };
  }
  /** @type {typeof entries} */
  const kept = [];
  /** @type {typeof entries} */
  const dropped = [];

  let used = 0;
  for (const e of entries) {
    if (e._bucket === 'always') {
      kept.push(e);
      used += e.max_tokens || 0;
    }
  }

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

  kept.sort((a, b) => {
    if (a._bucket !== b._bucket) {
      return a._bucket === 'always' ? -1 : 1;
    }
    return (a.priority ?? 999) - (b.priority ?? 999);
  });
  return { kept, dropped };
}

/**
 * 对外主入口：给定 consumer + 某 block 的 routing + aspect_ratio + **has_kva**，
 * 返回注入切片及审计记录。
 *
 * @param {Object} opts
 * @param {'director'|'prompter'} opts.consumer
 * @param {Record<string, unknown>} opts.routing
 * @param {string} opts.aspectRatio
 * @param {boolean} opts.hasKva                v6 新增：本 block 是否有 KVA
 * @param {string} opts.slicesRoot
 * @returns {SliceLoadResultV6}
 */
export function loadKnowledgeSlicesV6({ consumer, routing, aspectRatio, hasKva, slicesRoot }) {
  const config = loadInjectionConfig(slicesRoot);

  // 取预算（v2.1: director=3600, prompter=2000）
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
        ? 3600
        : 2000;

  const entries = gatherMatchedEntriesV6(config, consumer, routing, aspectRatio, Boolean(hasKva));
  const { kept, dropped } = applyOverflowPolicy(entries, budget);

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
 * 把切片拼到系统提示词末尾（与 v5 行为一致，只把 v5 换成 v6 标识）。
 *
 * @param {string} baseSystemPrompt
 * @param {string[]} slices
 * @returns {string}
 */
export function appendKnowledgeSlicesToSystemPromptV6(baseSystemPrompt, slices) {
  if (!slices.length) {
    return baseSystemPrompt;
  }
  const body = slices
    .map((s, i) => `### 注入切片 ${i + 1}\n\n${s.trim()}`)
    .join('\n\n---\n\n');
  return `${baseSystemPrompt.trim()}\n\n---\n\n## 编排层注入：知识切片（knowledgeSlices · v6）\n\n${body}\n`;
}

/**
 * 供 user JSON 使用：避免与 system 内切片重复，可从 payload 中剔除 knowledgeSlices。
 *
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
export function omitKnowledgeSlicesFromPayloadV6(payload) {
  const { knowledgeSlices: _ks, ...rest } = payload;
  return rest;
}

/**
 * 从 block_index[i] 安全取出 routing（含派生 psychology_group）；
 * 缺失则返回六字段默认对象（与 v5 完全一致，保持下游字段访问不 NPE）。
 *
 * 说明：v6 没有往 routing 里加新字段（`has_kva` 走独立 context），此函数形态与 v5 相同。
 *
 * @param {unknown} blockIndexRow
 * @returns {Record<string, unknown>}
 */
export function extractRoutingForBlockV6(blockIndexRow) {
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

/**
 * v6 派生 `has_kva`：以 scriptChunk.key_visual_actions 是否非空为准。
 *
 * 入参是 `buildDirectorPayloadV6` / `buildPrompterPayloadV6` 构造的 `scriptChunk` 对象；
 * 缺失或 key_visual_actions 为空数组都视为 `false`。
 *
 * @param {unknown} scriptChunk
 * @returns {boolean}
 */
export function deriveHasKvaFromScriptChunk(scriptChunk) {
  if (!scriptChunk || typeof scriptChunk !== 'object') {
    return false;
  }
  const sc = /** @type {Record<string, unknown>} */ (scriptChunk);
  const kvas = sc.key_visual_actions;
  return Array.isArray(kvas) && kvas.length > 0;
}
