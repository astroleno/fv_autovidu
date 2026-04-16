/**
 * SD2 v3：Director / Prompter 的 JSON 输入组装（与 v2 的 edit_map_block 结构解耦）。
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  findBlock,
  selectFewShotContext,
} = require('../../build_sd2_prompter_payload.js');

/**
 * @param {unknown[]} blocks
 * @param {number} blockIndex
 * @returns {null|{ continuity_state: { lighting_state: null, axis_state: null, focal_area_dominant: null, last_action_state: null } }}
 */
function buildPrevBlockContextV3(blocks, blockIndex) {
  if (blockIndex <= 0) {
    return null;
  }
  const previous = blocks[blockIndex - 1];
  const continuity =
    previous && typeof previous === 'object' && previous.continuity_hints
      ? /** @type {Record<string, unknown>} */ (previous.continuity_hints)
      : {};
  return {
    continuity_state: {
      lighting_state: /** @type {unknown} */ (continuity.lighting_state) ?? null,
      axis_state: /** @type {unknown} */ (continuity.axis_state) ?? null,
      focal_area_dominant: /** @type {unknown} */ (continuity.focal_area_dominant) ?? null,
      last_action_state: /** @type {unknown} */ (continuity.last_action_state) ?? null,
    },
  };
}

/**
 * @param {object} opts
 * @param {unknown} opts.editMap
 * @param {string} opts.blockId
 * @param {string} [opts.kbDir]
 * @param {string} [opts.renderingStyle]
 * @param {string} [opts.aspectRatio]
 * @param {number} [opts.maxExamples]
 */
export function buildDirectorPayloadV3({
  editMap,
  blockId,
  kbDir,
  renderingStyle,
  aspectRatio = '16:9',
  maxExamples = 2,
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

  const meta = editMap.meta && typeof editMap.meta === 'object'
    ? /** @type {Record<string, unknown>} */ (editMap.meta)
    : {};

  const md =
    typeof block._v3_edit_map_markdown === 'string' ? block._v3_edit_map_markdown : '';

  return {
    editMapMarkdown: md,
    blockIndex: bi,
    assetTagMapping: meta.asset_tag_mapping || [],
    parsedBrief: meta.parsed_brief ?? null,
    episodeForbiddenWords: meta.episode_forbidden_words || [],
    prev_block_context: buildPrevBlockContextV3(blocks, blockIndex),
    few_shot_context: fewShotContext,
    rendering_style:
      renderingStyle || (typeof meta.rendering_style === 'string' ? meta.rendering_style : '') || '3D写实动画',
    aspect_ratio: aspectRatio,
  };
}

/**
 * @param {object} opts
 * @param {unknown} opts.editMap
 * @param {string} opts.blockId
 * @param {string} [opts.kbDir]
 * @param {string} [opts.renderingStyle]
 * @param {string} [opts.artStyle]
 * @param {number} [opts.maxExamples]
 * @param {string} [opts.aspectRatio]
 * @param {Record<string, unknown>|null} [opts.directorByBlockId]
 */
export function buildPrompterPayloadV3({
  editMap,
  blockId,
  kbDir,
  renderingStyle,
  artStyle,
  maxExamples = 2,
  aspectRatio = '16:9',
  directorByBlockId = null,
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

  const meta = editMap.meta && typeof editMap.meta === 'object'
    ? /** @type {Record<string, unknown>} */ (editMap.meta)
    : {};

  let directorShotList = '';
  if (
    directorByBlockId &&
    typeof directorByBlockId === 'object' &&
    directorByBlockId[blockId] &&
    typeof directorByBlockId[blockId].markdown_body === 'string'
  ) {
    directorShotList = directorByBlockId[blockId].markdown_body;
  }

  return {
    directorShotList,
    assetTagMapping: meta.asset_tag_mapping || [],
    episodeForbiddenWords: meta.episode_forbidden_words || [],
    parsedBrief: meta.parsed_brief ?? null,
    blockTime: bi,
    block_id: blockId,
    few_shot_context: fewShotContext,
    rendering_style:
      renderingStyle || (typeof meta.rendering_style === 'string' ? meta.rendering_style : '') || '3D写实动画',
    art_style: artStyle !== undefined ? artStyle : meta.art_style ?? null,
    aspect_ratio: aspectRatio,
  };
}

/**
 * @param {object} opts
 */
export function buildAllDirectorPayloadsV3({
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
      kind: 'sd2_director_payloads_v3',
      sd2_version: 'v3',
    },
    payloads: blocks.map((b) => {
      const id = /** @type {{ id?: string }} */ (b).id;
      return {
        block_id: id,
        payload: buildDirectorPayloadV3({
          editMap,
          blockId: id,
          kbDir,
          renderingStyle,
          aspectRatio,
          maxExamples,
        }),
      };
    }),
  };
}
