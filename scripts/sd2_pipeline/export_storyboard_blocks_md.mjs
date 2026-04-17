#!/usr/bin/env node
/**
 * 从 sd2_prompts_all.json（与 storyboard_blocks.csv 同源）生成分镜展示用 Markdown：
 * 每 Block：全局时间轴、时长、本块资产列表（块内 @图1…@图K 连续编号）、
 * 重编号后的 sd2_prompt（与资产表一致，避免块内出现 1、5、14 等跳号）。
 *
 * 用法:
 *   node scripts/sd2_pipeline/export_storyboard_blocks_md.mjs --sd2-dir output/sd2/leji-v1e/
 *   node scripts/sd2_pipeline/export_storyboard_blocks_md.mjs \
 *     --prompts-all output/sd2/leji-v1e/sd2_prompts_all.json \
 *     [--edit-map output/sd2/leji-v1e/edit_map_sd2.json] \
 *     [--output output/sd2/leji-v1e/分镜块_时长与资产与提示词.md]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * 按在正文中的首次出现顺序收集 @图N（去重），用于块内 1..K 连续编号。
 * @param {string} text
 * @returns {string[]}
 */
function orderGlobalTagsByFirstAppearance(text) {
  /** @type {string[]} */
  const order = [];
  const seen = new Set();
  const re = /@图\d+/g;
  let m = re.exec(text);
  while (m) {
    const tag = m[0];
    if (!seen.has(tag)) {
      seen.add(tag);
      order.push(tag);
    }
    m = re.exec(text);
  }
  return order;
}

/**
 * 全局 @图N → 本块 @图1…@图K
 * @param {string[]} orderedGlobalTags
 * @returns {Map<string, string>}
 */
function buildGlobalToLocalMap(orderedGlobalTags) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (let i = 0; i < orderedGlobalTags.length; i += 1) {
    map.set(orderedGlobalTags[i], `@图${i + 1}`);
  }
  return map;
}

/**
 * 将 prompt 中所有 @图\d+ 按映射替换为块内编号（整段匹配，避免误伤）。
 * @param {string} prompt
 * @param {Map<string, string>} globalToLocal
 */
function renumberPromptText(prompt, globalToLocal) {
  return prompt.replace(/@图\d+/g, (full) => {
    const local = globalToLocal.get(full);
    return local !== undefined ? local : full;
  });
}

/**
 * 从 edit_map_sd2.json 的 appendix.meta.asset_tag_mapping 构建 @图N → 元数据
 * @param {string} editMapPath
 * @returns {Map<string, { asset_type: string, asset_id: string, asset_description: string }>}
 */
function loadAssetTagMapping(editMapPath) {
  /** @type {Map<string, { asset_type: string, asset_id: string, asset_description: string }>} */
  const m = new Map();
  if (!fs.existsSync(editMapPath)) {
    return m;
  }
  try {
    const j = JSON.parse(fs.readFileSync(editMapPath, 'utf8'));
    const arr = j?.appendix?.meta?.asset_tag_mapping;
    if (!Array.isArray(arr)) {
      return m;
    }
    for (const e of arr) {
      if (e && typeof e.tag === 'string') {
        m.set(e.tag, {
          asset_type: String(e.asset_type ?? ''),
          asset_id: String(e.asset_id ?? ''),
          asset_description: String(e.asset_description ?? ''),
        });
      }
    }
  } catch {
    // 静默：无映射时资产表仍输出全局 tag 列
  }
  return m;
}

/**
 * 若映射中无条目，尝试取该 tag 在文中首次出现后的全角括号摘要（到第一个「）」）。
 * @param {string} prompt
 * @param {string} globalTag 如 @图5
 */
function extractParenHintAfterTag(prompt, globalTag) {
  const idx = prompt.indexOf(globalTag);
  if (idx < 0) {
    return '';
  }
  const after = prompt.slice(idx + globalTag.length);
  const open = after.indexOf('（');
  if (open !== 0) {
    return '';
  }
  const close = after.indexOf('）', 1);
  if (close < 0) {
    return '';
  }
  return after.slice(1, close);
}

/**
 * @param {string} bid
 * @param {string} promptRaw
 * @param {Map<string, { asset_type: string, asset_id: string, asset_description: string }>} assetByGlobalTag
 * @returns {{ orderedGlobal: string[], globalToLocal: Map<string, string>, promptLocal: string, assetTableMd: string }}
 */
function buildBlockAssetSection(bid, promptRaw, assetByGlobalTag) {
  const orderedGlobal = orderGlobalTagsByFirstAppearance(promptRaw);
  const globalToLocal = buildGlobalToLocalMap(orderedGlobal);
  const promptLocal = renumberPromptText(promptRaw, globalToLocal);

  if (orderedGlobal.length === 0) {
    return {
      orderedGlobal,
      globalToLocal,
      promptLocal,
      assetTableMd:
        '**本块资产列表**（块内连续编号）：本段未引用任何 `@图`。\n\n',
    };
  }

  let table = '**本块资产列表**（块内 `@图1`～`' + `@图${orderedGlobal.length}` + '`，与下方提示词一致）\n\n';
  table += '| 块内编号 | 全局编号 | 类型 | asset_id | 说明 |\n';
  table += '|----------|----------|------|----------|------|\n';

  for (let i = 0; i < orderedGlobal.length; i += 1) {
    const g = orderedGlobal[i];
    const local = `@图${i + 1}`;
    const meta = assetByGlobalTag.get(g);
    const type = meta?.asset_type ?? '—';
    const aid = meta?.asset_id ?? '—';
    let desc = meta?.asset_description ?? '';
    if (!desc) {
      desc = extractParenHintAfterTag(promptRaw, g) || '—';
    }
    const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    table += `| \`${local}\` | \`${g}\` | ${esc(type)} | ${esc(aid)} | ${esc(desc)} |\n`;
  }
  table += '\n';

  return { orderedGlobal, globalToLocal, promptLocal, assetTableMd: table };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let promptsPath = '';
  let outPath = '';
  let editMapPath = '';

  const sd2Dir =
    typeof args['sd2-dir'] === 'string' ? path.resolve(process.cwd(), args['sd2-dir']) : '';
  if (sd2Dir) {
    promptsPath = path.join(sd2Dir, 'sd2_prompts_all.json');
    outPath = path.join(sd2Dir, '分镜块_时长与资产与提示词.md');
    editMapPath = path.join(sd2Dir, 'edit_map_sd2.json');
  }
  if (typeof args['prompts-all'] === 'string') {
    promptsPath = path.resolve(process.cwd(), args['prompts-all']);
  }
  if (typeof args.output === 'string') {
    outPath = path.resolve(process.cwd(), args.output);
  }
  if (typeof args['edit-map'] === 'string') {
    editMapPath = path.resolve(process.cwd(), args['edit-map']);
  }
  if (!editMapPath && promptsPath) {
    editMapPath = path.join(path.dirname(promptsPath), 'edit_map_sd2.json');
  }

  if (!promptsPath || !fs.existsSync(promptsPath)) {
    console.error('请指定 --sd2-dir <目录> 或 --prompts-all sd2_prompts_all.json');
    process.exit(2);
  }
  if (!outPath) {
    outPath = path.join(path.dirname(promptsPath), '分镜块_时长与资产与提示词.md');
  }

  const assetByGlobalTag = loadAssetTagMapping(editMapPath);

  const raw = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
  const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];

  const relDir = path.relative(process.cwd(), path.dirname(promptsPath)) || '.';

  let md = '';
  md += '# 分镜块：时长 · 资产引用 · 成片提示词\n\n';
  md += `**跑批目录**：\`${relDir}/\`  \n`;
  md +=
    '**数据说明**：与 `storyboard_blocks.csv` 为同一批产物；由 `sd2_prompts_all.json` 生成。每个 Block 内 `@图` **按本段首次出现顺序**重编号为 `@图1`…`@图K`（连续、不跳号），与 **本块资产列表** 及下方 **成片提示词** 一致；全局编号见资产表第二列。\n\n';
  md += '---\n\n';

  for (const row of blocks) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const bid = String(/** @type {{ block_id?: string }} */ (row).block_id || '');
    const result = /** @type {{ time?: object, sd2_prompt?: string }} */ (row).result;
    if (!result || typeof result !== 'object') {
      continue;
    }
    const time = /** @type {{ start_sec?: number, end_sec?: number, duration?: number }} */ (
      result.time
    );
    const start = typeof time?.start_sec === 'number' ? time.start_sec : null;
    const end = typeof time?.end_sec === 'number' ? time.end_sec : null;
    const dur = typeof time?.duration === 'number' ? time.duration : null;
    const prompt = String(result.sd2_prompt ?? '');

    const { promptLocal, assetTableMd } = buildBlockAssetSection(bid, prompt, assetByGlobalTag);

    md += `## ${bid}\n\n`;
    md += '| 项目 | 内容 |\n';
    md += '|------|------|\n';
    md += `| 全局起始–结束 | ${start != null ? start : '—'}s – ${end != null ? end : '—'}s |\n`;
    md += `| **本段时长** | **${dur != null ? dur : '—'}s** |\n`;
    md += '\n';
    md += assetTableMd;
    md += '### 成片提示词（sd2_prompt，块内编号）\n\n';
    md += '```text\n';
    md += promptLocal;
    md += '\n```\n\n';
    md += '---\n\n';
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`[export_storyboard_blocks_md] 已写入: ${outPath}`);
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main();
}
