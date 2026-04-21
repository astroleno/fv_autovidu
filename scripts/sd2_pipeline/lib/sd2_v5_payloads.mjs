/**
 * SD2 v5：Director / Prompter 的 JSON 输入构造。
 *
 * 与 v4 的核心差异：
 *   1. 给 Director 多透传 v5 新字段（meta 层 + block 层），使 prompt 能看到并消费：
 *      - meta: psychology_plan / info_gap_ledger / proof_ladder /
 *              protagonist_shot_ratio_target / paywall_scaffolding / video
 *      - block: status_curve（block 级情绪/权力曲线）/ satisfaction_points（爽点锚点）/
 *               actors_knowledge（信息差账本）
 *   2. Prompter 的 aspectRatio 从 meta.video.aspect_ratio 取（若 CLI 未传）。
 *   3. 内部工具函数 buildBlockLocalAssetMapping / extractDirectorMarkdownSectionForBlock
 *      直接复用 v4 的等价实现（保持 @图N 黑箱化一致）。
 *
 * 保留与 v4 完全一致的：
 *   - fewShotContext 选取（selectFewShotContext）
 *   - 黑箱化资产映射（从 @图1 开始的局部编号）
 *   - prevBlockContext 计算（同场才串行）
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
 * 从 Director 输出的 markdown_body 中切出当前 Block 的 `## B{NN} | ...` 段落。
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
 * 与 v4 语义一致：仅当同 scene_run_id 且非 cut/exit 时透传；exit 时清空角色状态。
 *
 * @param {unknown} prevAppendix
 * @param {unknown} prevBlockIndexRow
 * @param {unknown} currentBlockIndexRow
 * @returns {Record<string, unknown>|null}
 */
export function computePrevBlockContextForDirectorV5(
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
 * 从 meta.* 中挑出与某 block 相关的 v5 辅助字段，供 Director 消费。
 * 所有字段都可能缺失；缺失时给空数组 / null。
 *
 * @param {Record<string, unknown>} meta
 * @param {string} blockId
 * @returns {{
 *   psychologyPlanForBlock: Record<string, unknown>|null,
 *   infoGapLedgerForBlock:  Record<string, unknown>|null,
 *   proofLadderForBlock:    Record<string, unknown>|null,
 *   paywallScaffoldingForBlock: Record<string, unknown>|null,
 *   protagonistShotRatioTarget: number|null,
 * }}
 */
function pickMetaForBlock(meta, blockId) {
  /**
   * 通用抽取器：在某个数组里找 block_id === blockId 的元素。
   * @param {unknown} arr
   * @returns {Record<string, unknown>|null}
   */
  const pick = (arr) => {
    if (!Array.isArray(arr)) {
      return null;
    }
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

  const psyPlan = pick(meta.psychology_plan);
  const infoGap = pick(meta.info_gap_ledger);
  const proof = pick(meta.proof_ladder);
  const paywall = pick(meta.paywall_scaffolding);
  const target =
    typeof meta.protagonist_shot_ratio_target === 'number'
      ? meta.protagonist_shot_ratio_target
      : null;

  return {
    psychologyPlanForBlock: psyPlan,
    infoGapLedgerForBlock: infoGap,
    proofLadderForBlock: proof,
    paywallScaffoldingForBlock: paywall,
    protagonistShotRatioTarget: target,
  };
}

/**
 * 构造某 block 的 Director v5 输入 JSON。
 *
 * @param {Object} opts
 * @param {unknown} opts.editMap
 * @param {string} opts.blockId
 * @param {string} [opts.kbDir]
 * @param {string} [opts.renderingStyle]
 * @param {string} [opts.aspectRatio]
 * @param {number} [opts.maxExamples]
 * @param {string[]} [opts.knowledgeSlices]
 * @param {Record<string, unknown>|null} [opts.prevBlockContext]
 */
export function buildDirectorPayloadV5({
  editMap,
  blockId,
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
  /**
   * 与 v4 兼容：历史数据用 `id`，v5 canonical 用 `block_id`；两者都接受。
   */
  const bi =
    rows.find((x) => {
      if (!x || typeof x !== 'object') {
        return false;
      }
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

  const pickedMeta = pickMetaForBlock(meta, blockId);

  /**
   * v5.0-rev8 · 镜头槽位确定性派生
   * ─────────────────────────────────────────────────────────────
   * 方案 A（架构反转）：把"决定镜头数 / 每片时长 / shot_code"从 LLM 手里
   * 抢回 pipeline，交给 shot_slot_planner 确定性派生。
   * Director LLM 的职责收窄为 slot-fill（填画面/台词/音效），结构由 pipeline
   * 保证。这解决了 leji-v5m/n/o 观测到的"镜头数系统性低于预算"根因（LLM
   * 同时扛 7 件事 → attention split + risk aversion → 压缩镜头数）。
   */
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

  /**
   * v5.0-rev9 · 密度上下文：从 meta.target_shot_count 派生 avgShotSec 传给 planner。
   * ───────────────────────────────────────────────────────────────────────────
   * brief 三种输入态 → EditMap/normalize 已写入 meta.target_shot_count.avg_shot_duration_sec：
   *   ① brief 明写密度（"每镜 2s"）→ avg = 2
   *   ② brief 明写镜头数（"60 镜"） → avg = episodeDuration / 60
   *   ③ brief 啥都没写              → avg = DEFAULT_AVG_SHOT_SEC (= 2)
   * 这里把该 avg 透传给 planner；minShotSec 固定用 Seedance 物理下限（1s）。
   */
  const tsc =
    meta.target_shot_count && typeof meta.target_shot_count === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.target_shot_count)
      : null;
  /** @type {number} */
  const avgShotSec =
    tsc && typeof tsc.avg_shot_duration_sec === 'number' && Number.isFinite(tsc.avg_shot_duration_sec)
      ? /** @type {number} */ (tsc.avg_shot_duration_sec)
      : DEFAULT_AVG_SHOT_SEC;

  const shotSlotsResult = planShotSlotsFromBlockIndex(bi, isLastBlock, {
    minShotSec: SEEDANCE_MIN_SHOT_SEC,
    avgShotSec,
  });

  // aspectRatio 回退链：显式传参 > meta.video.aspect_ratio > "9:16"
  const video =
    meta.video && typeof meta.video === 'object'
      ? /** @type {Record<string, unknown>} */ (meta.video)
      : {};
  const effAspect =
    aspectRatio ||
    (typeof video.aspect_ratio === 'string' ? video.aspect_ratio : '') ||
    '9:16';

  return {
    editMapParagraph: md,
    blockIndex: bi,
    assetTagMapping: meta.asset_tag_mapping || [],
    parsedBrief: meta.parsed_brief ?? null,
    episodeForbiddenWords: meta.episode_forbidden_words || [],
    knowledgeSlices,
    fewShotContext,
    prevBlockContext,
    renderingStyle:
      renderingStyle ||
      (typeof meta.rendering_style === 'string' ? meta.rendering_style : '') ||
      '3D写实动画',
    aspectRatio: effAspect,

    // ── v5 新增透传（Director 消费）──
    //   v5.0 HOTFIX：把 block.shot_budget_hint 与 meta.target_shot_count 同时透传给 Director，
    //   让 LLM 在本 block 自知"目标镜头数" + "片级总预算"，避免超出或缩水。
    v5Meta: {
      video,                                 // { aspect_ratio, scene_bucket_default, genre_hint }
      psychologyPlanForBlock: pickedMeta.psychologyPlanForBlock,
      infoGapLedgerForBlock: pickedMeta.infoGapLedgerForBlock,
      proofLadderForBlock: pickedMeta.proofLadderForBlock,
      paywallScaffoldingForBlock: pickedMeta.paywallScaffoldingForBlock,
      protagonistShotRatioTarget: pickedMeta.protagonistShotRatioTarget,
      shotBudgetHint: extractShotBudgetHint(bi),        // { target, tolerance } | null
      targetShotCount:
        meta.target_shot_count && typeof meta.target_shot_count === 'object'
          ? /** @type {Record<string, unknown>} */ (meta.target_shot_count)
          : null,

      /**
       * v5.0-rev8 · shot_slots（Director 新的 slot-fill 输入源）
       * ─────────────────────────────────────────────────────────
       * - slots: 固定 slot 数 = shot_slot_planner 派生结果；LLM 必须按顺序填每个 slot。
       * - meta:  { count, clamped_by, distribution_strategy } 审计字段。
       * - 缺失条件：block 无 shot_budget_hint（EditMap 没派生成功），此时为 null，
       *   Director prompt 侧 fallback 到旧 §I.0 tolerance 路径。
       */
      shotSlots: shotSlotsResult ? shotSlotsResult.slots : null,
      shotSlotsMeta: shotSlotsResult ? shotSlotsResult.meta : null,
    },
  };
}

/**
 * 从 block_index[i] 中取出 v5.0 HOTFIX 派生的 shot_budget_hint。
 * 形态：`{ target: number, tolerance: [min, max] }`；缺失则 null。
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
  if (t <= 0 || !tol || tol.length !== 2) {
    return null;
  }
  const lo = Number(tol[0]);
  const hi = Number(tol[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return null;
  }
  return { target: t, tolerance: [lo, hi] };
}

/**
 * 从全局 asset_tag_mapping + block_index.present_asset_ids 构建局部 @图N 映射。
 * 黑箱化：Prompter 只能看到从 @图1 开始的局部编号，不接触全局编号。
 *
 * 与 v4 同名函数等价（v5 独立复制，避免跨版本耦合）。
 *
 * @param {unknown[]} globalMapping  全局 asset_tag_mapping 数组
 * @param {string[]} presentAssetIds 当前 Block 的 present_asset_ids
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
        if (aid) {
          idToDesc.set(aid, desc);
        }
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
 * 构造某 block 的 Prompter v5 输入 JSON。
 * 与 v4 相比几乎一致；aspectRatio 补了从 meta.video.aspect_ratio 的回退。
 *
 * @param {Object} opts
 * @param {unknown} opts.editMap
 * @param {string} opts.blockId
 * @param {string} [opts.kbDir]
 * @param {string} [opts.renderingStyle]
 * @param {unknown} [opts.artStyle]
 * @param {number} [opts.maxExamples]
 * @param {string} [opts.aspectRatio]
 * @param {string} [opts.directorMarkdownSection]
 * @param {string[]} [opts.knowledgeSlices]
 */
export function buildPrompterPayloadV5({
  editMap,
  blockId,
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
      if (!x || typeof x !== 'object') {
        return false;
      }
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

  // ── 黑箱化：向 Prompter 仅透传当前 Block 的局部 @图N 映射 ──
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

  return {
    directorMarkdownSection,
    blockIndex: bi,
    assetTagMapping: localMappingList,
    episodeForbiddenWords: meta.episode_forbidden_words || [],
    parsedBrief: meta.parsed_brief ?? null,
    knowledgeSlices,
    fewShotContext,
    renderingStyle:
      renderingStyle ||
      (typeof meta.rendering_style === 'string' ? meta.rendering_style : '') ||
      '3D写实动画',
    artStyle: artStyle !== undefined ? artStyle : meta.art_style ?? null,
    aspectRatio: effAspect,
    block_id: blockId,

    // v5 新增：把 meta.video 也透传给 Prompter，便于竖屏物理规则判断
    v5Meta: { video },
  };
}

/**
 * 批量构造所有 block 的 Director v5 payload（供 build-only 场景使用）。
 *
 * @param {Object} opts
 * @param {unknown} opts.editMap
 * @param {string} [opts.kbDir]
 * @param {string} [opts.renderingStyle]
 * @param {string} [opts.aspectRatio]
 * @param {number} [opts.maxExamples]
 */
export function buildAllDirectorPayloadsV5({
  editMap,
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
      kind: 'sd2_director_payloads_v5',
      sd2_version: 'v5',
    },
    payloads: blocks.map((b) => {
      const id = /** @type {{ id?: string, block_id?: string }} */ (b).block_id
        || /** @type {{ id?: string }} */ (b).id;
      return {
        block_id: id,
        payload: buildDirectorPayloadV5({
          editMap,
          blockId: /** @type {string} */ (id),
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
