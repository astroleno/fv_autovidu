/**
 * EditMap-SD2 输出形状归一化。
 *
 * 部分模型会把 `blocks` 嵌在 `meta.blocks`；而 `build_sd2_prompter_payload.js`、
 * `call_sd2_block_chain.mjs` 等约定顶层存在 `blocks` 数组。
 * 在写入磁盘前做一次提升，避免 director payload 为空。
 *
 * @param {unknown} parsed
 * @returns {unknown}
 */
export function normalizeEditMapSd2Shape(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return parsed;
  }
  const root = /** @type {Record<string, unknown>} */ (parsed);
  const meta = root.meta;
  if (!meta || typeof meta !== 'object') {
    return parsed;
  }
  const mb = /** @type {{ blocks?: unknown }} */ (meta).blocks;
  if (!Array.isArray(mb) || mb.length === 0) {
    return parsed;
  }
  const top = root.blocks;
  if (!Array.isArray(top) || top.length === 0) {
    root.blocks = mb;
  }
  return parsed;
}
