/**
 * Local post-processing for SD2 v6 prompt text.
 *
 * These repairs enforce deterministic prompt contracts after the LLM returns:
 * - asset references must use @图N（资产名） instead of bare names;
 * - global suffix lines should avoid positive-prompting "文字/字幕/水印" tokens.
 */

/**
 * @typedef {{ tag?: unknown, asset_id?: unknown, assetId?: unknown, description?: unknown }} AssetMappingEntry
 */

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {number} sec
 * @returns {string}
 */
function formatTimecode(sec) {
  const n = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * @param {number} total
 * @param {number} count
 * @returns {number[]}
 */
function distributeDurations(total, count) {
  const n = Math.max(1, count);
  const t = Math.max(n, Math.round(total));
  const base = Math.floor(t / n);
  let rem = t % n;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(base + (rem > 0 ? 1 : 0));
    if (rem > 0) rem -= 1;
  }
  return out;
}

/**
 * @param {unknown} mapping
 * @returns {Array<{ tag: string, name: string, aliases: string[] }>}
 */
function normalizeAssetMapping(mapping) {
  if (!Array.isArray(mapping)) return [];
  /** @type {Array<{ tag: string, name: string, aliases: string[] }>} */
  const out = [];
  for (const row of mapping) {
    if (!row || typeof row !== 'object') continue;
    const rec = /** @type {AssetMappingEntry} */ (row);
    const tag = typeof rec.tag === 'string' ? rec.tag.trim() : '';
    const nameRaw =
      typeof rec.asset_id === 'string'
        ? rec.asset_id.trim()
        : typeof rec.assetId === 'string'
          ? rec.assetId.trim()
          : typeof rec.description === 'string'
            ? rec.description.trim()
            : '';
    if (!/^@图\d+$/.test(tag) || !nameRaw) continue;
    const aliasSet = new Set(
      [nameRaw, ...nameRaw.split(/[\/／]/g)]
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && !/^A_\d+$/i.test(s)),
    );
    out.push({ tag, name: nameRaw, aliases: [...aliasSet].sort((a, b) => b.length - a.length) });
  }
  out.sort((a, b) => {
    const na = Number((a.tag.match(/\d+/) || ['0'])[0]);
    const nb = Number((b.tag.match(/\d+/) || ['0'])[0]);
    return na - nb;
  });
  return out;
}

/**
 * @param {string} line
 * @param {string} alias
 * @param {string} label
 * @returns {string}
 */
function replaceBareAlias(line, alias, label) {
  if (!line.includes(alias) || line.includes(label)) return line;
  const protectedLine = line.replace(new RegExp(`${escapeRegExp(label)}`, 'g'), `\u0000${label}\u0000`);
  const locationLike = /(医院|走廊|病房|大楼|办公室|手术室|门口|门外|门内|楼道|诊室|病床|电梯)/.test(alias);
  const replaced = protectedLine.replace(new RegExp(escapeRegExp(alias), 'g'), (match, offset, full) => {
    const prev = offset > 0 ? full[offset - 1] : '';
    if (locationLike && /[\u4e00-\u9fff]/.test(prev)) {
      return `${match}（参考${label}）`;
    }
    return label;
  });
  return replaced.replace(new RegExp(`\u0000${escapeRegExp(label)}\u0000`, 'g'), label);
}

/**
 * Ensure bare asset names in FRAME/DIALOG lines are rewritten to @图N（资产名）.
 *
 * @param {string} sd2PromptOrig
 * @param {unknown} assetTagMapping
 * @param {{ injectDeclaration?: boolean }} [options]
 * @returns {{ sd2Prompt: string, inserted_tags: string[], declaration: string }}
 */
export function repairAssetTagReferences(sd2PromptOrig, assetTagMapping, options = {}) {
  const entries = normalizeAssetMapping(assetTagMapping);
  if (!sd2PromptOrig || entries.length === 0) {
    return { sd2Prompt: sd2PromptOrig, inserted_tags: [], declaration: '' };
  }
  /** @type {Set<string>} */
  const inserted = new Set();
  const lines = sd2PromptOrig.split('\n').map((line) => {
    if (!/^\[(FRAME|DIALOG)\]/.test(line)) return line;
    let next = line;
    for (const entry of entries) {
      const label = `${entry.tag}（${entry.name}）`;
      for (const alias of entry.aliases) {
        const before = next;
        next = replaceBareAlias(next, alias, label);
        if (next !== before) inserted.add(entry.tag);
      }
    }
    return next;
  });

  let sd2Prompt = lines.join('\n');
  const existingTags = new Set([...sd2Prompt.matchAll(/@图\d+/g)].map((m) => m[0]));
  for (const t of existingTags) inserted.add(t);

  const usedEntries = entries.filter((e) => inserted.has(e.tag));
  const declaration =
    usedEntries.length > 0
      ? `资产参考：${usedEntries.map((e) => `${e.tag}（${e.name}）`).join('，')}`
      : '';
  if (options.injectDeclaration !== false && declaration && !/^资产参考：/m.test(sd2Prompt)) {
      const firstBreak = sd2Prompt.indexOf('\n\n');
      if (firstBreak >= 0) {
        sd2Prompt = `${sd2Prompt.slice(0, firstBreak)}\n${declaration}${sd2Prompt.slice(firstBreak)}`;
      } else {
        sd2Prompt = `${declaration}\n${sd2Prompt}`;
      }
  }

  return { sd2Prompt, inserted_tags: [...inserted].sort((a, b) => a.localeCompare(b)), declaration };
}

/**
 * Remove global suffix clauses that put text/subtitle/watermark words into the
 * positive prompt. FRAME lines are left intact because they may describe props.
 *
 * @param {string} sd2PromptOrig
 * @returns {{ sd2Prompt: string, removed_lines: number }}
 */
export function sanitizeTextOverlayNegations(sd2PromptOrig) {
  let removedLines = 0;
  const lines = sd2PromptOrig.split('\n').map((line) => {
    if (/^\[(FRAME|DIALOG|SFX|BGM)\]/.test(line)) return line;
    if (!/(文字|字幕|水印|人名条|可读)/.test(line)) return line;
    const kept = line
      .split(/[，。；;]/)
      .map((s) => s.trim())
      .filter((s) => s && !/(文字|字幕|水印|人名条|可读)/.test(s))
      .join('，');
    if (kept !== line.trim()) removedLines += 1;
    return kept;
  });
  return { sd2Prompt: lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(), removed_lines: removedLines };
}

/**
 * Rewrite shot prompt timecodes from block time, preventing invalid values like 00:68.
 *
 * @param {unknown[]} shots
 * @param {{ start_sec?: number, end_sec?: number, duration?: number } | null} blockTime
 * @returns {{ changed: number, timecodes: string[] }}
 */
export function normalizeShotTimecodes(shots, blockTime) {
  if (!Array.isArray(shots) || shots.length === 0 || !blockTime) {
    return { changed: 0, timecodes: [] };
  }
  const start = Number(blockTime.start_sec);
  const endRaw = Number(blockTime.end_sec);
  const durRaw = Number(blockTime.duration);
  const duration = Number.isFinite(durRaw) && durRaw > 0
    ? durRaw
    : Number.isFinite(endRaw) && Number.isFinite(start) && endRaw > start
      ? endRaw - start
      : shots.length * 3;
  if (!Number.isFinite(start)) return { changed: 0, timecodes: [] };

  const durations = distributeDurations(duration, shots.length);
  let cursor = start;
  let changed = 0;
  /** @type {string[]} */
  const timecodes = [];
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i];
    const shotStart = cursor;
    const shotEnd = i === shots.length - 1 ? start + duration : cursor + durations[i];
    cursor = shotEnd;
    const tc = `[${formatTimecode(shotStart)}–${formatTimecode(shotEnd)}]`;
    timecodes.push(tc);
    if (!shot || typeof shot !== 'object') continue;
    const rec = /** @type {{ sd2_prompt?: unknown }} */ (shot);
    if (typeof rec.sd2_prompt !== 'string') continue;
    const next = rec.sd2_prompt.replace(/\[\d{1,2}:\d{2,3}\s*[-–—]\s*\d{1,2}:\d{2,3}\]/, tc);
    if (next !== rec.sd2_prompt) {
      rec.sd2_prompt = next;
      changed += 1;
    } else if (!/^\[FRAME\]\s*\[\d{2}:\d{2}/.test(rec.sd2_prompt)) {
      rec.sd2_prompt = rec.sd2_prompt.replace(/^(\[FRAME\]\s*)/, `$1${tc} `);
      changed += 1;
    }
  }
  return { changed, timecodes };
}

const CAMERA_POLISHES = [
  ['中景，平视，固定镜头——', '中近景，轻微手持，缓慢推近——'],
  ['近景，平视，固定镜头——', '压迫近景，缓慢推近后短暂停住——'],
  ['特写，平视，固定镜头——', '情绪特写，快速切入后短暂停住——'],
  ['中景，平视，固定——', '中近景，轻微手持，缓慢推近——'],
  ['近景，平视，固定——', '压迫近景，缓慢推近——'],
  ['特写，平视，固定——', '情绪特写，快速切入——'],
  ['中景，平拍，', '反打中近景，轻微推近，'],
  ['近景，平拍，', '压迫近景，轻微推近，'],
  ['特写，平拍，', '情绪特写，快速切入，'],
  ['中近景，平视，固定，', '中近景，轻微手持，缓慢推近，'],
];

/**
 * Reduce neutral camera-template language and bias prompts toward short-drama conflict rhythm.
 *
 * @param {string} sd2PromptOrig
 * @returns {{ sd2Prompt: string, replacements: number }}
 */
export function polishShortDramaRhythmLanguage(sd2PromptOrig) {
  if (!sd2PromptOrig) return { sd2Prompt: sd2PromptOrig, replacements: 0 };
  let sd2Prompt = sd2PromptOrig;
  let replacements = 0;
  for (const [from, to] of CAMERA_POLISHES) {
    const re = new RegExp(escapeRegExp(from), 'g');
    sd2Prompt = sd2Prompt.replace(re, () => {
      replacements += 1;
      return to;
    });
  }
  return { sd2Prompt, replacements };
}
