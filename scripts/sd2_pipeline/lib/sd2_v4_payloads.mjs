/**
 * SD2 v4：Director / Prompter 的 JSON 输入（对齐 SD2Workflow-v3.1-接口合同）。
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  findBlock,
  selectFewShotContext,
} = require('../../build_sd2_prompter_payload.js');

/**
 * 从 Director 输出的 markdown_body 中切出当前 Block 的 `## B{NN} | ...` 段落。
 * @param {string} markdownBody
 * @param {string} blockId  如 B01
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
 * 前一组 Director appendix.continuity_out → 本组 prevBlockContext（合同 5）。
 * @param {unknown} prevAppendix  Director 解析结果的 appendix
 * @param {unknown} prevBlockIndexRow  上一 block 的 block_index 行
 * @param {unknown} currentBlockIndexRow  当前 block 的 block_index 行
 * @returns {Record<string, unknown>|null}
 */
export function computePrevBlockContextForDirector(
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
 * @param {object} opts
 * @param {unknown} opts.editMap
 * @param {string} opts.blockId
 * @param {string} [opts.kbDir]
 * @param {string} [opts.renderingStyle]
 * @param {string} [opts.aspectRatio]
 * @param {number} [opts.maxExamples]
 * @param {string[]} [opts.knowledgeSlices]
 * @param {Record<string, unknown>|null} [opts.prevBlockContext]
 */
export function buildDirectorPayloadV4({
  editMap,
  blockId,
  kbDir,
  renderingStyle,
  aspectRatio = '16:9',
  maxExamples = 2,
  knowledgeSlices = [],
  prevBlockContext = null,
}) {
  const { blocks, block, blockIndex } = findBlock(editMap, blockId);
  const appendix = /** @type {{ block_index?: unknown[] }} */ (editMap.appendix);
  const rows = Array.isArray(appendix?.block_index) ? appendix.block_index : [];
  const bi = rows.find((x) => x && typeof x === 'object' && x.id === blockId) || null;

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
    aspectRatio,
  };
}

/**
 * 从全局 asset_tag_mapping 和 block_index.present_asset_ids 构建 Block 局部资产映射。
 * 黑箱化：Prompter 只能看到从 @图1 开始的局部编号，不可能接触到全局编号。
 *
 * @param {unknown[]} globalMapping  全局 asset_tag_mapping 数组（EditMap 输出）
 * @param {string[]} presentAssetIds  当前 Block 的 present_asset_ids
 * @returns {{ localMapping: Record<string, string>, localMappingList: Array<{tag: string, asset_id: string, description: string}> }}
 */
function buildBlockLocalAssetMapping(globalMapping, presentAssetIds) {
  /** @type {Map<string, string>} */
  const idToDesc = new Map();
  if (Array.isArray(globalMapping)) {
    for (const item of globalMapping) {
      if (item && typeof item === 'object') {
        const entry = /** @type {Record<string, unknown>} */ (item);
        const aid = typeof entry.asset_id === 'string' ? entry.asset_id : '';
        const desc = typeof entry.description === 'string'
          ? entry.description
          : (typeof entry.label === 'string' ? entry.label : aid);
        if (aid) {
          idToDesc.set(aid, desc);
        }
      }
    }
  }

  /** @type {Record<string, string>} */
  const localMapping = {};
  /** @type {Array<{tag: string, asset_id: string, description: string}>} */
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

export function buildPrompterPayloadV4({
  editMap,
  blockId,
  kbDir,
  renderingStyle,
  artStyle,
  maxExamples = 2,
  aspectRatio = '16:9',
  directorMarkdownSection = '',
  knowledgeSlices = [],
}) {
  const { block } = findBlock(editMap, blockId);
  const appendix = /** @type {{ block_index?: unknown[] }} */ (editMap.appendix);
  const rows = Array.isArray(appendix?.block_index) ? appendix.block_index : [];
  const bi = rows.find((x) => x && typeof x === 'object' && x.id === blockId) || null;

  const fewShotContext = selectFewShotContext({
    kbDir,
    retrieval: block.few_shot_retrieval,
    maxExamples,
  });

  const meta =
    editMap.meta && typeof editMap.meta === 'object'
      ? /** @type {Record<string, unknown>} */ (editMap.meta)
      : {};

  // ── 黑箱化：只向 Prompter 传 Block 局部资产映射，从 @图1 开始 ──
  const presentAssetIds = bi && typeof bi === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (bi).present_asset_ids)
    ? /** @type {string[]} */ (/** @type {Record<string, unknown>} */ (bi).present_asset_ids)
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
      renderingStyle || (typeof meta.rendering_style === 'string' ? meta.rendering_style : '') ||
      '3D写实动画',
    artStyle: artStyle !== undefined ? artStyle : meta.art_style ?? null,
    aspectRatio,
    block_id: blockId,
  };
}

/**
 * @param {object} opts
 */
export function buildAllDirectorPayloadsV4({
  editMap,
  kbDir,
  renderingStyle,
  aspectRatio = '16:9',
  maxExamples = 2,
}) {
  const blocks = Array.isArray(editMap.blocks) ? editMap.blocks : [];
  return {
    meta: {
      source_title: editMap.meta?.title || null,
      block_count: blocks.length,
      generated_at: new Date().toISOString(),
      kb_dir: kbDir,
      kind: 'sd2_director_payloads_v4',
      sd2_version: 'v4',
    },
    payloads: blocks.map((b) => {
      const id = /** @type {{ id?: string }} */ (b).id;
      return {
        block_id: id,
        payload: buildDirectorPayloadV4({
          editMap,
          blockId: id,
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
