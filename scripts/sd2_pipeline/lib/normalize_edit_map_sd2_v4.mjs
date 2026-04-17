/**
 * EditMap-SD2 **v4**：输出形状与 v3 相同（markdown_body + appendix.block_index），
 * 但附录含 scene_run_id / present_asset_ids / rhythm_tier 等 v3.1 合同字段。
 * 复用 v3 归一化（段落拆分、blocks[] 合成），仅将 sd2_version 标为 v4。
 */
import { normalizeEditMapSd2V3 } from './normalize_edit_map_sd2_v3.mjs';

/**
 * @param {unknown} parsed
 * @returns {unknown}
 */
export function normalizeEditMapSd2V4(parsed) {
  normalizeEditMapSd2V3(parsed);
  if (parsed && typeof parsed === 'object') {
    /** @type {Record<string, unknown>} */ (parsed).sd2_version = 'v4';
  }
  return parsed;
}
