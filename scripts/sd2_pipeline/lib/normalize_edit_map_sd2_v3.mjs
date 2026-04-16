/**
 * EditMap-SD2 **v3**：LLM 返回 `{ markdown_body, appendix }`，不再使用顶层 `blocks[]`。
 * 本模块将附录与正文整理为编排层可用的统一形状：
 * - 顶层 `meta` ← `appendix.meta`（供 resolveSd2StyleHints、下游透传）
 * - 顶层 `blocks[]`：由 `appendix.block_index` 合成，每块带 `few_shot_retrieval` 与 `_v3_edit_map_markdown`（当前组段落）
 * - `sd2_version: 'v3'`
 *
 * @param {string} markdownBody
 * @param {number} groupNum 1-based，与 block_index 顺序一致
 * @returns {string}
 */
export function extractEditMapParagraphForGroup(markdownBody, groupNum) {
  if (!markdownBody || typeof markdownBody !== 'string' || groupNum < 1) {
    return '';
  }
  const g = groupNum;
  const headerRe = new RegExp(`^###\\s*段落\\s*\\d+\\s*（第${g}组）`, 'm');
  const chunks = markdownBody.split(/(?=^###\s*段落\s*\d+\s*（第\d+组）)/m);
  for (const chunk of chunks) {
    if (headerRe.test(chunk)) {
      const body = chunk.replace(/^###\s*段落[^\n]+\n/, '');
      const cut = body.split(/\n## 【尾部校验块】/)[0];
      return cut.trim();
    }
  }
  return '';
}

/**
 * @param {unknown} parsed
 * @returns {unknown}
 */
export function normalizeEditMapSd2V3(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return parsed;
  }
  const root = /** @type {Record<string, unknown>} */ (parsed);
  const md = root.markdown_body;
  const appendix = root.appendix;
  if (typeof md !== 'string' || !appendix || typeof appendix !== 'object') {
    return parsed;
  }

  const app = /** @type {{ meta?: unknown, block_index?: unknown, diagnosis?: unknown }} */ (
    appendix
  );
  const metaIn = app.meta && typeof app.meta === 'object'
    ? /** @type {Record<string, unknown>} */ ({ ...app.meta })
    : {};

  const pb = metaIn.parsed_brief;
  if (pb && typeof pb === 'object') {
    const p = /** @type {Record<string, unknown>} */ (pb);
    if (!metaIn.rendering_style && typeof p.renderingStyle === 'string') {
      metaIn.rendering_style = p.renderingStyle;
    }
    if (!metaIn.art_style && typeof p.artStyle === 'string') {
      metaIn.art_style = p.artStyle;
    }
  }

  root.meta = metaIn;
  root.appendix = appendix;
  root.sd2_version = 'v3';

  const bi = Array.isArray(app.block_index) ? app.block_index : [];
  /** @type {unknown[]} */
  const blocks = [];
  let idx = 0;
  for (const row of bi) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const b = /** @type {Record<string, unknown>} */ (row);
    const id = typeof b.id === 'string' ? b.id : '';
    if (!id) {
      continue;
    }
    idx += 1;
    const start = typeof b.start_sec === 'number' ? b.start_sec : 0;
    const end = typeof b.end_sec === 'number' ? b.end_sec : start;
    const dur = typeof b.duration === 'number' ? b.duration : Math.max(0, end - start);
    const sectionMd = extractEditMapParagraphForGroup(md, idx) || md.slice(0, 8000);

    blocks.push({
      id,
      time: { start_sec: start, end_sec: end, duration: dur },
      few_shot_retrieval: {
        scene_bucket: b.scene_bucket || 'mixed',
        scene_archetype: b.scene_archetype || null,
        structural_tags: Array.isArray(b.structural_tags) ? b.structural_tags : [],
        injection_goals: Array.isArray(b.injection_goals) ? b.injection_goals : [],
      },
      _v3_edit_map_markdown: sectionMd,
    });
  }

  root.blocks = blocks;
  return parsed;
}
