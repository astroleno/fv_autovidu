/**
 * EditMap-SD2 **v3**：LLM 返回 `{ markdown_body, appendix }`，不再使用顶层 `blocks[]`。
 * 本模块将附录与正文整理为编排层可用的统一形状：
 * - 顶层 `meta` ← `appendix.meta`（供 resolveSd2StyleHints、下游透传）
 * - 顶层 `blocks[]`：由 `appendix.block_index` 合成，每块带 `few_shot_retrieval` 与 `_v3_edit_map_markdown`（当前组段落）
 * - `sd2_version: 'v3'`
 *
 * v5.0-rev1 双格式兼容（2026-04-17）：
 * 本仓 v3/v4 时期 markdown_body 用 `### 段落 N（第 G 组）` 做分段标题；
 * 但 EditMap v5 的实际产出改用自由格式的 `### B{NN}` 子标题（每个 block 一节）。
 * 本函数同时支持两种格式：优先按 blockId 匹配 v5 `### B{NN}`，匹配失败再回退到 v3 `### 段落 N`；
 * 两种都匹配不到时，仍保持旧行为（返回空串，调用方会回退到整段 markdown）。
 *
 * @param {string} markdownBody
 * @param {number} groupNum 1-based，与 block_index 顺序一致
 * @param {string} [blockId] 形如 `"B01"`；若给出，优先按 v5 `### B{NN}` 格式切片
 * @returns {string}
 */
export function extractEditMapParagraphForGroup(markdownBody, groupNum, blockId) {
  if (!markdownBody || typeof markdownBody !== 'string' || groupNum < 1) {
    return '';
  }

  // ── 优先路径：v5 `### B{NN}` 切片（需要已知 blockId） ──
  if (typeof blockId === 'string' && /^B\d+$/.test(blockId)) {
    const v5HeaderRe = new RegExp(`^###\\s*${blockId}\\b`, 'm');
    const v5Chunks = markdownBody.split(/(?=^###\s*B\d+\b)/m);
    for (const chunk of v5Chunks) {
      if (v5HeaderRe.test(chunk)) {
        // 去掉本块的 `### B{NN}` 首行；向后切到下一个 `## ` 大标题为止
        // （不再依赖 v3 的 `## 【尾部校验块】` 锚点——v5 尾部校验块已被 diagnosis/appendix 吸收）
        const body = chunk.replace(/^###\s*B\d+[^\n]*\n?/, '');
        const cut = body.split(/\n## /)[0];
        return cut.trim();
      }
    }
  }

  // ── 回退路径：v3 `### 段落 N（第 G 组）` 切片 ──
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
    // v5.0-rev5 · 字段名软兼容：优先 block_id，回退 id
    //   normalize_edit_map_sd2_v5 会把 LLM 误写的 id 升级成 block_id；但若调用方跳过了 v5 层，
    //   这里仍需对裸 v5 appendix 做一次兜底，避免 block 被全部过滤掉。
    const id = typeof b.block_id === 'string'
      ? b.block_id
      : typeof b.id === 'string'
        ? b.id
        : '';
    if (!id) {
      continue;
    }
    idx += 1;
    const start = typeof b.start_sec === 'number' ? b.start_sec : 0;
    const end = typeof b.end_sec === 'number' ? b.end_sec : start;
    const dur = typeof b.duration === 'number' ? b.duration : Math.max(0, end - start);
    // v5.0-rev1：传 id 走 v5 `### B{NN}` 切片；匹配不到会自动回退到 v3 `### 段落 N`；仍不到则整段 md
    const sectionMd = extractEditMapParagraphForGroup(md, idx, id) || md.slice(0, 8000);

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

  // ── skeleton_integrity_check：block_index 数量 vs markdown 段落数 ──
  // v5.0-rev5 · 三格式兼容：
  //   - v3 子标题：`### 段落 N`
  //   - v5 子标题：`### B{NN}`（Scheme B 早期 prompt 的产出）
  //   - v5 紧凑组骨架：`B01｜4s｜场景：…｜节奏型：1`（prompt §II 原话："沿用 v4"，v4 就是紧凑单行）
  //     注意全角竖线 `｜` 与半角 `|` 都兼容；且必须排除【组骨架】块外的误伤（B01 出现在正文里时前面不会有行首竖线结构）
  const v3Paragraphs = md.match(/^###\s*段落\s*\d+/gm) || [];
  const v5Paragraphs = md.match(/^###\s*B\d+\b/gm) || [];
  const v5Compact = md.match(/^B\d+\s*[｜|]/gm) || [];
  const paragraphCount = Math.max(v3Paragraphs.length, v5Paragraphs.length, v5Compact.length);
  const paragraphFormat =
    v5Compact.length >= Math.max(v3Paragraphs.length, v5Paragraphs.length)
      ? 'v5Compact(B{NN}｜)'
      : v5Paragraphs.length >= v3Paragraphs.length
        ? 'v5(### B\\d+)'
        : 'v3(### 段落 N)';
  const blockCount = blocks.length;
  const skeletonOk = paragraphCount > 0 && blockCount === paragraphCount;

  if (!skeletonOk && paragraphCount > 0) {
    console.warn(
      `[normalizeEditMapSd2V3] skeleton_integrity_check FAIL: block_index=${blockCount} ≠ markdown段落=${paragraphCount}（format=${paragraphFormat}）`
    );
  } else if (!skeletonOk && paragraphCount === 0) {
    console.warn(
      `[normalizeEditMapSd2V3] skeleton_integrity_check FAIL: markdown_body 未找到 v3 '### 段落 N' / v5 '### B{NN}' / v5 紧凑 'B{NN}｜' 任一骨架；block_count=${blockCount}`
    );
  }

  // ── 时长守恒后置校验 ──
  const targetDur = typeof metaIn.target_duration_sec === 'number'
    ? metaIn.target_duration_sec
    : 0;
  let actualSum = 0;
  let lastEnd = 0;
  for (const blk of blocks) {
    const t = /** @type {{ time?: { duration?: number, end_sec?: number } }} */ (blk).time;
    if (t) {
      actualSum += typeof t.duration === 'number' ? t.duration : 0;
      lastEnd = typeof t.end_sec === 'number' ? t.end_sec : lastEnd;
    }
  }

  const durationOk = actualSum > 0 && actualSum === targetDur && actualSum === lastEnd;

  if (actualSum > 0 && actualSum !== targetDur) {
    console.warn(
      `[normalizeEditMapSd2V3] duration_sum_check FAIL: sum(blocks)=${actualSum} ≠ target=${targetDur}`
    );
  }
  if (actualSum > 0) {
    metaIn.total_duration_sec = actualSum;
  }

  // ── max_block_duration_check：单组不得超过 SD2_MAX_BLOCK_DURATION_SEC（默认 16s；与 v3 注释及业务一致，曾误写 15 导致合法 16s 被拒）──
  /** @type {string[]} */
  const overLimitBlocks = [];
  const envMax = Number.parseInt(process.env.SD2_MAX_BLOCK_DURATION_SEC ?? '', 10);
  const MAX_BLOCK_DUR = Number.isFinite(envMax) && envMax >= 4 && envMax <= 30 ? envMax : 16;
  for (const blk of blocks) {
    const t = /** @type {{ time?: { duration?: number }, id?: string }} */ (blk).time;
    const blkId = /** @type {{ id?: string }} */ (blk).id || '?';
    if (t && typeof t.duration === 'number' && t.duration > MAX_BLOCK_DUR) {
      overLimitBlocks.push(`${blkId}=${t.duration}s`);
    }
  }
  const maxBlockDurationOk = overLimitBlocks.length === 0;
  if (!maxBlockDurationOk) {
    console.warn(
      `[normalizeEditMapSd2V3] max_block_duration_check WARN: ${overLimitBlocks.join(', ')} 超过建议上限 ${MAX_BLOCK_DUR}s（EditMap 调度器对超长块仅软门告警，不拒写；可用 SD2_MAX_BLOCK_DURATION_SEC 覆盖 4–30）`,
    );
  }

  const diag = app.diagnosis && typeof app.diagnosis === 'object'
    ? /** @type {Record<string, unknown>} */ (app.diagnosis)
    : {};
  diag.duration_sum_check = durationOk;
  diag.skeleton_integrity_check = skeletonOk;
  diag.max_block_duration_check = maxBlockDurationOk;
  if (app.diagnosis && typeof app.diagnosis === 'object') {
    Object.assign(app.diagnosis, {
      duration_sum_check: durationOk,
      skeleton_integrity_check: skeletonOk,
      max_block_duration_check: maxBlockDurationOk,
    });
  }

  // ── 将校验结果挂到 root 上，供调用方判断是否 retry ──
  root._validation = {
    duration_sum_check: durationOk,
    skeleton_integrity_check: skeletonOk,
    max_block_duration_check: maxBlockDurationOk,
    over_limit_blocks: overLimitBlocks,
    block_count: blockCount,
    paragraph_count: paragraphCount,
    actual_duration_sum: actualSum,
    target_duration: targetDur,
    last_end_sec: lastEnd,
  };

  return parsed;
}
