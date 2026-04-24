const ADAPTER_VERSION = 'editmap_v7_contract@0.1.0';
const DIALOGUE_SEGMENT_TYPES = new Set(['dialogue', 'monologue', 'vo']);

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function blockIdOf(row) {
  const r = asObject(row);
  if (!r) return '';
  return typeof r.block_id === 'string'
    ? r.block_id
    : typeof r.id === 'string'
      ? r.id
      : '';
}

function getAppendix(editMap) {
  const em = asObject(editMap) || {};
  const appendix = asObject(em.appendix);
  return appendix || null;
}

function getMeta(editMap) {
  const em = asObject(editMap) || {};
  const appendix = getAppendix(em);
  const appendixMeta = appendix ? asObject(appendix.meta) : null;
  const topMeta = asObject(em.meta);
  return appendixMeta || topMeta || {};
}

function setMeta(editMap, meta) {
  const em = asObject(editMap);
  if (!em) return;
  em.meta = meta;
  if (!em.appendix || typeof em.appendix !== 'object' || Array.isArray(em.appendix)) {
    em.appendix = {};
  }
  /** @type {Record<string, unknown>} */ (em.appendix).meta = meta;
}

function getBlockIndex(editMap) {
  const em = asObject(editMap) || {};
  const appendix = getAppendix(em);
  if (appendix && Array.isArray(appendix.block_index)) {
    return /** @type {Array<Record<string, unknown>>} */ (appendix.block_index);
  }
  if (Array.isArray(em.block_index)) {
    return /** @type {Array<Record<string, unknown>>} */ (em.block_index);
  }
  return [];
}

function buildBlockIdSet(blockIndex) {
  return new Set(blockIndex.map((row) => blockIdOf(row)).filter(Boolean));
}

function buildSegmentIndex(normalizedScriptPackage) {
  /** @type {Map<string, { beat_id: string, segment: Record<string, unknown> }>} */
  const idx = new Map();
  const pkg = asObject(normalizedScriptPackage);
  if (!pkg) return idx;
  for (const beatRaw of asArray(pkg.beat_ledger)) {
    const beat = asObject(beatRaw);
    if (!beat) continue;
    const beatId = typeof beat.beat_id === 'string' ? beat.beat_id : '';
    for (const segRaw of asArray(beat.segments)) {
      const seg = asObject(segRaw);
      if (!seg) continue;
      const segId = typeof seg.seg_id === 'string' ? seg.seg_id : '';
      if (segId) idx.set(segId, { beat_id: beatId, segment: seg });
    }
  }
  return idx;
}

function buildKvaFlat(normalizedScriptPackage) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const pkg = asObject(normalizedScriptPackage);
  if (!pkg) return out;
  for (const beatRaw of asArray(pkg.beat_ledger)) {
    const beat = asObject(beatRaw);
    if (!beat) continue;
    const beatId = typeof beat.beat_id === 'string' ? beat.beat_id : '';
    for (const kvaRaw of asArray(beat.key_visual_actions)) {
      const kva = asObject(kvaRaw);
      if (!kva) continue;
      out.push({ ...kva, beat_id: beatId });
    }
  }
  return out;
}

function findBlockIdBySegId(blockIndex, segId) {
  if (!segId) return '';
  for (const row of blockIndex) {
    const blockId = blockIdOf(row);
    const covered = asArray(row.covered_segment_ids);
    if (covered.includes(segId)) return blockId;
  }
  return '';
}

function getScriptChunkHint(row) {
  return asObject(row?.script_chunk_hint) || {};
}

function getRhythmTimeline(editMap) {
  const meta = getMeta(editMap);
  return asObject(meta.rhythm_timeline);
}

function anchorDeclaredBlock(anchor) {
  const a = asObject(anchor);
  if (!a) return '';
  if (typeof a.block_id === 'string') return a.block_id;
  if (typeof a.anchor_block_id === 'string') return a.anchor_block_id;
  if (typeof a.block === 'string') return a.block;
  const covered = asArray(a.covered_blocks);
  return typeof covered[0] === 'string' ? covered[0] : '';
}

function anchorTriggerSeg(anchor) {
  const a = asObject(anchor);
  if (!a) return '';
  return typeof a.trigger_source_seg_id === 'string'
    ? a.trigger_source_seg_id
    : typeof a.trigger === 'string'
      ? a.trigger
      : '';
}

function getRhythmAnchors(rhythmTimeline) {
  const rt = asObject(rhythmTimeline);
  if (!rt) return [];
  /** @type {Array<Record<string, unknown>>} */
  const anchors = [];
  const golden = asObject(rt.golden_open_3s);
  if (golden) {
    anchors.push({
      ...golden,
      anchor_id: typeof golden.anchor_id === 'string' ? golden.anchor_id : 'RT_OPEN_001',
      role: 'golden_open',
      required: golden.required !== false,
      declared_block_id: anchorDeclaredBlock(golden),
      trigger_source_seg_id: anchorTriggerSeg(golden),
    });
  }
  let seqFallback = 0;
  for (const mcRaw of asArray(rt.mini_climaxes)) {
    const mc = asObject(mcRaw);
    if (!mc) continue;
    seqFallback += 1;
    const seq = typeof mc.seq === 'number' ? mc.seq : seqFallback;
    anchors.push({
      ...mc,
      anchor_id:
        typeof mc.anchor_id === 'string'
          ? mc.anchor_id
          : `RT_MINI_${String(seq).padStart(3, '0')}`,
      role: 'mini_climax',
      seq,
      required: mc.required !== false,
      declared_block_id: anchorDeclaredBlock(mc),
      trigger_source_seg_id: anchorTriggerSeg(mc),
    });
  }
  const major = asObject(rt.major_climax);
  if (major) {
    anchors.push({
      ...major,
      anchor_id: typeof major.anchor_id === 'string' ? major.anchor_id : 'RT_MAJOR_001',
      role: 'major_climax',
      required: major.required !== false,
      declared_block_id: anchorDeclaredBlock(major),
      trigger_source_seg_id: anchorTriggerSeg(major),
    });
  }
  const closing = asObject(rt.closing_hook);
  if (closing) {
    anchors.push({
      ...closing,
      anchor_id: typeof closing.anchor_id === 'string' ? closing.anchor_id : 'RT_CLOSE_001',
      role: 'closing_hook',
      required: closing.required !== false,
      declared_block_id: anchorDeclaredBlock(closing),
      trigger_source_seg_id: anchorTriggerSeg(closing),
    });
  }
  return anchors;
}

/**
 * @param {unknown} styleInference
 * @returns {{
 *   style_inference: Record<string, unknown>,
 *   genre_bias: Record<string, unknown>,
 *   warnings: string[],
 *   errors: string[],
 *   compat_adapters: Array<Record<string, unknown>>,
 * }}
 */
export function normalizeGenreBiasV7(styleInference) {
  const warnings = [];
  const errors = [];
  const compat_adapters = [];
  const style = cloneJson(asObject(styleInference) || {});
  const raw = style.genre_bias;
  /** @type {Record<string, unknown>} */
  let genre = {};
  if (typeof raw === 'string') {
    genre.primary = raw;
    genre.secondary = [];
    genre.confidence = 'low';
    genre.evidence = [];
    warnings.push('style_inference.genre_bias string normalized to genre_bias.primary');
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = /** @type {Record<string, unknown>} */ (raw);
    const primary =
      typeof obj.primary === 'string'
        ? obj.primary
        : typeof obj.value === 'string'
          ? obj.value
          : '';
    if (typeof obj.value === 'string' && typeof obj.primary !== 'string') {
      warnings.push('style_inference.genre_bias.value used as legacy alias for primary');
      compat_adapters.push({
        name: 'genre_bias_value_alias',
        deprecated_after: '2026-05-15',
      });
    }
    genre = {
      ...obj,
      primary,
      secondary: Array.isArray(obj.secondary) ? obj.secondary : [],
      confidence: typeof obj.confidence === 'string' ? obj.confidence : 'low',
      evidence: Array.isArray(obj.evidence) ? obj.evidence : [],
    };
    delete genre.value;
  } else {
    genre = { primary: '', secondary: [], confidence: 'low', evidence: [] };
  }
  if (!genre.primary) {
    errors.push('style_inference.genre_bias.primary missing');
  }
  style.genre_bias = genre;
  return {
    style_inference: style,
    genre_bias: genre,
    warnings,
    errors,
    compat_adapters,
  };
}

/**
 * @param {unknown} rhythmTimeline
 * @param {unknown[]|Map<string, unknown>} [blockIndex]
 * @returns {{ rhythm_timeline: Record<string, unknown>, warnings: string[], errors: string[] }}
 */
export function normalizeRhythmTimelineV7(rhythmTimeline, blockIndex = []) {
  const warnings = [];
  const errors = [];
  const rt = cloneJson(asObject(rhythmTimeline) || {});
  const blockIds =
    blockIndex instanceof Map
      ? new Set(blockIndex.keys())
      : buildBlockIdSet(/** @type {Array<Record<string, unknown>>} */ (Array.isArray(blockIndex) ? blockIndex : []));

  const normalizeBlockAlias = (obj, fieldName) => {
    if (!obj || typeof obj !== 'object') return '';
    const o = /** @type {Record<string, unknown>} */ (obj);
    const legacy = typeof o.block === 'string' ? o.block : '';
    const existing = typeof o[fieldName] === 'string' ? String(o[fieldName]) : '';
    const blockId = existing || legacy;
    if (legacy && !existing) {
      o[fieldName] = legacy;
      delete o.block;
      warnings.push(`rhythm_timeline legacy block alias normalized to ${fieldName}`);
    }
    if (blockId && blockIds.size > 0 && !blockIds.has(blockId)) {
      errors.push(`rhythm_timeline.${String(o.anchor_id || fieldName)} declared block ${blockId} not found`);
    }
    return blockId;
  };

  const golden = asObject(rt.golden_open_3s);
  if (golden) {
    golden.role = 'golden_open';
    golden.anchor_id = typeof golden.anchor_id === 'string' ? golden.anchor_id : 'RT_OPEN_001';
    golden.required = golden.required !== false;
    const blockId = normalizeBlockAlias(golden, 'block_id');
    if (blockId && !Array.isArray(golden.covered_blocks)) golden.covered_blocks = [blockId];
  }

  rt.mini_climaxes = asArray(rt.mini_climaxes).map((mcRaw, idx) => {
    const mc = cloneJson(asObject(mcRaw) || {});
    const seq = typeof mc.seq === 'number' ? mc.seq : idx + 1;
    mc.role = 'mini_climax';
    mc.seq = seq;
    mc.anchor_id =
      typeof mc.anchor_id === 'string' ? mc.anchor_id : `RT_MINI_${String(seq).padStart(3, '0')}`;
    normalizeBlockAlias(mc, 'anchor_block_id');
    if (typeof mc.trigger === 'string' && typeof mc.trigger_source_seg_id !== 'string') {
      mc.trigger_source_seg_id = mc.trigger;
      delete mc.trigger;
      warnings.push('rhythm_timeline mini legacy trigger alias normalized to trigger_source_seg_id');
    }
    const slots = asObject(mc.slots);
    if (slots) {
      for (const stage of ['trigger', 'amplify', 'pivot', 'payoff', 'residue']) {
        const slot = asObject(slots[stage]);
        if (!slot) continue;
        const slotBlock = typeof slot.block_id === 'string' ? slot.block_id : '';
        const anchorBlock = typeof mc.anchor_block_id === 'string' ? mc.anchor_block_id : '';
        if (slotBlock && anchorBlock && slotBlock !== anchorBlock && typeof slot.slot_block_id_reason !== 'string') {
          errors.push(`${mc.anchor_id}.slots.${stage}.block_id differs from anchor_block_id without slot_block_id_reason`);
        }
      }
    }
    return mc;
  });

  const major = asObject(rt.major_climax);
  if (major) {
    major.role = 'major_climax';
    major.anchor_id = typeof major.anchor_id === 'string' ? major.anchor_id : 'RT_MAJOR_001';
    major.required = major.required !== false;
    normalizeBlockAlias(major, 'block_id');
  }

  const closing = asObject(rt.closing_hook);
  if (closing) {
    closing.role = 'closing_hook';
    closing.anchor_id = typeof closing.anchor_id === 'string' ? closing.anchor_id : 'RT_CLOSE_001';
    closing.required = closing.required !== false;
    normalizeBlockAlias(closing, 'block_id');
  }

  return { rhythm_timeline: rt, warnings, errors };
}

/**
 * @param {unknown} editMap
 * @param {unknown} normalizedScriptPackage
 */
export function buildSegmentOwnershipPlan(editMap, normalizedScriptPackage) {
  const blockIndex = getBlockIndex(editMap);
  const segmentIndex = buildSegmentIndex(normalizedScriptPackage);
  const errors = [];
  const warnings = [];
  /** @type {Map<string, string[]>} */
  const appearances = new Map();
  /** @type {Map<string, string[]>} */
  const mustOwners = new Map();

  for (const row of blockIndex) {
    const blockId = blockIdOf(row);
    if (!blockId) continue;
    for (const sidRaw of asArray(row.covered_segment_ids)) {
      if (typeof sidRaw !== 'string' || !sidRaw) continue;
      if (!appearances.has(sidRaw)) appearances.set(sidRaw, []);
      appearances.get(sidRaw)?.push(blockId);
    }
    for (const sidRaw of asArray(row.must_cover_segment_ids)) {
      if (typeof sidRaw !== 'string' || !sidRaw) continue;
      if (!mustOwners.has(sidRaw)) mustOwners.set(sidRaw, []);
      mustOwners.get(sidRaw)?.push(blockId);
    }
  }

  /** @type {Map<string, string>} */
  const ownerBySegId = new Map();
  for (const [sid, owners] of mustOwners.entries()) {
    const unique = [...new Set(owners)];
    if (unique.length > 1) {
      errors.push(`duplicate segment owner for ${sid}: ${unique.join(', ')}`);
    }
    if (unique[0]) ownerBySegId.set(sid, unique[0]);
  }
  for (const [sid, blocks] of appearances.entries()) {
    if (!ownerBySegId.has(sid)) {
      const first = blocks.find(Boolean);
      if (first) ownerBySegId.set(sid, first);
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const plan = [];
  for (const row of blockIndex) {
    const blockId = blockIdOf(row);
    if (!blockId) continue;
    const hint = getScriptChunkHint(row);
    const lead = typeof hint.lead_seg_id === 'string' ? hint.lead_seg_id : '';
    const tail = typeof hint.tail_seg_id === 'string' ? hint.tail_seg_id : '';
    const must = new Set(asArray(row.must_cover_segment_ids).filter((x) => typeof x === 'string'));
    for (const sidRaw of asArray(row.covered_segment_ids)) {
      if (typeof sidRaw !== 'string' || !sidRaw) continue;
      const owner = ownerBySegId.get(sidRaw) || blockId;
      const isOwner = owner === blockId;
      const hit = segmentIndex.get(sidRaw);
      if (!hit) warnings.push(`segment ${sidRaw} present in block ${blockId} but missing from normalized script`);
      const segmentType =
        hit && typeof hit.segment.segment_type === 'string'
          ? hit.segment.segment_type
          : 'unknown';
      let coverageRole = 'covered';
      if (must.has(sidRaw)) coverageRole = 'must';
      else if (sidRaw === lead) coverageRole = 'lead';
      else if (sidRaw === tail) coverageRole = 'tail';
      else if (!isOwner) coverageRole = 'context';
      const consumptionRole = isOwner ? 'owned' : 'context';
      plan.push({
        block_id: blockId,
        seg_id: sidRaw,
        beat_id: hit ? hit.beat_id || null : null,
        segment_type: segmentType,
        coverage_role: coverageRole,
        consumption_role: consumptionRole,
        owner_block_id: owner,
        context_for_block_id: isOwner ? null : owner,
        allow_dialogue_output: isOwner && DIALOGUE_SEGMENT_TYPES.has(segmentType),
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    plan,
    owner_by_seg_id: Object.fromEntries(ownerBySegId.entries()),
  };
}

/**
 * @param {unknown} editMap
 * @param {unknown} normalizedScriptPackage
 */
export function buildKvaConsumptionPlan(editMap, normalizedScriptPackage) {
  const blockIndex = getBlockIndex(editMap);
  const blockIds = buildBlockIdSet(blockIndex);
  const meta = getMeta(editMap);
  const errors = [];
  const warnings = [];
  const kvas = buildKvaFlat(normalizedScriptPackage);
  /** @type {Map<string, Record<string, unknown>>} */
  const assignmentByKvaId = new Map();

  for (const directRaw of asArray(meta.kva_consumption_plan)) {
    const direct = asObject(directRaw);
    if (!direct) continue;
    const kid = typeof direct.kva_id === 'string' ? direct.kva_id : '';
    if (kid) assignmentByKvaId.set(kid, direct);
  }

  const appendix = getAppendix(editMap);
  for (const rowRaw of asArray(appendix?.block_index)) {
    const row = asObject(rowRaw);
    if (!row) continue;
    const rowBlockId = blockIdOf(row);
    for (const sugRaw of asArray(row.kva_suggestions)) {
      const sug = asObject(sugRaw);
      if (!sug) continue;
      const kid = typeof sug.kva_id === 'string' ? sug.kva_id : '';
      if (!kid) continue;
      assignmentByKvaId.set(kid, {
        kva_id: kid,
        source_seg_id: sug.source_seg_id,
        assigned_block_id:
          typeof sug.suggested_block_id === 'string'
            ? sug.suggested_block_id
            : rowBlockId,
        suggested_shot_role: sug.suggested_shot_role,
        routing_reason: typeof sug.routing_reason === 'string'
          ? sug.routing_reason
          : typeof sug.rationale === 'string'
            ? sug.rationale
            : '',
        authority: 'scene_architect_v1',
        status: 'assigned',
      });
    }
  }

  /** @type {Array<Record<string, unknown>>} */
  const plan = [];
  for (const kva of kvas) {
    const kid = typeof kva.kva_id === 'string' ? kva.kva_id : '';
    const srcSeg = typeof kva.source_seg_id === 'string' ? kva.source_seg_id : '';
    const sourceBlock =
      typeof kva.source_block_id === 'string' && kva.source_block_id
        ? kva.source_block_id
        : findBlockIdBySegId(blockIndex, srcSeg);
    const assignment = kid ? assignmentByKvaId.get(kid) : null;
    const assignedBlock =
      assignment && typeof assignment.assigned_block_id === 'string'
        ? assignment.assigned_block_id
        : assignment && typeof assignment.suggested_block_id === 'string'
          ? assignment.suggested_block_id
          : sourceBlock;
    const routingReason =
      assignment && typeof assignment.routing_reason === 'string'
        ? assignment.routing_reason
        : assignment && typeof assignment.rationale === 'string'
          ? assignment.rationale
          : '';
    if (assignedBlock && !blockIds.has(assignedBlock)) {
      errors.push(`kva ${kid || '(missing id)'} assigned_block_id ${assignedBlock} not found`);
    }
    if (sourceBlock && assignedBlock && sourceBlock !== assignedBlock && !routingReason) {
      errors.push(`kva ${kid || '(missing id)'} routed ${sourceBlock}->${assignedBlock} without routing_reason`);
    }
    if (!srcSeg) {
      warnings.push(`kva ${kid || '(missing id)'} missing source_seg_id; payload builder will use legacy beat fallback`);
    }
    plan.push({
      kva_id: kid,
      source_seg_id: srcSeg,
      source_block_id: sourceBlock || null,
      assigned_block_id: assignedBlock || null,
      suggested_shot_role:
        assignment && typeof assignment.suggested_shot_role === 'string'
          ? assignment.suggested_shot_role
          : null,
      priority: typeof kva.priority === 'string' ? kva.priority : 'P2',
      routing_reason: routingReason,
      authority:
        assignment && typeof assignment.authority === 'string'
          ? assignment.authority
          : assignment
            ? 'scene_architect_v1'
            : 'fallback_source_block',
      status: assignedBlock ? 'assigned' : 'unassigned',
      source_kva: kva,
    });
  }

  return { ok: errors.length === 0, errors, warnings, plan };
}

/**
 * @param {unknown} editMap
 * @param {unknown} payloadsOrBlockIndex
 * @param {unknown} [normalizedScriptPackage]
 * @returns {Array<Record<string, unknown>>}
 */
export function resolveRhythmAnchorsForPayloads(editMap, payloadsOrBlockIndex, normalizedScriptPackage = null) {
  const rt = getRhythmTimeline(editMap);
  const anchors = getRhythmAnchors(rt);
  const segmentIndex = buildSegmentIndex(normalizedScriptPackage);
  /** @type {Set<string>} */
  const blockIds = new Set();
  /** @type {Map<string, string>} */
  const payloadRoleByBlock = new Map();

  const container = asObject(payloadsOrBlockIndex);
  if (container && Array.isArray(container.payloads)) {
    for (const itemRaw of container.payloads) {
      const item = asObject(itemRaw);
      if (!item) continue;
      const blockId = typeof item.block_id === 'string' ? item.block_id : '';
      if (blockId) blockIds.add(blockId);
      const payload = asObject(item.payload);
      const roleObj = payload ? asObject(payload.rhythmTimelineForBlock) : null;
      const role = roleObj && typeof roleObj.role === 'string' ? roleObj.role : '';
      if (blockId && role) payloadRoleByBlock.set(blockId, role);
    }
  } else {
    for (const row of Array.isArray(payloadsOrBlockIndex) ? payloadsOrBlockIndex : getBlockIndex(editMap)) {
      const blockId = blockIdOf(row);
      if (blockId) blockIds.add(blockId);
    }
  }

  return anchors.map((anchor) => {
    const anchorId = typeof anchor.anchor_id === 'string' ? anchor.anchor_id : '';
    const role = typeof anchor.role === 'string' ? anchor.role : '';
    const required = anchor.required !== false;
    const declaredBlock = typeof anchor.declared_block_id === 'string' ? anchor.declared_block_id : anchorDeclaredBlock(anchor);
    const triggerSeg = typeof anchor.trigger_source_seg_id === 'string' ? anchor.trigger_source_seg_id : anchorTriggerSeg(anchor);
    const errors = [];
    if (!declaredBlock) {
      errors.push('declared_block_id missing');
    } else if (blockIds.size > 0 && !blockIds.has(declaredBlock)) {
      errors.push(`declared_block_id ${declaredBlock} not found`);
    }
    if (triggerSeg && segmentIndex.size > 0 && !segmentIndex.has(triggerSeg)) {
      errors.push(`trigger_source_seg_id ${triggerSeg} not found`);
    }
    const payloadRole = payloadRoleByBlock.get(declaredBlock) || role || null;
    const resolvedPayloadBlock = errors.some((e) => e.includes('declared_block_id')) ? null : declaredBlock;
    if (required && !resolvedPayloadBlock) {
      errors.push('resolved_payload_block_id empty for required anchor');
    }
    if (required && payloadRole === 'filler') {
      errors.push('payload_role is filler for required anchor');
    }
    return {
      anchor_id: anchorId,
      role,
      declared_block_id: declaredBlock || null,
      resolved_block_id: declaredBlock || null,
      trigger_source_seg_id: triggerSeg || null,
      trigger_seg_exists: triggerSeg ? (segmentIndex.size > 0 ? segmentIndex.has(triggerSeg) : null) : null,
      resolved_payload_block_id: resolvedPayloadBlock,
      payload_role: payloadRole,
      resolution_status: errors.length === 0 ? 'resolved' : 'unresolved',
      errors,
    };
  });
}

function validateEvidenceConfidence(editMap) {
  const errors = [];
  const meta = getMeta(editMap);
  const style = asObject(meta.style_inference);
  const genre = style ? asObject(style.genre_bias) : null;
  const candidates = [];
  if (genre) candidates.push({ label: 'style_inference.genre_bias', obj: genre });
  for (const anchor of getRhythmAnchors(asObject(meta.rhythm_timeline))) {
    candidates.push({ label: `rhythm_timeline.${anchor.anchor_id || anchor.role}`, obj: anchor });
  }
  for (const { label, obj } of candidates) {
    const confidence = typeof obj.confidence === 'string' ? obj.confidence : '';
    const evidence = asArray(obj.evidence);
    if (confidence === 'high' && evidence.length < 2) {
      errors.push(`${label} confidence=high requires at least 2 evidence items`);
    }
    if (confidence === 'mid' && evidence.length < 1) {
      errors.push(`${label} confidence=mid requires direct evidence`);
    }
  }
  return errors;
}

/**
 * @param {unknown} editMap
 * @param {unknown} normalizedScriptPackage
 * @param {{ strict?: boolean }} [opts]
 */
export function validateEditMapV7Canonical(editMap, normalizedScriptPackage, opts = {}) {
  const strict = opts.strict === true;
  const normalized = cloneJson(editMap);
  const errors = [];
  const warnings = [];
  if (!normalized || typeof normalized !== 'object') {
    return {
      ok: false,
      errors: ['editMap is not an object'],
      warnings,
      normalized,
      report: { ok: false, errors: ['editMap is not an object'], warnings },
    };
  }

  const meta = cloneJson(getMeta(normalized));
  const blockIndex = getBlockIndex(normalized);
  const genreResult = normalizeGenreBiasV7(meta.style_inference);
  meta.style_inference = genreResult.style_inference;
  warnings.push(...genreResult.warnings);
  errors.push(...genreResult.errors);
  if (genreResult.compat_adapters.length > 0) {
    const prev = asArray(meta.compat_adapters);
    meta.compat_adapters = prev.concat(genreResult.compat_adapters);
  }

  if (meta.rhythm_timeline && typeof meta.rhythm_timeline === 'object') {
    const rhythmResult = normalizeRhythmTimelineV7(meta.rhythm_timeline, blockIndex);
    meta.rhythm_timeline = rhythmResult.rhythm_timeline;
    warnings.push(...rhythmResult.warnings);
    errors.push(...rhythmResult.errors);
  }
  setMeta(normalized, meta);

  const segmentOwnership = buildSegmentOwnershipPlan(normalized, normalizedScriptPackage);
  const kvaPlan = buildKvaConsumptionPlan(normalized, normalizedScriptPackage);
  const rhythmAnchorResolution = resolveRhythmAnchorsForPayloads(
    normalized,
    blockIndex,
    normalizedScriptPackage,
  );
  meta.segment_ownership_plan = segmentOwnership.plan;
  meta.kva_consumption_plan = kvaPlan.plan.map(({ source_kva, ...rest }) => rest);
  meta.rhythm_anchor_resolution = rhythmAnchorResolution;
  setMeta(normalized, meta);

  warnings.push(...segmentOwnership.warnings, ...kvaPlan.warnings);
  errors.push(...segmentOwnership.errors, ...kvaPlan.errors, ...validateEvidenceConfidence(normalized));
  for (const resolution of rhythmAnchorResolution) {
    if (resolution.resolution_status !== 'resolved') {
      const required = true;
      if (strict && required) {
        errors.push(
          `rhythm anchor ${resolution.anchor_id || '(missing id)'} unresolved: ${asArray(resolution.errors).join('; ')}`,
        );
      } else {
        warnings.push(
          `rhythm anchor ${resolution.anchor_id || '(missing id)'} unresolved: ${asArray(resolution.errors).join('; ')}`,
        );
      }
    }
  }

  const topMeta = asObject(/** @type {Record<string, unknown>} */ (normalized)._meta);
  if (!topMeta || typeof topMeta.schema_version !== 'string') {
    warnings.push('_meta.schema_version missing');
  }

  const report = {
    ok: errors.length === 0,
    strict,
    adapter_version: ADAPTER_VERSION,
    errors,
    warnings,
    rhythm_anchor_resolution: rhythmAnchorResolution,
    segment_ownership_plan: segmentOwnership.plan,
    kva_consumption_plan: kvaPlan.plan.map(({ source_kva, ...rest }) => rest),
  };
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalized,
    report,
  };
}

/**
 * @param {unknown} payload
 * @param {Record<string, unknown>} metaPatch
 */
export function attachContractMeta(payload, metaPatch) {
  const out = cloneJson(payload) || {};
  if (!out._meta || typeof out._meta !== 'object' || Array.isArray(out._meta)) {
    out._meta = {};
  }
  const meta = /** @type {Record<string, unknown>} */ (out._meta);
  Object.assign(meta, metaPatch, {
    adapter_version: metaPatch.adapter_version || ADAPTER_VERSION,
    created_at: metaPatch.created_at || new Date().toISOString(),
  });
  return out;
}

/**
 * @param {unknown} segment
 * @returns {number}
 */
export function recomputeDialogueCharCountForSegment(segment) {
  const seg = asObject(segment);
  if (!seg) return 0;
  const type = typeof seg.segment_type === 'string' ? seg.segment_type : '';
  if (!DIALOGUE_SEGMENT_TYPES.has(type)) return 0;
  const source =
    typeof seg.spoken_text === 'string'
      ? seg.spoken_text
      : typeof seg.text === 'string'
        ? seg.text
        : '';
  const stripped = source.replace(/[\p{P}\p{S}\s]/gu, '');
  return Array.from(stripped).length;
}

/**
 * Mutates normalized_script_package in place so downstream hard gates consume
 * deterministic dialogue counts rather than LLM self-reported numbers.
 *
 * @param {unknown} normalizedScriptPackage
 * @returns {{ corrected_segments: Array<Record<string, unknown>>, beat_count: number }}
 */
export function recomputeDialogueCharCountsInNormalizedPackage(normalizedScriptPackage) {
  const pkg = asObject(normalizedScriptPackage);
  const corrected_segments = [];
  let beatCount = 0;
  if (!pkg) return { corrected_segments, beat_count: 0 };
  for (const beatRaw of asArray(pkg.beat_ledger)) {
    const beat = asObject(beatRaw);
    if (!beat) continue;
    beatCount += 1;
    let beatDialogueChars = 0;
    for (const segRaw of asArray(beat.segments)) {
      const seg = asObject(segRaw);
      if (!seg) continue;
      const old =
        typeof seg.dialogue_char_count === 'number' ? seg.dialogue_char_count : null;
      const next = recomputeDialogueCharCountForSegment(seg);
      if (old !== null && old !== next) {
        if (!seg.debug || typeof seg.debug !== 'object' || Array.isArray(seg.debug)) {
          seg.debug = {};
        }
        const debug = /** @type {Record<string, unknown>} */ (seg.debug);
        debug.llm_dialogue_char_count = old;
        debug.dialogue_char_count_corrected = true;
        corrected_segments.push({
          seg_id: typeof seg.seg_id === 'string' ? seg.seg_id : '',
          llm_dialogue_char_count: old,
          dialogue_char_count: next,
        });
      }
      seg.dialogue_char_count = next;
      beatDialogueChars += next;
    }
    beat.beat_dialogue_char_count = beatDialogueChars;
  }
  return { corrected_segments, beat_count: beatCount };
}

export const EDIT_MAP_V7_CONTRACT_ADAPTER_VERSION = ADAPTER_VERSION;
