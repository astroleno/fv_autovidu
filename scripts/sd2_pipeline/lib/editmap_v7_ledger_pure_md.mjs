/**
 * Deterministic compiler for EditMap v7 ledger-first pure Markdown.
 *
 * The v7 L1 output is already a structured ledger. This compiler turns the
 * ledger into the canonical `{ markdown_body, appendix }` shape without asking
 * another LLM to re-emit JSON.
 */

function splitH1(text) {
  const chunks = String(text || '').split(/(?=^#[^#])/m);
  const map = new Map();
  for (const chunk of chunks) {
    const m = chunk.match(/^#\s+([^\n]+)\n?([\s\S]*)$/m);
    if (m) map.set(m[1].trim(), m[2] || '');
  }
  return map;
}

function parseKeyValueLines(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function parseList(value) {
  return String(value || '')
    .split(/[,，;；\s]+/u)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x !== '-' && x !== '—' && x !== 'null');
}

function parseNumber(value) {
  const n = Number.parseFloat(String(value || '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseTimeRange(value) {
  const m = String(value || '').match(/(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return { start_sec: null, end_sec: null };
  return {
    start_sec: Number.parseFloat(m[1]),
    end_sec: Number.parseFloat(m[2]),
  };
}

function parseBlockLedger(section) {
  /** @type {Array<Record<string, unknown>>} */
  const blocks = [];
  const chunks = String(section || '').split(/(?=^##\s+B\d+)/m);
  for (const chunk of chunks) {
    const header = chunk.match(/^##\s+(B\d+)\s*$/m);
    if (!header) continue;
    const blockId = header[1];
    const fields = parseKeyValueLines(chunk);
    const range = parseTimeRange(fields.time || '');
    const dur = parseNumber(fields.dur);
    const start = range.start_sec ?? 0;
    const end = range.end_sec ?? (dur !== null ? start + dur : start);
    const covered = parseList(fields.covered);
    const must = parseList(fields.must);
    const lead = parseList(fields.lead)[0] || covered[0] || '';
    const tail = parseList(fields.tail)[0] || covered[covered.length - 1] || lead;
    blocks.push({
      block_id: blockId,
      start_sec: start,
      end_sec: end,
      duration: dur ?? Math.max(0, end - start),
      stage: fields.stage || null,
      scene_run_id: fields.scene_run || null,
      beat_ids: parseList(fields.beats),
      covered_segment_ids: covered,
      must_cover_segment_ids: must,
      script_chunk_hint: {
        lead_seg_id: lead || null,
        tail_seg_id: tail || null,
      },
      overflow_policy: fields.overflow || null,
      present_asset_ids: parseList(fields.present_assets),
      summary: fields.summary || '',
    });
  }
  return blocks;
}

function dedupeMustCoverOwners(blocks) {
  const seen = new Set();
  for (const block of blocks) {
    const must = Array.isArray(block.must_cover_segment_ids)
      ? block.must_cover_segment_ids
      : [];
    const next = [];
    for (const sid of must) {
      if (typeof sid !== 'string' || !sid) continue;
      if (seen.has(sid)) continue;
      seen.add(sid);
      next.push(sid);
    }
    block.must_cover_segment_ids = next;
  }
}

function parsePipeFields(line) {
  /** @type {Record<string, string>} */
  const out = {};
  const first = String(line || '').split(':').slice(1).join(':');
  for (const part of first.split('|')) {
    const m = part.trim().match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function buildRhythmTimeline(section) {
  const lines = String(section || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  /** @type {Record<string, unknown>} */
  const rt = {
    mini_climaxes: [],
    info_density_contract: { max_none_ratio: 0.2, floor_hard: 0.05, ceiling_hard: 0.3 },
  };
  for (const line of lines) {
    const key = (line.split(':')[0] || '').trim();
    const fields = parsePipeFields(line);
    const block = fields.block || '';
    const atSec = parseNumber(fields.at_sec);
    const trigger = fields.trigger || '';
    if (key === 'open') {
      rt.golden_open_3s = {
        anchor_id: 'RT_OPEN_001',
        role: 'golden_open',
        block_id: block,
        covered_blocks: block ? [block] : [],
        required: true,
        type: fields.type || null,
        at_sec: atSec,
        confidence: 'low',
        evidence: [],
      };
    } else if (/^mini_\d+$/.test(key)) {
      const seq = Number.parseInt(key.replace(/^mini_/, ''), 10);
      /** @type {Array<Record<string, unknown>>} */ (rt.mini_climaxes).push({
        anchor_id: `RT_MINI_${String(seq).padStart(3, '0')}`,
        role: 'mini_climax',
        seq,
        anchor_block_id: block,
        motif: fields.motif || null,
        at_sec: atSec,
        trigger_source_seg_id: trigger || null,
        required: true,
        confidence: 'low',
        evidence: [],
      });
    } else if (key === 'major') {
      rt.major_climax = {
        anchor_id: 'RT_MAJOR_001',
        role: 'major_climax',
        block_id: block,
        strategy: fields.strategy === 'null' ? null : fields.strategy || null,
        at_sec: atSec,
        trigger_source_seg_id: trigger || null,
        required: true,
        confidence: 'low',
        evidence: [],
      };
    } else if (key === 'closing') {
      rt.closing_hook = {
        anchor_id: 'RT_CLOSE_001',
        role: 'closing_hook',
        block_id: block,
        type: fields.type || null,
        at_sec: atSec,
        cliff: fields.cliff === 'true',
        required: true,
        confidence: 'low',
        evidence: [],
      };
    }
  }
  return rt;
}

/**
 * @param {string} raw
 * @param {{ sourcePath?: string }} [opts]
 * @returns {Record<string, unknown> | null}
 */
export function compileEditMapV7LedgerPureMd(raw, opts = {}) {
  const text = String(raw || '').trim();
  if (!/<editmap\s+v7="ledger_pure_md"\s*\/>/i.test(text)) return null;
  const sections = splitH1(text);
  const global = parseKeyValueLines(sections.get('Global Ledger') || '');
  const blockIndex = parseBlockLedger(sections.get('Block Ledger') || '');
  if (blockIndex.length === 0) return null;
  dedupeMustCoverOwners(blockIndex);

  const rhythmTimeline = buildRhythmTimeline(sections.get('Rhythm Ledger') || '');
  const secondary = parseList(global.genre_bias_secondary || '');
  const meta = {
    title: global.title || null,
    episode_duration_sec: parseNumber(global.episode_duration_sec),
    genre: global.genre || null,
    aspect_ratio: global.aspect_ratio || null,
    style_inference: {
      rendering_style: {
        value: global.rendering_style || '真人电影',
        confidence: 'low',
        evidence: [],
      },
      tone_bias: {
        value: global.tone_bias || 'neutral',
        confidence: 'low',
        evidence: [],
      },
      genre_bias: {
        primary: global.genre_bias_primary || global.genre || '',
        secondary,
        confidence: 'low',
        evidence: [],
      },
    },
    rhythm_timeline: rhythmTimeline,
    parsed_brief: {
      source: 'v7_ledger_pure_md_compiler',
      directorBrief: (sections.get('Narrative Notes') || '').trim().slice(0, 4000),
    },
    source_dialogue_char_count: parseNumber(global.source_dialogue_char_count),
    target_block_count: parseNumber(global.target_block_count),
  };

  return {
    _meta: {
      schema_version: 'editmap_v7_canonical',
      translator_mode: 'deterministic_v7_ledger_compiler',
      source_pure_md_path: opts.sourcePath || null,
    },
    markdown_body: text,
    appendix: {
      meta,
      block_index: blockIndex,
      diagnosis: {
        editmap_output_mode: 'ledger_pure_md_v7',
        translator_mode: 'deterministic_v7_ledger_compiler',
        source_pure_md_path: opts.sourcePath || null,
      },
    },
  };
}
