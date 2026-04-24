#!/usr/bin/env node
/**
 * 不调用 LLM，仅验证两种 EditMap 对外形态在本地能编译并过 normalize：
 *  1) 纯 Markdown（default）→ tryParseEditMapPureMd
 *  2) 简化键 JSON → expandAbbrevEditMapKeys + 与 1) 等价的结构
 *
 * 落盘（相对 fv_autovidu 仓库根）：
 *   output/sd2/_format_smoke/edit_map_from_pure_md.json
 *   output/sd2/_format_smoke/edit_map_from_abbrev_json.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expandAbbrevEditMapKeys } from './lib/editmap_v6_abbrev_json.mjs';
import { tryParseEditMapPureMd } from './lib/editmap_v6_pure_md.mjs';
import { normalizeEditMapSd2V5 } from './lib/normalize_edit_map_sd2_v5.mjs';
import { parseJsonFromModelText } from './lib/llm_client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'output', 'sd2', '_format_smoke');

const PURE_MD = `<sd2_editmap v6="pure_md" />

# 分镜叙事
### B01
烟测：纯 MD 正文。

# 分块机读
B01 | SEG_001 | SEG_001 | 12

# 风格与节奏
@rsv:真人电影
@tb:cold_high_contrast
@gbp:general
`;

/** 与 abbrev 表一致；顶层/块级用短码，style 内用长名避免歧义。 */
const ABBREV_JSON = `
{
  "mb": "### B01\\n烟测：缩写 JSON 正文。",
  "a": {
    "m": {
      "style_inference": {
        "rendering_style": { "value": "真人电影", "confidence": 0.8, "evidence": ["smoke"] },
        "tone_bias": { "value": "cold_high_contrast", "confidence": 0.7, "evidence": ["smoke"] },
        "genre_bias": { "value": "general", "primary": "general", "secondary": null, "confidence": 0.6, "evidence": ["smoke"] }
      },
      "rhythm_timeline": {
        "golden_open_3s": { "summary": "open" },
        "mini_climaxes": [ { "order": 1, "label": "m1", "at_sec_derived": 3 } ],
        "major_climax": { "strategy": null },
        "closing_hook": { "beat": "end" },
        "info_density_contract": { "max_none_ratio": 0.2, "floor_hard": 0.05, "ceiling_hard": 0.3 }
      }
    },
    "bi": [
      { "bid": "B01", "cs": [ "SEG_001" ], "ms": [ "SEG_001" ] }
    ],
    "d": { "smoke": true }
  }
}
`;

function run() {
  console.log('--- 1) 纯 MD → parse + normalize');
  const fromMd = tryParseEditMapPureMd(PURE_MD);
  if (!fromMd || typeof fromMd.markdown_body !== 'string') {
    throw new Error('纯 MD 解析失败');
  }
  normalizeEditMapSd2V5(fromMd);
  const v1 = /** @type {Record<string, unknown>} */ (fromMd).sd2_version;
  const blocks1 = /** @type {unknown[]} */ (
    /** @type {Record<string, unknown>} */ (fromMd).blocks
  );
  console.log('  ok sd2_version=', v1, 'blocks.len=', Array.isArray(blocks1) ? blocks1.length : 0);

  console.log('--- 2) 缩写键 JSON → expand + normalize');
  const parsed = /** @type {Record<string, unknown>} */ (parseJsonFromModelText(ABBREV_JSON));
  const expanded = /** @type {Record<string, unknown>} */ (expandAbbrevEditMapKeys(parsed));
  if (typeof expanded.markdown_body !== 'string' || !expanded.appendix) {
    throw new Error('缩写展开失败');
  }
  normalizeEditMapSd2V5(expanded);
  const v2 = /** @type {Record<string, unknown>} */ (expanded).sd2_version;
  const b0 =
    /** @type {Array<Record<string, unknown>>} */ (
      /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (expanded).appendix).block_index
    )[0];
  const bid = b0 && typeof b0.block_id === 'string' ? b0.block_id : '';
  console.log('  ok sd2_version=', v2, 'block[0].block_id=', bid);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const p1 = path.join(OUT_DIR, 'edit_map_from_pure_md.json');
  const p2 = path.join(OUT_DIR, 'edit_map_from_abbrev_json.json');
  fs.writeFileSync(p1, JSON.stringify(fromMd, null, 2), 'utf8');
  fs.writeFileSync(p2, JSON.stringify(expanded, null, 2), 'utf8');
  const readMe = path.join(OUT_DIR, 'README.txt');
  fs.writeFileSync(
    readMe,
    [
      '本目录由 scripts/sd2_pipeline/dev_editmap_format_smoke.mjs 生成。',
      '1) edit_map_from_pure_md.json  — 模拟「全篇纯 MD」解析 + normalize 后的落盘形状',
      '2) edit_map_from_abbrev_json.json — 模拟「缩写键 JSON」展开 + normalize 后的落盘形状',
      '注意：未调用 LLM，仅作管线烟测。',
      '',
    ].join('\n'),
    'utf8',
  );
  console.log('');
  console.log('已写入（可打开查看）：');
  console.log(' ', p1);
  console.log(' ', p2);
  console.log(' ', readMe);
  console.log('dev_editmap_format_smoke: 两条路径通过');
}

run();
