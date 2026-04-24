/**
 * EditMap v6 · **纯 Markdown** 输出解析：全文无 JSON 围栏；按固定一级标题分节；
 * 叙事、风格、细节用自然语言写在对应章节；**仅**「分块机读」节用极简行列（tab/|）给机读字段。
 *
 * 与 `call_editmap_sd2_v6.mjs` 契约：产 `{ markdown_body, appendix }`，下游仍走 `normalizeEditMapSd2V5`。
 * `appendix.meta.style_inference` / `rhythm_timeline` 若正文未用 @ 行给齐，将填**可过软门**的最小结构，
 * 完整论述保留在 `appendix.meta._pure_md_prose` 与 `diagnosis.editmap_output_mode`。
 *
 * 首行必须是（HTML 风格声明，无闭合也可）：
 *   `<sd2_editmap v6="pure_md" />`
 *
 * 一级标题（#）约定：
 *   - `# 分镜叙事`：正文，须含与现网一致的 `### B01` … 子标题供 block 切片；
 *   - `# 分块机读`：每行一条，无 JSON。列：`block_id | covered 列表 | must 列表 | max_sec(可选)`；
 *   - `# 风格与节奏`：自然语言 + 可选以 `@` 打头的机读行（见 parseStyleLines）。
 *
 * @module editmap_v6_pure_md
 */

/**
 * @param {string} s
 * @returns {string[]}
 */
function parseSegIdList(s) {
  if (!s || typeof s !== 'string') return [];
  return s
    .split(/[,，;；\s]+/u)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * 从「风格与节奏」节提取 @ 键，用于填充三轴/节奏短字段（有则覆盖默认桩）。
 * 行格式示例：`@rsv:真人电影` `@tb:cold_high_contrast` `@gbp:short_drama_contrast_hook`
 * `@g3:开场的钩子` `@ch:收束悬念`
 *
 * @param {string} section
 * @returns {{ rendering?: string, tone?: string, genreP?: string, g3?: string, ch?: string, prose: string }}
 */
function parseStyleLines(section) {
  const lines = String(section).split('\n');
  /** @type {Record<string, string>} */
  const at = {};
  const prose = [];
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(/^@([a-z0-9_]+)\s*:\s*(.+)$/i);
    if (m) {
      at[m[1].toLowerCase()] = m[2].trim();
    } else {
      prose.push(line);
    }
  }
  return {
    rendering: at.rsv,
    tone: at.tb,
    genreP: at.gbp,
    g3: at.g3,
    ch: at.ch,
    prose: prose.join('\n').trim(),
  };
}

/**
 * 解析一行分块机读。分隔符为 Tab 或 `|`；列 1=block_id，2=covered，3=must，4=可选 max 秒
 *
 * @param {string} line
 * @returns {Record<string, unknown> | null}
 */
function parseBlockLine(line) {
  const t = line.trim().replace(/^[-*+]\s+/, '');
  if (!t || t.startsWith('#')) return null;
  const parts = t.includes('\t')
    ? t.split('\t').map((x) => x.trim())
    : t.split('|').map((x) => x.trim());
  if (parts.length < 2) return null;
  const block_id = parts[0];
  if (typeof block_id !== 'string' || !/^B\d+$/i.test(block_id)) {
    return null;
  }
  const bid = String(block_id).replace(/^b/i, 'B');
  const covered_segment_ids = parseSegIdList(parts[1] || '');
  const must_raw = (parts[2] || '').replace(/^[-—–]+$/u, '');
  const must_cover_segment_ids = must_raw ? parseSegIdList(must_raw) : [];
  const maxSec = parts[3] ? parseFloat(parts[3]) : NaN;
  const end_sec = Number.isFinite(maxSec) ? maxSec : 0;
  return {
    block_id: bid,
    covered_segment_ids,
    must_cover_segment_ids,
    start_sec: 0,
    end_sec,
    duration: end_sec,
  };
}

/**
 * 最小可过 v6 软门形状检查的 style / rhythm 桩；正文保留在 @ 行与纯文本。
 *
 * @param {ReturnType<typeof parseStyleLines>} st
 * @returns {{ style_inference: Record<string, unknown>, rhythm_timeline: Record<string, unknown> }}
 */
function buildStyleRhythmStubs(st) {
  const rsv = st.rendering || '见 # 风格与节奏';
  const tbv = st.tone || 'neutral_daylight';
  const gbp = st.genreP || 'unknown';
  const g3b = st.g3 || '见 # 风格与节奏';
  const chb = st.ch || '见 # 风格与节奏';
  return {
    style_inference: {
      rendering_style: { value: rsv, confidence: 0.75, evidence: ['pure_md.v6'] },
      tone_bias: { value: tbv, confidence: 0.7, evidence: ['pure_md.v6'] },
      genre_bias: {
        value: gbp,
        primary: gbp,
        secondary: null,
        confidence: 0.65,
        evidence: ['pure_md.v6'],
      },
    },
    rhythm_timeline: {
      golden_open_3s: { summary: g3b },
      mini_climaxes: [{ order: 1, label: 'm1', at_sec_derived: 3 }],
      major_climax: { strategy: null, notice_msg: 'pure_md_stub' },
      closing_hook: { beat: chb },
      info_density_contract: { max_none_ratio: 0.2, floor_hard: 0.05, ceiling_hard: 0.3 },
    },
  };
}

/**
 * 按 `^# ` 分片；返回 title（无 #） -> 正文
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
function splitH1(text) {
  const chunks = String(text).split(/(?=^#[^#])/m);
  const map = new Map();
  for (const ch of chunks) {
    const m = ch.match(/^#\s+([^\n]+)\n?([\s\S]*)$/m);
    if (m) {
      map.set(m[1].trim(), m[2] || '');
    }
  }
  return map;
}

/**
 * 若首行声明为纯 MD EditMap，则解析并返回 { markdown_body, appendix }，否则 `null`。
 *
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
export function tryParseEditMapPureMd(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const lines = raw.split('\n');
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) || '';
  if (!/sd2_editmap/i.test(firstNonEmpty) || !/pure_md/i.test(firstNonEmpty)) {
    return null;
  }
  const sections = splitH1(raw);
  const bodyKey = ['分镜叙事', '分镜叙事正文', '1 分镜叙事'].find((k) => sections.has(k))
    || /** @type {string|undefined} */ ([...sections.keys()][0]);
  if (!bodyKey) return null;
  const markdown_body = (sections.get(bodyKey) || '').trim();
  if (!markdown_body) return null;

  const blockText =
    sections.get('分块机读') || sections.get('分块机读表') || sections.get('3 分块机读') || '';
  /** @type {Array<Record<string, unknown>>} */
  const block_index = [];
  for (const line of blockText.split('\n')) {
    const row = parseBlockLine(line);
    if (row) block_index.push(row);
  }
  if (block_index.length === 0) {
    return null;
  }

  const styleSection =
    sections.get('风格与节奏') || sections.get('2 风格与节奏') || '';
  const st = parseStyleLines(styleSection);
  const { style_inference, rhythm_timeline } = buildStyleRhythmStubs(st);

  /** @type {Record<string, unknown>} */
  const meta = {
    style_inference,
    rhythm_timeline,
    _pure_md_prose: st.prose,
    parsed_brief: {
      source: 'pure_md_v1',
      directorBrief: st.prose.slice(0, 4000),
    },
  };
  const appendix = {
    meta,
    block_index,
    diagnosis: {
      editmap_output_mode: 'pure_md_v1',
      segment_coverage_ratio_estimated: null,
    },
  };
  return { markdown_body, appendix };
}
