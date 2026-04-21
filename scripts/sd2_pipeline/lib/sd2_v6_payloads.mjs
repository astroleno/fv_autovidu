/**
 * SD2 v6：Director / Prompter 的 JSON 输入构造（payload builders）。
 *
 * 与 v5 的核心差异（仅限 payload 层）：
 *   1. **新增 `scriptChunk`**：把 Normalizer v2 产物 `beat_ledger[].segments[]` 按
 *      `block_index[i].covered_segment_ids[]` 查出原文，组装成 block 级剧本切片，作为
 *      Director / Prompter 的**唯一剧本真相源**（替代 v5 把全剧本一股脑透传的做法）。
 *      缺失 Normalizer 产物或 EditMap 未升级时 `scriptChunk = null`（降级到 v5 行为）。
 *   2. **新增 `styleInference`**：透传 `meta.style_inference`（风格三轴：
 *      rendering_style / tone_bias / genre_bias），下游 Director/Prompter 用它替代
 *      v5 的 `renderingStyle` / `artStyle` 单值。
 *   3. **新增 `rhythmTimelineForBlock`**：按 block_id 从 `meta.rhythm_timeline` 反查
 *      该 block 在 timeline 中的角色（golden_open / mini_climax_N.trigger / .amplify /
 *      .pivot / .payoff / .residue / major_climax / closing_hook / filler），给
 *      Director/Prompter 做五段式 slot 填充决策。
 *   4. **新增 `kvaForBlock[]` + `structureHintsForBlock[]`**：从 Normalizer v2 的
 *      `beat_ledger[].key_visual_actions[]` / `structure_hints[]` 按 block 命中的 beat_ids
 *      汇总，供 Director 做 KVA 消费契约（硬门 · Director v6 §I.2.2）。
 *   5. **新增 `infoDensityContract`**：从 `meta.rhythm_timeline.info_density_contract`
 *      取出 `max_none_ratio`（按 genre 浮动 0.10–0.30），供 Prompter 计算 none_ratio 硬门。
 *   6. **派生 `has_kva`**：block 级计算并随 payload 返回（编排层 `loadKnowledgeSlicesV6`
 *      的路由入参），`scriptChunk.key_visual_actions.length > 0` → true。
 *
 * 与 v5 完全保留的：
 *   - `fewShotContext` 选取（selectFewShotContext，复用 v4/v5 的 kbDir 逻辑）；
 *   - 黑箱化资产映射（从 @图1 开始的局部编号，v5 的 buildBlockLocalAssetMapping）；
 *   - `prevBlockContext` 计算（同 scene_run_id 才透传 continuity_out）；
 *   - `shotSlots / shotSlotsMeta` 确定性派生（v5.0-rev8 架构反转产物，v6 直接沿用）。
 *
 * 降级兜底（重要 · v6 向后兼容）：
 *   - EditMap 未升级 / block_index[i].covered_segment_ids 缺失 → `scriptChunk = null`；
 *   - Normalizer 未跑 / normalizedScriptPackage = null → `scriptChunk = null`；
 *   - meta.style_inference 缺失 → `styleInference = null`；
 *   - meta.rhythm_timeline 缺失 → `rhythmTimelineForBlock = null` + `infoDensityContract = null`；
 *   - 上述缺失不抛错，而是让 Director/Prompter 自动退化为 v5 行为（07 schema §564）。
 *
 * 契约源：
 *   - `prompt/1_SD2Workflow/docs/v6/04_v6-并发链路剧本透传.md` §4
 *   - `prompt/1_SD2Workflow/docs/v6/07_v6-schema-冻结.md` §3-§5
 */
import { createRequire } from 'module';

import {
  planShotSlotsFromBlockIndex,
  SEEDANCE_MIN_SHOT_SEC,
  DEFAULT_AVG_SHOT_SEC,
} from './shot_slot_planner.mjs';

const require = createRequire(import.meta.url);
const {
  findBlock,
  selectFewShotContext,
} = require('../../build_sd2_prompter_payload.js');

/**
 * 从 Director 输出的 markdown_body 切出当前 block 的 `## B{NN} | ...` 段落。
 *
 * 与 v5 行为完全一致（正则 `^## B\d+`），用于把 Director 的分镜稿在 Prompter 阶段
 * 切块透传。
 *
 * @param {string} markdownBody
 * @param {string} blockId
 * @returns {string}
 */
export function extractDirectorMarkdownSectionForBlock(markdownBody, blockId) {
  if (!markdownBody || typeof markdownBody !== 'string' || !blockId) {
    return '';
  }
  const chunks = markdownBody.split(/(?=^## B\d+)/m);
  for (const chunk of chunks) {
    const m = chunk.match(/^## (B\d+)\b/m);
    if (m && m[1] === blockId) {
      return chunk.trim();
    }
  }
  return '';
}

/**
 * 前一组 Director appendix.continuity_out → 本组 prevBlockContext。
 *
 * 与 v5 语义完全一致：同 scene_run_id 且非 cut/exit 时透传；exit 时清空角色状态。
 * v6 **未**对 continuity 规则做修改，直接复用。
 *
 * @param {unknown} prevAppendix
 * @param {unknown} prevBlockIndexRow
 * @param {unknown} currentBlockIndexRow
 * @returns {Record<string, unknown>|null}
 */
export function computePrevBlockContextForDirectorV6(
  prevAppendix,
  prevBlockIndexRow,
  currentBlockIndexRow,
) {
  if (!prevAppendix || typeof prevAppendix !== 'object') {
    return null;
  }
  const app = /** @type {Record<string, unknown>} */ (prevAppendix);
  const co = app.continuity_out;
  if (!co || typeof co !== 'object') {
    return null;
  }
  const cout = /** @type {Record<string, unknown>} */ (co);
  const exit = typeof cout.scene_exit_state === 'string' ? cout.scene_exit_state : 'ongoing';
  if (exit === 'cut') {
    return null;
  }

  const prev =
    prevBlockIndexRow && typeof prevBlockIndexRow === 'object'
      ? /** @type {Record<string, unknown>} */ (prevBlockIndexRow)
      : {};
  const cur =
    currentBlockIndexRow && typeof currentBlockIndexRow === 'object'
      ? /** @type {Record<string, unknown>} */ (currentBlockIndexRow)
      : {};
  const prevRun = typeof prev.scene_run_id === 'string' ? prev.scene_run_id : '';
  const curRun = typeof cur.scene_run_id === 'string' ? cur.scene_run_id : '';
  if (prevRun && curRun && prevRun !== curRun) {
    return null;
  }

  /** @type {Record<string, unknown>} */
  const ctx = {
    last_shot: cout.last_shot ?? null,
    last_lighting: cout.last_lighting ?? '',
    characters_final_state: Array.isArray(cout.characters_final_state)
      ? cout.characters_final_state
      : [],
    scene_exit_state: exit,
  };
  if (exit === 'exit') {
    ctx.characters_final_state = [];
  }
  return ctx;
}

/**
 * 把 Normalizer v2 产物扁平化为 `seg_id -> segment` 的 map（一次性，O(N)），
 * 便于下游按 seg_id 查原文正文。
 *
 * @param {unknown} normalizedPackage
 * @returns {Map<string, { beat_id: string, segment: Record<string, unknown> }>}
 */
function buildSegmentIndex(normalizedPackage) {
  /** @type {Map<string, { beat_id: string, segment: Record<string, unknown> }>} */
  const idx = new Map();
  if (!normalizedPackage || typeof normalizedPackage !== 'object') {
    return idx;
  }
  const pkg = /** @type {Record<string, unknown>} */ (normalizedPackage);
  const ledger = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : [];
  for (const beat of ledger) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    const beatId = typeof b.beat_id === 'string' ? b.beat_id : '';
    const segments = Array.isArray(b.segments) ? b.segments : [];
    for (const seg of segments) {
      if (!seg || typeof seg !== 'object') continue;
      const s = /** @type {Record<string, unknown>} */ (seg);
      const sid = typeof s.seg_id === 'string' ? s.seg_id : '';
      if (sid) {
        idx.set(sid, { beat_id: beatId, segment: s });
      }
    }
  }
  return idx;
}

/**
 * 把 Normalizer v2 的 beat_ledger 扁平化为 `beat_id -> { kvas, structure_hints }` 的 map。
 *
 * @param {unknown} normalizedPackage
 * @returns {Map<string, { kvas: unknown[], structure_hints: unknown[] }>}
 */
function buildBeatAuxIndex(normalizedPackage) {
  /** @type {Map<string, { kvas: unknown[], structure_hints: unknown[] }>} */
  const idx = new Map();
  if (!normalizedPackage || typeof normalizedPackage !== 'object') {
    return idx;
  }
  const pkg = /** @type {Record<string, unknown>} */ (normalizedPackage);
  const ledger = Array.isArray(pkg.beat_ledger) ? pkg.beat_ledger : [];
  for (const beat of ledger) {
    if (!beat || typeof beat !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (beat);
    const beatId = typeof b.beat_id === 'string' ? b.beat_id : '';
    if (!beatId) continue;
    idx.set(beatId, {
      kvas: Array.isArray(b.key_visual_actions) ? b.key_visual_actions : [],
      structure_hints: Array.isArray(b.structure_hints) ? b.structure_hints : [],
    });
  }
  return idx;
}

/**
 * 为某 block 构造 `scriptChunk` 对象（v6 剧本切片）。
 *
 * 步骤：
 *   1. 读 `blockIndexRow.covered_segment_ids[]`；缺失 → 返回 null（降级到 v5 行为）。
 *   2. 按 seg_id 从 segmentIndex 现查原文；命中的 seg 全部入 `scriptChunk.segments[]`。
 *   3. 汇总 beat_id，按 beat_id 从 beatAuxIndex 聚合 `key_visual_actions[]` /
 *      `structure_hints[]`（去重按 kva_id / hint_id）。
 *   4. 附带 `lead_seg_id / tail_seg_id / must_cover_segment_ids /
 *      script_chunk_hint.overflow_policy` 等路由字段。
 *
 * @param {Record<string, unknown>|null} blockIndexRow
 * @param {Map<string, { beat_id: string, segment: Record<string, unknown> }>} segmentIndex
 * @param {Map<string, { kvas: unknown[], structure_hints: unknown[] }>} beatAuxIndex
 * @returns {Record<string, unknown>|null}
 */
function buildScriptChunkForBlock(blockIndexRow, segmentIndex, beatAuxIndex) {
  if (!blockIndexRow || typeof blockIndexRow !== 'object') {
    return null;
  }
  const bi = /** @type {Record<string, unknown>} */ (blockIndexRow);
  const covered = Array.isArray(bi.covered_segment_ids) ? bi.covered_segment_ids : null;
  if (!covered || covered.length === 0) {
    // EditMap 未升级到 v6 或 v6 自身 covered_segment_ids 缺失 → 降级
    return null;
  }
  const blockId = typeof bi.block_id === 'string' ? bi.block_id : '';
  const hint = bi.script_chunk_hint && typeof bi.script_chunk_hint === 'object'
    ? /** @type {Record<string, unknown>} */ (bi.script_chunk_hint)
    : {};
  const mustCover = Array.isArray(bi.must_cover_segment_ids) ? bi.must_cover_segment_ids : [];

  /** @type {unknown[]} */
  const segmentsOut = [];
  /** @type {Set<string>} */
  const beatIdsHit = new Set();
  for (const sid of covered) {
    if (typeof sid !== 'string' || !sid) continue;
    const hit = segmentIndex.get(sid);
    if (!hit) {
      // 缺失原文 → 占位（不 throw；Director 硬门会在 segment_coverage_report 里暴露）
      segmentsOut.push({
        seg_id: sid,
        beat_id: null,
        segment_type: 'unknown',
        speaker: null,
        text: '',
        __missing_from_normalizer__: true,
      });
      continue;
    }
    if (hit.beat_id) beatIdsHit.add(hit.beat_id);
    const s = hit.segment;
    segmentsOut.push({
      seg_id: sid,
      beat_id: hit.beat_id || null,
      segment_type: typeof s.segment_type === 'string' ? s.segment_type : 'descriptive',
      speaker: typeof s.speaker === 'string' ? s.speaker : null,
      text: typeof s.text === 'string' ? s.text : '',
      // 透传 dialogue_char_count（v2 新增），便于 Prompter 做对白字数自检
      dialogue_char_count:
        typeof s.dialogue_char_count === 'number' ? s.dialogue_char_count : null,
      // 透传 author_hint（v2 新增），让 Prompter 识别作者授权的对白压缩
      author_hint:
        s.author_hint && typeof s.author_hint === 'object' ? s.author_hint : null,
    });
  }

  /** @type {unknown[]} */
  const kvasAll = [];
  /** @type {Set<string>} */
  const kvaIdSeen = new Set();
  /** @type {unknown[]} */
  const hintsAll = [];
  /** @type {Set<string>} */
  const hintIdSeen = new Set();
  for (const bid of beatIdsHit) {
    const aux = beatAuxIndex.get(bid);
    if (!aux) continue;
    for (const kva of aux.kvas) {
      if (!kva || typeof kva !== 'object') continue;
      const k = /** @type {Record<string, unknown>} */ (kva);
      const kid = typeof k.kva_id === 'string' ? k.kva_id : '';
      if (kid && kvaIdSeen.has(kid)) continue;
      if (kid) kvaIdSeen.add(kid);
      kvasAll.push(k);
    }
    for (const hint of aux.structure_hints) {
      if (!hint || typeof hint !== 'object') continue;
      const h = /** @type {Record<string, unknown>} */ (hint);
      const hid = typeof h.hint_id === 'string' ? h.hint_id : '';
      if (hid && hintIdSeen.has(hid)) continue;
      if (hid) hintIdSeen.add(hid);
      hintsAll.push(h);
    }
  }

  return {
    block_id: blockId,
    lead_seg_id: typeof hint.lead_seg_id === 'string' ? hint.lead_seg_id : null,
    tail_seg_id: typeof hint.tail_seg_id === 'string' ? hint.tail_seg_id : null,
    must_cover_segment_ids: mustCover,
    overflow_policy: typeof hint.overflow_policy === 'string' ? hint.overflow_policy : null,
    segments: segmentsOut,
    key_visual_actions: kvasAll,
    structure_hints: hintsAll,
  };
}

/**
 * 从 `meta.rhythm_timeline` 反查某 block 在节奏时间线中的角色。
 *
 * 规则（与 07 schema §3.2 一致）：
 *   - `golden_open_3s.covered_blocks` 包含 blockId → `{ role: 'golden_open', ... }`
 *   - `mini_climaxes[].slots[]` 按 stage 匹配 → `{ role: 'mini_climax', seq, stage, ... }`
 *   - `major_climax.block_id == blockId` → `{ role: 'major_climax', strategy, ... }`
 *   - `closing_hook.block_id == blockId` → `{ role: 'closing_hook', ... }`
 *   - 都没命中 → `{ role: 'filler' }`（LLM 侧无特殊约束，info_density 照常适用）
 *
 * @param {Record<string, unknown>|null} rhythmTimeline
 * @param {string} blockId
 * @returns {Record<string, unknown>|null}
 */
function resolveRhythmRoleForBlock(rhythmTimeline, blockId) {
  if (!rhythmTimeline || typeof rhythmTimeline !== 'object') {
    return null;
  }
  const rt = rhythmTimeline;

  // golden_open
  const g = rt.golden_open_3s && typeof rt.golden_open_3s === 'object'
    ? /** @type {Record<string, unknown>} */ (rt.golden_open_3s)
    : null;
  if (g && Array.isArray(g.covered_blocks) && g.covered_blocks.includes(blockId)) {
    return {
      role: 'golden_open',
      required_signatures_any_of: Array.isArray(g.required_signatures_any_of)
        ? g.required_signatures_any_of
        : [],
      duration_sec_max: typeof g.duration_sec_max === 'number' ? g.duration_sec_max : 3,
    };
  }

  // mini_climaxes
  const mcs = Array.isArray(rt.mini_climaxes) ? rt.mini_climaxes : [];
  for (const mc of mcs) {
    if (!mc || typeof mc !== 'object') continue;
    const m = /** @type {Record<string, unknown>} */ (mc);
    const seq = typeof m.seq === 'number' ? m.seq : null;
    const slots = m.slots && typeof m.slots === 'object'
      ? /** @type {Record<string, unknown>} */ (m.slots)
      : {};
    for (const stage of ['trigger', 'amplify', 'pivot', 'payoff', 'residue']) {
      const sl = slots[stage];
      if (sl && typeof sl === 'object') {
        const slot = /** @type {Record<string, unknown>} */ (sl);
        if (typeof slot.block_id === 'string' && slot.block_id === blockId) {
          return {
            role: 'mini_climax',
            mini_climax_seq: seq,
            stage,
            signature_required: slot.signature_required === true,
            strategy: typeof m.strategy === 'string' ? m.strategy : null,
          };
        }
      }
    }
  }

  // major_climax
  const mj = rt.major_climax && typeof rt.major_climax === 'object'
    ? /** @type {Record<string, unknown>} */ (rt.major_climax)
    : null;
  if (mj && typeof mj.block_id === 'string' && mj.block_id === blockId) {
    return {
      role: 'major_climax',
      strategy: typeof mj.strategy === 'string' ? mj.strategy : null,
      required_elements_all_of: Array.isArray(mj.required_elements_all_of)
        ? mj.required_elements_all_of
        : [],
    };
  }

  // closing_hook
  const ch = rt.closing_hook && typeof rt.closing_hook === 'object'
    ? /** @type {Record<string, unknown>} */ (rt.closing_hook)
    : null;
  if (ch && typeof ch.block_id === 'string' && ch.block_id === blockId) {
    return {
      role: 'closing_hook',
      cliff_sentence_required: ch.cliff_sentence_required === true,
      required_elements_any_of: Array.isArray(ch.required_elements_any_of)
        ? ch.required_elements_any_of
        : [],
    };
  }

  return { role: 'filler' };
}

/**
 * 从 `meta.rhythm_timeline.info_density_contract` 取全局 info 密度契约。
 *
 * 字段形态（v6 schema §3.2）：
 *   ```
 *   info_density_contract: {
 *     max_none_ratio: 0.20,           // 每 block none_ratio 上限
 *     consecutive_none_limit: 1       // 连续 none shot 上限（= 1 表示禁止连续 2 个）
 *   }
 *   ```
 * 缺失任一字段 → 回退到默认值（max=0.20, limit=1，与 v6 Prompter 硬门默认一致）。
 *
 * @param {Record<string, unknown>|null} rhythmTimeline
 * @returns {{ max_none_ratio: number, consecutive_none_limit: number }}
 */
function resolveInfoDensityContract(rhythmTimeline) {
  const def = { max_none_ratio: 0.20, consecutive_none_limit: 1 };
  if (!rhythmTimeline || typeof rhythmTimeline !== 'object') {
    return def;
  }
  const rt = rhythmTimeline;
  const c = rt.info_density_contract && typeof rt.info_density_contract === 'object'
    ? /** @type {Record<string, unknown>} */ (rt.info_density_contract)
    : null;
  if (!c) return def;
  return {
    max_none_ratio:
      typeof c.max_none_ratio === 'number' && c.max_none_ratio >= 0 && c.max_none_ratio <= 1
        ? c.max_none_ratio
        : def.max_none_ratio,
    consecutive_none_limit:
      typeof c.consecutive_none_limit === 'number' && c.consecutive_none_limit >= 0
        ? c.consecutive_none_limit
        : def.consecutive_none_limit,
  };
}

/**
 * 从 meta.* 中挑出与某 block 相关的 v5 辅助字段（与 v5 完全相同的 5 个字段）。
 *
 * v6 对这些字段路由无改动，直接沿用 v5 语义。
 *
 * @param {Record<string, unknown>} meta
 * @param {string} blockId
 */
function pickV5MetaForBlock(meta, blockId) {
  /** @param {unknown} arr */
  const pick = (arr) => {
    if (!Array.isArray(arr)) return null;
    for (const item of arr) {
      if (item && typeof item === 'object') {
        const it = /** @type {Record<string, unknown>} */ (item);
        if (typeof it.block_id === 'string' && it.block_id === blockId) {
          return it;
        }
      }
    }
    return null;
  };
  return {
    psychologyPlanForBlock: pick(meta.psychology_plan),
    infoGapLedgerForBlock: pick(meta.info_gap_ledger),
    proofLadderForBlock: pick(meta.proof_ladder),
    paywallScaffoldingForBlock: pick(meta.paywall_scaffolding),
    protagonistShotRatioTarget:
      typeof meta.protagonist_shot_ratio_target === 'number'
        ? meta.protagonist_shot_ratio_target
        : null,
  };
}

/**
 * 从 block_index[i] 中取 v5.0 HOTFIX 派生的 shot_budget_hint（与 v5 行为完全一致）。
 *
 * @param {unknown} bi
 * @returns {{ target: number, tolerance: [number, number] }|null}
 */
function extractShotBudgetHint(bi) {
  if (!bi || typeof bi !== 'object') {
    return null;
  }
  const r = /** @type {Record<string, unknown>} */ (bi);
  const raw = r.shot_budget_hint;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const sh = /** @type {Record<string, unknown>} */ (raw);
  const t = typeof sh.target === 'number' ? sh.target : 0;
  const tol = Array.isArray(sh.tolerance) ? sh.tolerance : null;
  if (t <= 0 || !tol || tol.length !== 2) return null;
  const lo = Number(tol[0]);
  const hi = Number(tol[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { target: t, tolerance: [lo, hi] };
}

/**
 * 黑箱化资产映射（与 v5 buildBlockLocalAssetMapping 等价）。
 *
 * 为何 v6 不复用 v5 的 export：v5 的该函数是 module-internal，
 * 为避免跨版本耦合，v6 独立复制一份（逻辑一致）。
 *
 * @param {unknown[]} globalMapping
 * @param {string[]} presentAssetIds
 */
function buildBlockLocalAssetMapping(globalMapping, presentAssetIds) {
  /** @type {Map<string, string>} */
  const idToDesc = new Map();
  if (Array.isArray(globalMapping)) {
    for (const item of globalMapping) {
      if (item && typeof item === 'object') {
        const entry = /** @type {Record<string, unknown>} */ (item);
        const aid = typeof entry.asset_id === 'string' ? entry.asset_id : '';
        const desc =
          typeof entry.description === 'string'
            ? entry.description
            : typeof entry.label === 'string'
              ? entry.label
              : aid;
        if (aid) idToDesc.set(aid, desc);
      }
    }
  }
  /** @type {Record<string, string>} */
  const localMapping = {};
  /** @type {Array<{ tag: string, asset_id: string, description: string }>} */
  const localMappingList = [];
  let localIdx = 0;
  for (const assetId of presentAssetIds) {
    localIdx += 1;
    const tag = `@图${localIdx}`;
    const desc = idToDesc.get(assetId) || assetId;
    localMapping[tag] = assetId;
    localMappingList.push({ tag, asset_id: assetId, description: desc });
  }
  return { localMapping, localMappingList };
}

/**
 * 构造某 block 的 Director v6 输入 JSON。
 *
 * 入参（相对 v5 的新增）：
 *   - `normalizedScriptPackage`（必填，v6 剧本真相源；null 时 scriptChunk 降级为 null）
 *
 * @param {Object} opts
 * @param {unknown} opts.editMap
 * @param {string} opts.blockId
 * @param {unknown|null} opts.normalizedScriptPackage
 * @param {string} [opts.kbDir]
 * @param {string} [opts.renderingStyle]
 * @param {string} [opts.aspectRatio]
 * @param {number} [opts.maxExamples]
 * @param {string[]} [opts.knowledgeSlices]
 * @param {Record<string, unknown>|null} [opts.prevBlockContext]
 */
export function buildDirectorPayloadV6({
  editMap,
  blockId,
  normalizedScriptPackage = null,
  kbDir,
  renderingStyle,
  aspectRatio,
  maxExamples = 2,
  knowledgeSlices = [],
  prevBlockContext = null,
}) {
  const { block } = findBlock(editMap, blockId);
  const appendix = /** @type {{ block_index?: unknown[] }} */ (editMap.appendix);
  const rows = Array.isArray(appendix?.block_index) ? appendix.block_index : [];
  const bi =
    rows.find((x) => {
      if (!x || typeof x !== 'object') return false;
      const r = /** @type {Record<string, unknown>} */ (x);
      return r.block_id === blockId || r.id === blockId;
    }) || null;

  const fewShotContext = selectFewShotContext({
    kbDir,
    retrieval: block.few_shot_retrieval,
    maxExamples,
  });

  const meta =
    editMap.meta && typeof editMap.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (editMap.meta)
      : {};
  const md =
    typeof block._v3_edit_map_markdown === 'string' ? block._v3_edit_map_markdown : '';

  const pickedV5Meta = pickV5MetaForBlock(meta, blockId);

  // ── v5.0-rev8 · shot slot planner 复用（v6 不改此路径） ──
  const isLastBlock =
    Array.isArray(rows) && rows.length > 0
      ? (() => {
          const lastRow = /** @type {Record<string, unknown>} */ (rows[rows.length - 1] || {});
          const lastId =
            typeof lastRow.block_id === 'string'
              ? lastRow.block_id
              : typeof lastRow.id === 'string'
              ? lastRow.id
              : '';
          return lastId === blockId;
        })()
      : false;
  const tsc =
    meta.target_shot_count && typeof meta.target_shot_count === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.target_shot_count)
      : null;
  const avgShotSec =
    tsc && typeof tsc.avg_shot_duration_sec === 'number' && Number.isFinite(tsc.avg_shot_duration_sec)
      ? /** @type {number} */ (tsc.avg_shot_duration_sec)
      : DEFAULT_AVG_SHOT_SEC;
  const shotSlotsResult = planShotSlotsFromBlockIndex(bi, isLastBlock, {
    minShotSec: SEEDANCE_MIN_SHOT_SEC,
    avgShotSec,
  });

  // aspect ratio 回退链（v6 新增第二级：meta.style_inference.rendering_style.value 不含 aspect）
  const video =
    meta.video && typeof meta.video === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.video)
      : {};
  const effAspect =
    aspectRatio ||
    (typeof video.aspect_ratio === 'string' ? video.aspect_ratio : '') ||
    '9:16';

  // ── v6 · scriptChunk / KVA / structure_hints 构造（降级兜底见本文件头部 javadoc） ──
  const segmentIndex = buildSegmentIndex(normalizedScriptPackage);
  const beatAuxIndex = buildBeatAuxIndex(normalizedScriptPackage);
  const scriptChunk = buildScriptChunkForBlock(
    /** @type {Record<string, unknown>|null} */ (bi),
    segmentIndex,
    beatAuxIndex,
  );

  // ── v6 · rhythm / style / density 派生 ──
  const rhythmTimeline =
    meta.rhythm_timeline && typeof meta.rhythm_timeline === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.rhythm_timeline)
      : null;
  const rhythmRole = resolveRhythmRoleForBlock(rhythmTimeline, blockId);
  const infoDensityContract = resolveInfoDensityContract(rhythmTimeline);
  const styleInference =
    meta.style_inference && typeof meta.style_inference === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.style_inference)
      : null;

  // rendering_style 优先级：CLI > style_inference.rendering_style.value > meta.rendering_style > '3D写实动画'
  const renderingStyleResolved =
    renderingStyle ||
    (() => {
      if (!styleInference) return '';
      const rs = styleInference.rendering_style;
      if (rs && typeof rs === 'object') {
        const v = /** @type {Record<string, unknown>} */ (rs).value;
        if (typeof v === 'string') return v;
      }
      return '';
    })() ||
    (typeof meta.rendering_style === 'string' ? meta.rendering_style : '') ||
    '3D写实动画';

  return {
    editMapParagraph: md,
    blockIndex: bi,
    assetTagMapping: meta.asset_tag_mapping || [],
    parsedBrief: meta.parsed_brief ?? null,
    episodeForbiddenWords: meta.episode_forbidden_words || [],
    knowledgeSlices,
    fewShotContext,
    prevBlockContext,
    renderingStyle: renderingStyleResolved,
    aspectRatio: effAspect,

    // ── v6 新增 · 剧本真相源 ──
    scriptChunk,

    // ── v6 新增 · 节奏 / 风格 / 密度 ──
    styleInference,
    rhythmTimelineForBlock: rhythmRole,
    infoDensityContract,

    // ── v5 透传（原样）──
    v5Meta: {
      video,
      psychologyPlanForBlock: pickedV5Meta.psychologyPlanForBlock,
      infoGapLedgerForBlock: pickedV5Meta.infoGapLedgerForBlock,
      proofLadderForBlock: pickedV5Meta.proofLadderForBlock,
      paywallScaffoldingForBlock: pickedV5Meta.paywallScaffoldingForBlock,
      protagonistShotRatioTarget: pickedV5Meta.protagonistShotRatioTarget,
      shotBudgetHint: extractShotBudgetHint(bi),
      targetShotCount:
        meta.target_shot_count && typeof meta.target_shot_count === 'object'
          ? /** @type {Record<string, unknown>} */ (meta.target_shot_count)
          : null,
      shotSlots: shotSlotsResult ? shotSlotsResult.slots : null,
      shotSlotsMeta: shotSlotsResult ? shotSlotsResult.meta : null,
    },
  };
}

/**
 * 构造某 block 的 Prompter v6 输入 JSON。
 *
 * 与 v5 的差异：
 *   - 新增 `scriptChunk`（同 Director 构造逻辑，复用）；
 *   - 新增 `styleInference` / `rhythmTimelineForBlock` / `infoDensityContract`；
 *   - 仍保留 v5 的黑箱化 `assetTagMapping`（从 @图1 开始的局部编号）。
 *
 * @param {Object} opts
 * @param {unknown} opts.editMap
 * @param {string} opts.blockId
 * @param {unknown|null} opts.normalizedScriptPackage
 * @param {string} [opts.kbDir]
 * @param {string} [opts.renderingStyle]
 * @param {unknown} [opts.artStyle]
 * @param {number} [opts.maxExamples]
 * @param {string} [opts.aspectRatio]
 * @param {string} [opts.directorMarkdownSection]
 * @param {string[]} [opts.knowledgeSlices]
 */
export function buildPrompterPayloadV6({
  editMap,
  blockId,
  normalizedScriptPackage = null,
  kbDir,
  renderingStyle,
  artStyle,
  maxExamples = 2,
  aspectRatio,
  directorMarkdownSection = '',
  knowledgeSlices = [],
}) {
  const { block } = findBlock(editMap, blockId);
  const appendix = /** @type {{ block_index?: unknown[] }} */ (editMap.appendix);
  const rows = Array.isArray(appendix?.block_index) ? appendix.block_index : [];
  const bi =
    rows.find((x) => {
      if (!x || typeof x !== 'object') return false;
      const r = /** @type {Record<string, unknown>} */ (x);
      return r.block_id === blockId || r.id === blockId;
    }) || null;

  const fewShotContext = selectFewShotContext({
    kbDir,
    retrieval: block.few_shot_retrieval,
    maxExamples,
  });

  const meta =
    editMap.meta && typeof editMap.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (editMap.meta)
      : {};
  const video =
    meta.video && typeof meta.video === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.video)
      : {};
  const effAspect =
    aspectRatio ||
    (typeof video.aspect_ratio === 'string' ? video.aspect_ratio : '') ||
    '9:16';

  // 黑箱化 @图N 映射
  const presentAssetIds =
    bi &&
    typeof bi === 'object' &&
    Array.isArray(/** @type {Record<string, unknown>} */ (bi).present_asset_ids)
      ? /** @type {string[]} */ (
          /** @type {Record<string, unknown>} */ (bi).present_asset_ids
        )
      : [];
  const globalMapping = Array.isArray(meta.asset_tag_mapping) ? meta.asset_tag_mapping : [];
  const { localMappingList } = buildBlockLocalAssetMapping(globalMapping, presentAssetIds);

  // v6 · 剧本真相源 + 节奏 / 风格 / 密度
  const segmentIndex = buildSegmentIndex(normalizedScriptPackage);
  const beatAuxIndex = buildBeatAuxIndex(normalizedScriptPackage);
  const scriptChunk = buildScriptChunkForBlock(
    /** @type {Record<string, unknown>|null} */ (bi),
    segmentIndex,
    beatAuxIndex,
  );
  const rhythmTimeline =
    meta.rhythm_timeline && typeof meta.rhythm_timeline === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.rhythm_timeline)
      : null;
  const rhythmRole = resolveRhythmRoleForBlock(rhythmTimeline, blockId);
  const infoDensityContract = resolveInfoDensityContract(rhythmTimeline);
  const styleInference =
    meta.style_inference && typeof meta.style_inference === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.style_inference)
      : null;

  // rendering_style 优先级同 Director
  const renderingStyleResolved =
    renderingStyle ||
    (() => {
      if (!styleInference) return '';
      const rs = styleInference.rendering_style;
      if (rs && typeof rs === 'object') {
        const v = /** @type {Record<string, unknown>} */ (rs).value;
        if (typeof v === 'string') return v;
      }
      return '';
    })() ||
    (typeof meta.rendering_style === 'string' ? meta.rendering_style : '') ||
    '3D写实动画';

  return {
    directorMarkdownSection,
    blockIndex: bi,
    assetTagMapping: localMappingList,
    episodeForbiddenWords: meta.episode_forbidden_words || [],
    parsedBrief: meta.parsed_brief ?? null,
    knowledgeSlices,
    fewShotContext,
    renderingStyle: renderingStyleResolved,
    artStyle: artStyle !== undefined ? artStyle : meta.art_style ?? null,
    aspectRatio: effAspect,
    block_id: blockId,

    // v6 新增
    scriptChunk,
    styleInference,
    rhythmTimelineForBlock: rhythmRole,
    infoDensityContract,

    // v5 透传
    v5Meta: { video },
  };
}

/**
 * 批量构造所有 block 的 Director v6 payload（供 build-only 场景使用）。
 *
 * @param {Object} opts
 * @param {unknown} opts.editMap
 * @param {unknown|null} opts.normalizedScriptPackage
 * @param {string} [opts.kbDir]
 * @param {string} [opts.renderingStyle]
 * @param {string} [opts.aspectRatio]
 * @param {number} [opts.maxExamples]
 */
export function buildAllDirectorPayloadsV6({
  editMap,
  normalizedScriptPackage = null,
  kbDir,
  renderingStyle,
  aspectRatio,
  maxExamples = 2,
}) {
  const em = /** @type {Record<string, unknown>} */ (editMap);
  const blocks = Array.isArray(em.blocks) ? em.blocks : [];
  const meta =
    em.meta && typeof em.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (em.meta)
      : {};
  return {
    meta: {
      source_title: typeof meta.title === 'string' ? meta.title : null,
      block_count: blocks.length,
      generated_at: new Date().toISOString(),
      kb_dir: kbDir,
      kind: 'sd2_director_payloads_v6',
      sd2_version: 'v6',
      has_normalized_script_package: Boolean(normalizedScriptPackage),
    },
    payloads: blocks.map((b) => {
      const id = /** @type {{ id?: string, block_id?: string }} */ (b).block_id
        || /** @type {{ id?: string }} */ (b).id;
      return {
        block_id: id,
        payload: buildDirectorPayloadV6({
          editMap,
          blockId: /** @type {string} */ (id),
          normalizedScriptPackage,
          kbDir,
          renderingStyle,
          aspectRatio,
          maxExamples,
          knowledgeSlices: [],
          prevBlockContext: null,
        }),
      };
    }),
  };
}
