/**
 * EditMap v6 · 缩写键名 JSON 展开为 canonical 长键名，供与现有 normalize / 硬门复用同一条管线。
 *
 * 动机：全量英文长键在百万 token 级批量实验里浪费；模型仍输出 JSON 形状，但键用短码，
 * 本模块在**归一化前**做深度递归展开，不改变值语义。
 *
 * 说明：
 *   - 未出现在映射表中的键**原样保留**（可混用缩写与长名，方便渐进迁移）；
 *   - 子树递归；数组逐项展开。
 *
 * @module editmap_v6_abbrev_json
 */
/**
 * 缩写 → canonical（仅 v6/appendix 常用路径；子对象内同一缩写优先对应同一 canonical）。
 * 为减少歧义，单字母键仅覆盖极高频字段，其余用 2–3 字母码。
 */
const ABBREV_TO_CANON = Object.freeze({
  // 顶层
  mb: 'markdown_body',
  a: 'appendix',
  // appendix 一级
  m: 'meta',
  bi: 'block_index',
  d: 'diagnosis',
  // block 行
  bid: 'block_id',
  cs: 'covered_segment_ids',
  ms: 'must_cover_segment_ids',
  sch: 'script_chunk_hint',
  rt: 'rhythm_timeline',
  si: 'style_inference',
  pb: 'parsed_brief',
  // style_inference 三轴
  rsv: 'rendering_style',
  tob: 'tone_bias',
  gnb: 'genre_bias',
  // 节奏
  g3: 'golden_open_3s',
  mc: 'mini_climaxes',
  mj: 'major_climax',
  ch: 'closing_hook',
  idc: 'info_density_contract',
  // 叶常用
  v: 'value',
  c: 'confidence',
  e: 'evidence',
  pri: 'primary',
  sec: 'secondary',
  // rhythm 子
  o: 'order',
  lbl: 'label',
  asd: 'at_sec_derived',
  mm: 'major_climax',
  // 其它附录里偶发短键
  wrn: 'warning_msg',
  fmsg: 'notice_msg',
});

/**
 * 深度展开对象键名（只替换命中缩写的 key）。
 *
 * @param {unknown} node
 * @returns {unknown}
 */
export function expandAbbrevEditMapKeys(node) {
  if (node === null || node === undefined) {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((x) => expandAbbrevEditMapKeys(x));
  }
  if (typeof node !== 'object') {
    return node;
  }
  const src = /** @type {Record<string, unknown>} */ (node);
  const out = /** @type {Record<string, unknown>} */ ({});
  for (const [k, v] of Object.entries(src)) {
    const canon = Object.prototype.hasOwnProperty.call(ABBREV_TO_CANON, k)
      ? /** @type {string} */ (/** @type {Record<string, string>} */ (ABBREV_TO_CANON)[k])
      : k;
    out[canon] = expandAbbrevEditMapKeys(v);
  }
  return out;
}
