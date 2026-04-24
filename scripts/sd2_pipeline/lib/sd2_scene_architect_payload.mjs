/**
 * Stage 1.5 · Scene Architect v1 · payload 打包 + 输出校验 + editMap 回灌
 *
 * 契约源：
 *   - 系统提示词：`prompt/1_SD2Workflow/1_5_SceneArchitect/1_5_SceneArchitect-v1.md`
 *   - 场级调度契约：`prompt/1_SD2Workflow/docs/v6/05_v6-场级调度与音频意图.md`
 *   - 节奏时间线契约：`prompt/1_SD2Workflow/docs/v6/06_v6-节奏推导与爆点密度.md`
 *
 * PoC 范围（用户决策 D1/D3）：
 *   - rhythm_timeline 微调（±3s，条目数不变）
 *   - KVA 编排建议（追加 suggested_block_id / suggested_shot_role，条目数不变）
 *   - 回灌策略：并列落盘（original 留底 + adjusted 原位更新 + 单独产物文件）
 *
 * 本文件只做纯函数：
 *   - buildSceneArchitectPayload(editMap, nsp, episode)  构造 LLM 输入
 *   - validateSceneArchitectOutput(rawOut, payload)      校验输出合规性并过滤非法项
 *   - applySceneArchitectToEditMap(editMap, validated)   将合规输出回灌到 editMap
 *   - 不执行 I/O、不发网络请求；由 runner 上层调用。
 */

/** 容差：mini_climax / major_climax 的 at_sec 允许偏移范围（秒）。契约 §二 铁律 3。 */
const AT_SEC_TOLERANCE_SEC = 3;

/** KVA 编排合法的 shot_role 取值（契约 §四）。 */
const VALID_SHOT_ROLES = new Set([
  'opening_beat',
  'climax_shot',
  'reveal_shot',
  'reaction_shot',
  'bridge_shot',
  'closing_residue',
]);

/**
 * 从 normalized_script_package 汇总所有 KVA（跨 beat 铺平）。
 * 附带 beat_id 方便下游审计。
 *
 * @param {Record<string, unknown> | null | undefined} nsp
 * @returns {Array<Record<string, unknown>>}
 */
function extractKvaFlat(nsp) {
  if (!nsp || typeof nsp !== 'object') return [];
  const beats = /** @type {unknown} */ (
    /** @type {Record<string, unknown>} */ (nsp).beat_ledger
  );
  if (!Array.isArray(beats)) return [];
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const b of beats) {
    if (!b || typeof b !== 'object') continue;
    const beat = /** @type {Record<string, unknown>} */ (b);
    const beatId = typeof beat.beat_id === 'string' ? beat.beat_id : '';
    const kvas = beat.key_visual_actions;
    if (!Array.isArray(kvas)) continue;
    for (const k of kvas) {
      if (!k || typeof k !== 'object') continue;
      const kva = /** @type {Record<string, unknown>} */ (k);
      out.push({
        kva_id: typeof kva.kva_id === 'string' ? kva.kva_id : '',
        source_seg_id: typeof kva.source_seg_id === 'string' ? kva.source_seg_id : '',
        action_type: typeof kva.action_type === 'string' ? kva.action_type : '',
        summary: typeof kva.summary === 'string' ? kva.summary : '',
        priority: typeof kva.priority === 'string' ? kva.priority : 'P2',
        beat_id: beatId,
        required_shot_count_min:
          typeof kva.required_shot_count_min === 'number'
            ? kva.required_shot_count_min
            : 1,
        required_structure_hints: Array.isArray(kva.required_structure_hints)
          ? kva.required_structure_hints
          : [],
      });
    }
  }
  return out;
}

/**
 * 压缩 segments：普通段只带前 40 字；关键调度依据带 text_full。
 *
 * @param {Record<string, unknown> | null | undefined} nsp
 * @param {Set<string>} criticalSegIds
 * @returns {Array<Record<string, unknown>>}
 */
function extractSegmentsCompact(nsp, criticalSegIds = new Set()) {
  if (!nsp || typeof nsp !== 'object') return [];
  const beats = /** @type {unknown} */ (
    /** @type {Record<string, unknown>} */ (nsp).beat_ledger
  );
  if (!Array.isArray(beats)) return [];
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const b of beats) {
    if (!b || typeof b !== 'object') continue;
    const beat = /** @type {Record<string, unknown>} */ (b);
    const segs = beat.segments;
    if (!Array.isArray(segs)) continue;
    for (const s of segs) {
      if (!s || typeof s !== 'object') continue;
      const seg = /** @type {Record<string, unknown>} */ (s);
      const text = typeof seg.text === 'string' ? seg.text : '';
      const item = {
        seg_id: typeof seg.seg_id === 'string' ? seg.seg_id : '',
        segment_type: typeof seg.segment_type === 'string' ? seg.segment_type : 'descriptive',
        speaker: typeof seg.speaker === 'string' ? seg.speaker : null,
        text_first_40: text.length > 40 ? text.slice(0, 40) : text,
      };
      if (criticalSegIds.has(item.seg_id)) {
        item.text_full = text;
      }
      out.push(item);
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown> | null} rhythmTimeline
 * @param {Array<Record<string, unknown>>} kvas
 * @returns {Set<string>}
 */
function collectCriticalSegmentIds(rhythmTimeline, kvas) {
  const ids = new Set();
  const rt = rhythmTimeline && typeof rhythmTimeline === 'object' ? rhythmTimeline : {};
  for (const mc of Array.isArray(rt.mini_climaxes) ? rt.mini_climaxes : []) {
    if (!mc || typeof mc !== 'object') continue;
    const m = /** @type {Record<string, unknown>} */ (mc);
    const sid =
      typeof m.trigger_source_seg_id === 'string'
        ? m.trigger_source_seg_id
        : typeof m.trigger === 'string'
          ? m.trigger
          : '';
    if (sid) ids.add(sid);
  }
  for (const key of ['major_climax', 'closing_hook']) {
    const item = rt[key] && typeof rt[key] === 'object'
      ? /** @type {Record<string, unknown>} */ (rt[key])
      : null;
    const sid =
      item && typeof item.trigger_source_seg_id === 'string'
        ? item.trigger_source_seg_id
        : item && typeof item.trigger === 'string'
          ? item.trigger
          : '';
    if (sid) ids.add(sid);
  }
  for (const kva of kvas) {
    const sid = typeof kva.source_seg_id === 'string' ? kva.source_seg_id : '';
    if (sid) ids.add(sid);
  }
  return ids;
}

/**
 * 压缩 appendix.block_index[] 为 LLM 可读的最小档：
 *   - block_id / start_sec / end_sec / duration / scene_name / covered_segment_ids / shot_budget_hint
 *   - 丢弃 routing / script_chunk_hint 等大字段（给 Director 用，不是给 Scene Architect）。
 *
 * @param {Record<string, unknown>} editMap
 * @returns {Array<Record<string, unknown>>}
 */
function extractBlockIndexCompact(editMap) {
  const appendix = /** @type {unknown} */ (editMap.appendix);
  if (!appendix || typeof appendix !== 'object') return [];
  const idx = /** @type {Record<string, unknown>} */ (appendix).block_index;
  if (!Array.isArray(idx)) return [];
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const b of idx) {
    if (!b || typeof b !== 'object') continue;
    const blk = /** @type {Record<string, unknown>} */ (b);
    out.push({
      block_id: typeof blk.block_id === 'string' ? blk.block_id : '',
      start_sec: typeof blk.start_sec === 'number' ? blk.start_sec : 0,
      end_sec: typeof blk.end_sec === 'number' ? blk.end_sec : 0,
      duration: typeof blk.duration === 'number' ? blk.duration : 0,
      scene_name: typeof blk.scene_name === 'string' ? blk.scene_name : '',
      covered_segment_ids: Array.isArray(blk.covered_segment_ids)
        ? blk.covered_segment_ids
        : [],
      shot_budget_hint:
        blk.shot_budget_hint && typeof blk.shot_budget_hint === 'object'
          ? blk.shot_budget_hint
          : { target: 3, tolerance: [2, 4] },
    });
  }
  return out;
}

/**
 * 构造 Scene Architect 的 LLM 输入 payload（作为 user 消息的 JSON 段）。
 *
 * @param {Record<string, unknown>} editMap  EditMap v6 产物（已含 meta / appendix）
 * @param {Record<string, unknown> | null} nsp  normalized_script_package（v2）
 * @param {{ duration_sec: number; episode_id: string }} episode
 * @returns {Record<string, unknown>}
 */
export function buildSceneArchitectPayload(editMap, nsp, episode) {
  const meta = /** @type {Record<string, unknown>} */ (editMap.meta || {});
  const styleInference = meta.style_inference || {};
  const rhythmDraft = meta.rhythm_timeline || null;
  const kvas = extractKvaFlat(nsp);
  const criticalSegIds = collectCriticalSegmentIds(
    rhythmDraft && typeof rhythmDraft === 'object'
      ? /** @type {Record<string, unknown>} */ (rhythmDraft)
      : null,
    kvas,
  );
  return {
    episode,
    style_inference: styleInference,
    rhythm_timeline_draft: rhythmDraft,
    block_index_compact: extractBlockIndexCompact(editMap),
    key_visual_actions: kvas,
    segments_compact: extractSegmentsCompact(nsp, criticalSegIds),
  };
}

/**
 * 找出某个 seg_id 落在哪个 block 的 covered_segment_ids 中，返回 block_id；未命中返回空串。
 *
 * @param {Array<Record<string, unknown>>} blockIndexCompact
 * @param {string} segId
 * @returns {string}
 */
function findBlockIdBySegId(blockIndexCompact, segId) {
  if (!segId) return '';
  for (const blk of blockIndexCompact) {
    const covered = Array.isArray(blk.covered_segment_ids)
      ? /** @type {string[]} */ (blk.covered_segment_ids)
      : [];
    if (covered.indexOf(segId) >= 0) {
      return typeof blk.block_id === 'string' ? blk.block_id : '';
    }
  }
  return '';
}

/**
 * 按 block_id 找块边界 [start_sec, end_sec]；未命中返回 null。
 *
 * @param {Array<Record<string, unknown>>} blockIndexCompact
 * @param {string} blockId
 * @returns {{ start_sec: number; end_sec: number } | null}
 */
function findBlockBounds(blockIndexCompact, blockId) {
  for (const blk of blockIndexCompact) {
    if (blk.block_id === blockId) {
      return {
        start_sec: typeof blk.start_sec === 'number' ? blk.start_sec : 0,
        end_sec: typeof blk.end_sec === 'number' ? blk.end_sec : 0,
      };
    }
  }
  return null;
}

/**
 * 清洗 LLM 返回的 rhythm_timeline：
 *   - 条目数必须等于 draft
 *   - at_sec 必须在原值 ±3s 且 ∈ 对应 block 边界
 *   - golden_open_3s / closing_hook 强制回写 draft（禁改）
 * 对非法的单条 climax，回退使用 draft 原值，并记录 issue。
 *
 * @param {Record<string, unknown>} rhythmFromLlm
 * @param {Record<string, unknown> | null} draft
 * @param {Array<Record<string, unknown>>} blockIndexCompact
 * @param {string[]} issues
 * @returns {Record<string, unknown>}
 */
function sanitizeRhythmTimeline(rhythmFromLlm, draft, blockIndexCompact, issues) {
  if (!draft) return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  out.derived_from = draft.derived_from;
  out.golden_open_3s = draft.golden_open_3s;
  out.closing_hook = draft.closing_hook;

  const draftMinis = Array.isArray(draft.mini_climaxes) ? draft.mini_climaxes : [];
  const llmMinis = Array.isArray(rhythmFromLlm.mini_climaxes)
    ? rhythmFromLlm.mini_climaxes
    : [];

  if (llmMinis.length !== draftMinis.length) {
    issues.push(
      `mini_climaxes length mismatch (draft=${draftMinis.length}, llm=${llmMinis.length}); fell back to draft`,
    );
    out.mini_climaxes = draftMinis;
  } else {
    /** @type {Array<Record<string, unknown>>} */
    const sanitized = [];
    for (let i = 0; i < draftMinis.length; i += 1) {
      const draftItem = /** @type {Record<string, unknown>} */ (draftMinis[i]);
      const llmItem = /** @type {Record<string, unknown>} */ (llmMinis[i]);
      sanitized.push(sanitizeClimaxItem(llmItem, draftItem, blockIndexCompact, issues, `mini[${i}]`));
    }
    out.mini_climaxes = sanitized;
  }

  const draftMajor = /** @type {Record<string, unknown> | null} */ (
    draft.major_climax || null
  );
  const llmMajor = /** @type {Record<string, unknown> | null} */ (
    rhythmFromLlm.major_climax || null
  );
  if (draftMajor && llmMajor) {
    out.major_climax = sanitizeClimaxItem(llmMajor, draftMajor, blockIndexCompact, issues, 'major');
  } else {
    out.major_climax = draftMajor;
  }

  return out;
}

/**
 * 清洗单条 climax：
 *   - at_sec 偏移超 ±3s 或越出块边界 → 回退 draft 原值
 *   - 条目的 block_id / motif / trigger_source_seg_id 回写 draft（禁改）
 *   - five_stage 允许 LLM 微调 shot_idx_hint（≥1），desc 允许更新
 *
 * @param {Record<string, unknown>} llmItem
 * @param {Record<string, unknown>} draftItem
 * @param {Array<Record<string, unknown>>} blockIndexCompact
 * @param {string[]} issues
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function sanitizeClimaxItem(llmItem, draftItem, blockIndexCompact, issues, label) {
  const draftAt =
    typeof draftItem.at_sec_final === 'number'
      ? draftItem.at_sec_final
      : typeof draftItem.at_sec_derived === 'number'
      ? draftItem.at_sec_derived
      : typeof draftItem.at_sec === 'number'
      ? draftItem.at_sec
      : 0;
  const llmAt = typeof llmItem.at_sec === 'number' ? llmItem.at_sec : draftAt;
  const blockId = typeof draftItem.block_id === 'string' ? draftItem.block_id : '';
  const bounds = findBlockBounds(blockIndexCompact, blockId);

  let finalAt = draftAt;
  if (Math.abs(llmAt - draftAt) <= AT_SEC_TOLERANCE_SEC) {
    if (bounds && llmAt >= bounds.start_sec && llmAt <= bounds.end_sec) {
      finalAt = llmAt;
    } else if (bounds) {
      issues.push(
        `${label}.at_sec=${llmAt} out of block ${blockId} [${bounds.start_sec}, ${bounds.end_sec}]; kept draft ${draftAt}`,
      );
    }
  } else {
    issues.push(
      `${label}.at_sec delta=${(llmAt - draftAt).toFixed(2)}s exceeds ±${AT_SEC_TOLERANCE_SEC}s; kept draft ${draftAt}`,
    );
  }

  return {
    seq: draftItem.seq,
    at_sec: finalAt,
    at_sec_draft: draftAt,
    block_id: draftItem.block_id,
    motif: draftItem.motif,
    trigger_source_seg_id: draftItem.trigger_source_seg_id,
    duration_sec: draftItem.duration_sec,
    five_stage: sanitizeFiveStage(llmItem.five_stage, draftItem.five_stage),
  };
}

/**
 * five_stage 允许 LLM 改 shot_idx_hint / desc；缺失则回退 draft。
 *
 * @param {unknown} llmFs
 * @param {unknown} draftFs
 * @returns {Record<string, unknown>}
 */
function sanitizeFiveStage(llmFs, draftFs) {
  const draftObj = /** @type {Record<string, unknown>} */ (
    draftFs && typeof draftFs === 'object' ? draftFs : {}
  );
  const llmObj = /** @type {Record<string, unknown>} */ (
    llmFs && typeof llmFs === 'object' ? llmFs : {}
  );
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const stage of ['trigger', 'amplify', 'pivot', 'payoff', 'residue']) {
    const d = /** @type {Record<string, unknown>} */ (draftObj[stage] || {});
    const l = /** @type {Record<string, unknown>} */ (llmObj[stage] || {});
    out[stage] = {
      shot_idx_hint:
        typeof l.shot_idx_hint === 'number' && l.shot_idx_hint >= 1
          ? l.shot_idx_hint
          : typeof d.shot_idx_hint === 'number'
          ? d.shot_idx_hint
          : 1,
      desc: typeof l.desc === 'string' && l.desc.trim() ? l.desc.trim() : d.desc || '',
    };
  }
  return out;
}

/**
 * 清洗 KVA 编排：
 *   - kva_arrangements.length 必须等于 payload.key_visual_actions.length
 *   - suggested_block_id 必须让该块覆盖到 KVA 的 source_seg_id；否则置空（由下游按默认处理）
 *   - suggested_shot_role 必须在合法取值域；否则置空
 *   - 不得修改 kva_id / source_seg_id / priority / action_type / summary（这些字段由管线从输入回填，LLM 送什么不 care）
 *
 * @param {Array<unknown>} llmArrangements
 * @param {Array<Record<string, unknown>>} kvaInput
 * @param {Array<Record<string, unknown>>} blockIndexCompact
 * @param {string[]} issues
 * @returns {Array<Record<string, unknown>>}
 */
function sanitizeKvaArrangements(llmArrangements, kvaInput, blockIndexCompact, issues) {
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map();
  if (Array.isArray(llmArrangements)) {
    for (const a of llmArrangements) {
      if (!a || typeof a !== 'object') continue;
      const obj = /** @type {Record<string, unknown>} */ (a);
      const kid = typeof obj.kva_id === 'string' ? obj.kva_id : '';
      if (kid) byId.set(kid, obj);
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  for (const kva of kvaInput) {
    const kid = typeof kva.kva_id === 'string' ? kva.kva_id : '';
    const src = typeof kva.source_seg_id === 'string' ? kva.source_seg_id : '';
    const expectedBlockId = findBlockIdBySegId(blockIndexCompact, src);
    const llmItem = byId.get(kid) || {};

    const llmBlockId =
      typeof llmItem.suggested_block_id === 'string' ? llmItem.suggested_block_id : '';
    let finalBlockId = llmBlockId;
    if (llmBlockId && expectedBlockId && llmBlockId !== expectedBlockId) {
      issues.push(
        `kva ${kid}: llm suggested_block_id=${llmBlockId} does not cover source_seg=${src} (expected=${expectedBlockId}); fallback to expected`,
      );
      finalBlockId = expectedBlockId;
    } else if (!llmBlockId && expectedBlockId) {
      finalBlockId = expectedBlockId;
    }

    const llmRole =
      typeof llmItem.suggested_shot_role === 'string' ? llmItem.suggested_shot_role : '';
    const finalRole = VALID_SHOT_ROLES.has(llmRole) ? llmRole : '';

    const rationale =
      typeof llmItem.rationale === 'string' && llmItem.rationale.trim()
        ? llmItem.rationale.trim().slice(0, 120)
        : '';

    out.push({
      kva_id: kid,
      source_seg_id: src,
      priority: kva.priority,
      suggested_block_id: finalBlockId || null,
      suggested_shot_role: finalRole || null,
      rationale,
    });
  }
  return out;
}

/**
 * 校验 + 投影 Scene Architect LLM 输出；任何非法项都会被回退为 draft / null，
 * 并把原因塞进 issues。管线上层据此决定是否告警。
 *
 * @param {Record<string, unknown> | null} rawOut  LLM 原始解析结果（JSON 对象）
 * @param {Record<string, unknown>} payload        buildSceneArchitectPayload 的输出
 * @returns {{ sanitized: Record<string, unknown>; issues: string[] }}
 */
export function validateSceneArchitectOutput(rawOut, payload) {
  /** @type {string[]} */
  const issues = [];
  const draft = /** @type {Record<string, unknown> | null} */ (
    (payload.rhythm_timeline_draft && typeof payload.rhythm_timeline_draft === 'object'
      ? payload.rhythm_timeline_draft
      : null)
  );
  const blockIndexCompact = /** @type {Array<Record<string, unknown>>} */ (
    Array.isArray(payload.block_index_compact) ? payload.block_index_compact : []
  );
  const kvaInput = /** @type {Array<Record<string, unknown>>} */ (
    Array.isArray(payload.key_visual_actions) ? payload.key_visual_actions : []
  );

  if (!rawOut || typeof rawOut !== 'object') {
    issues.push('LLM output not a JSON object; skipping all adjustments');
    return {
      sanitized: {
        schema_version: 'scene_architect_v1',
        rhythm_timeline: draft || {},
        rhythm_adjustments: [],
        kva_arrangements: sanitizeKvaArrangements([], kvaInput, blockIndexCompact, issues),
        meta: { confidence: 'low', notes: 'llm_output_invalid' },
      },
      issues,
    };
  }

  const llmRhythm = /** @type {Record<string, unknown>} */ (
    rawOut.rhythm_timeline && typeof rawOut.rhythm_timeline === 'object'
      ? rawOut.rhythm_timeline
      : {}
  );
  const sanitizedRhythm = sanitizeRhythmTimeline(llmRhythm, draft, blockIndexCompact, issues);

  const llmAdjustments = Array.isArray(rawOut.rhythm_adjustments)
    ? rawOut.rhythm_adjustments
    : [];
  const sanitizedAdjustments = llmAdjustments.filter(
    (a) => a && typeof a === 'object' && typeof /** @type {Record<string, unknown>} */ (a).target === 'string',
  );

  const sanitizedKva = sanitizeKvaArrangements(
    Array.isArray(rawOut.kva_arrangements) ? rawOut.kva_arrangements : [],
    kvaInput,
    blockIndexCompact,
    issues,
  );

  const metaIn = /** @type {Record<string, unknown>} */ (
    rawOut.meta && typeof rawOut.meta === 'object' ? rawOut.meta : {}
  );

  return {
    sanitized: {
      schema_version: 'scene_architect_v1',
      rhythm_timeline: sanitizedRhythm,
      rhythm_adjustments: sanitizedAdjustments,
      kva_arrangements: sanitizedKva,
      meta: {
        confidence: typeof metaIn.confidence === 'string' ? metaIn.confidence : 'medium',
        notes: typeof metaIn.notes === 'string' ? metaIn.notes.slice(0, 300) : '',
      },
    },
    issues,
  };
}

/**
 * 回灌：把合规的 Scene Architect 输出叠加到 editMap。
 *   - meta.rhythm_timeline_original  ← 保留 draft（只在首次回灌时写）
 *   - meta.rhythm_timeline           ← 更新为 sanitized 版本
 *   - meta.rhythm_adjustments        ← 追加（不覆盖）
 *   - appendix.block_index[].kva_suggestions[] ← 按 suggested_block_id 分组落位
 *
 * 注意：不写 scene_architect_output.json 本体，由 runner 负责并列落盘。
 *
 * @param {Record<string, unknown>} editMap
 * @param {Record<string, unknown>} sanitized
 * @returns {Record<string, unknown>} 同一 editMap 引用（原地改写）
 */
export function applySceneArchitectToEditMap(editMap, sanitized) {
  if (!editMap.meta || typeof editMap.meta !== 'object') editMap.meta = {};
  const meta = /** @type {Record<string, unknown>} */ (editMap.meta);

  if (!meta.rhythm_timeline_original) {
    meta.rhythm_timeline_original = meta.rhythm_timeline || null;
  }
  meta.rhythm_timeline = sanitized.rhythm_timeline || meta.rhythm_timeline;

  const prevAdj = Array.isArray(meta.rhythm_adjustments) ? meta.rhythm_adjustments : [];
  const newAdj = Array.isArray(sanitized.rhythm_adjustments)
    ? sanitized.rhythm_adjustments
    : [];
  meta.rhythm_adjustments = prevAdj.concat(newAdj);

  const kvaArrForMeta = Array.isArray(sanitized.kva_arrangements)
    ? sanitized.kva_arrangements
    : [];
  meta.kva_consumption_plan = kvaArrForMeta
    .filter((a) => a && typeof a === 'object')
    .map((a) => {
      const obj = /** @type {Record<string, unknown>} */ (a);
      return {
        kva_id: typeof obj.kva_id === 'string' ? obj.kva_id : '',
        source_seg_id: typeof obj.source_seg_id === 'string' ? obj.source_seg_id : '',
        assigned_block_id:
          typeof obj.suggested_block_id === 'string' ? obj.suggested_block_id : null,
        suggested_shot_role:
          typeof obj.suggested_shot_role === 'string' ? obj.suggested_shot_role : null,
        routing_reason:
          typeof obj.routing_reason === 'string'
            ? obj.routing_reason
            : typeof obj.rationale === 'string'
              ? obj.rationale
              : '',
        authority: 'scene_architect_v1',
        status: 'assigned',
      };
    });

  if (!editMap.appendix || typeof editMap.appendix !== 'object') editMap.appendix = {};
  const appendix = /** @type {Record<string, unknown>} */ (editMap.appendix);
  const blockIndex = Array.isArray(appendix.block_index) ? appendix.block_index : [];
  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const byBlock = new Map();
  const kvaArr = Array.isArray(sanitized.kva_arrangements) ? sanitized.kva_arrangements : [];
  for (const a of kvaArr) {
    if (!a || typeof a !== 'object') continue;
    const obj = /** @type {Record<string, unknown>} */ (a);
    const bid = typeof obj.suggested_block_id === 'string' ? obj.suggested_block_id : '';
    if (!bid) continue;
    if (!byBlock.has(bid)) byBlock.set(bid, []);
    (byBlock.get(bid) || []).push(obj);
  }
  for (const blk of blockIndex) {
    if (!blk || typeof blk !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (blk);
    const bid = typeof b.block_id === 'string' ? b.block_id : '';
    b.kva_suggestions = byBlock.get(bid) || [];
  }

  return editMap;
}
