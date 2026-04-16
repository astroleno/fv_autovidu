#!/usr/bin/env node
/**
 * 将 SD2 产物导出为「分镜表」CSV（时间片级 + Block 级各一份）。
 *
 * 数据来源：
 * - sd2_prompts_all.json：time_slices（画面描述、运镜、对白、资产标签）
 * - edit_map_sd2.json（可选）：每 Block 的 location（场景 ID / 地点），剧本时间轴对齐
 *
 * 用法:
 *   node scripts/sd2_pipeline/export_sd2_storyboard_csv.mjs --sd2-dir output/sd2/leji-v1/full-run-brief-only-20260416-104216/
 *
 * 或显式指定文件:
 *   node scripts/sd2_pipeline/export_sd2_storyboard_csv.mjs \
 *     --prompts-all path/to/sd2_prompts_all.json \
 *     --edit-map path/to/edit_map_sd2.json \
 *     --output-dir path/to/（默认与 prompts-all 同目录）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * RFC 4180 风格：字段内双引号加倍，含逗号/换行/引号时整体加引号。
 * @param {string | number | null | undefined} cell
 * @returns {string}
 */
function csvCell(cell) {
  if (cell === null || cell === undefined) {
    return '';
  }
  const s = String(cell);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * @param {string[][]} rows
 * @returns {string}
 */
function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

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
 * @param {unknown} editMap
 * @returns {Map<string, Record<string, unknown>>}
 */
function indexEditMapBlocks(editMap) {
  const map = new Map();
  if (!editMap || typeof editMap !== 'object') {
    return map;
  }
  const root = /** @type {{ blocks?: unknown }} */ (editMap).blocks;
  if (!Array.isArray(root)) {
    return map;
  }
  for (const b of root) {
    if (!b || typeof b !== 'object') {
      continue;
    }
    const id = /** @type {{ id?: string }} */ (b).id;
    if (typeof id === 'string' && id) {
      map.set(id, /** @type {Record<string, unknown>} */ (b));
    }
  }
  return map;
}

/**
 * @param {unknown} promptsAll
 * @param {unknown} editMap
 * @returns {string[][]}
 */
function buildSliceRows(promptsAll, editMap) {
  const blockMeta = indexEditMapBlocks(editMap);
  /** @type {string[][]} */
  const header = [
    [
      '序号',
      'Block编号',
      '时间片ID',
      'Block内时间轴(秒)',
      '全局起始秒',
      '全局结束秒',
      '时间片时间码',
      '场景ID',
      '地点',
      '画面描述',
      '对白_VO',
      '运镜意图',
      '资产标签',
    ],
  ];

  /** @type {string[][]} */
  const body = [];
  let seq = 0;

  const blocks = /** @type {{ blocks?: unknown }} */ (promptsAll).blocks;
  if (!Array.isArray(blocks)) {
    return header;
  }

  for (const row of blocks) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const bid = /** @type {{ block_id?: string }} */ (row).block_id;
    const result = /** @type {{ result?: unknown }} */ (row).result;
    if (typeof bid !== 'string' || !result || typeof result !== 'object') {
      continue;
    }

    const em = blockMeta.get(bid);
    const loc = em && em.location && typeof em.location === 'object'
      ? /** @type {{ scene_id?: string, place?: string }} */ (em.location)
      : {};
    const sceneId = loc.scene_id ? String(loc.scene_id) : '';
    const place = loc.place ? String(loc.place) : '';

    const bt = /** @type {{ time?: { start_sec?: number, end_sec?: number } }} */ (result).time;
    const blockStart = bt && typeof bt.start_sec === 'number' ? bt.start_sec : 0;
    const blockEnd = bt && typeof bt.end_sec === 'number' ? bt.end_sec : blockStart;

    const slices = /** @type {{ time_slices?: unknown }} */ (result).time_slices;
    if (!Array.isArray(slices) || slices.length === 0) {
      /** v3 等无 time_slices：整 Block 一行，画面描述用 sd2_prompt 全文 */
      seq += 1;
      const fullPrompt = String(
        /** @type {{ sd2_prompt?: string }} */ (result).sd2_prompt || '',
      );
      body.push([
        String(seq),
        bid,
        'BLOCK',
        `${blockStart}-${blockEnd}`,
        String(blockStart),
        String(blockEnd),
        '',
        sceneId,
        place,
        fullPrompt,
        '',
        '',
        '',
      ]);
      continue;
    }

    for (const sl of slices) {
      if (!sl || typeof sl !== 'object') {
        continue;
      }
      seq += 1;
      const sliceId = String(/** @type {{ slice_id?: string }} */ (sl).slice_id || '');
      const tr = String(/** @type {{ time_range?: string }} */ (sl).time_range || '');
      const s0 = /** @type {{ start_sec?: number }} */ (sl).start_sec;
      const e0 = /** @type {{ end_sec?: number }} */ (sl).end_sec;
      const gs =
        typeof s0 === 'number' ? blockStart + s0 : blockStart;
      const ge =
        typeof e0 === 'number' ? blockStart + e0 : blockEnd;
      const desc = String(/** @type {{ description?: string }} */ (sl).description || '');
      const dlg = /** @type {{ associated_dialogue?: string | null }} */ (sl).associated_dialogue;
      const dlgStr = dlg === null || dlg === undefined ? '' : String(dlg);
      const cam = String(/** @type {{ camera_intent?: string }} */ (sl).camera_intent || '');
      const tags = /** @type {{ assets_used_tags?: unknown }} */ (sl).assets_used_tags;
      const tagStr = Array.isArray(tags)
        ? tags.map((t) => String(t)).join('；')
        : '';

      body.push([
        String(seq),
        bid,
        sliceId,
        `${blockStart}-${blockEnd}`,
        String(gs),
        String(ge),
        tr,
        sceneId,
        place,
        desc,
        dlgStr,
        cam,
        tagStr,
      ]);
    }
  }

  return header.concat(body);
}

/**
 * @param {unknown} promptsAll
 * @returns {string[][]}
 */
function buildBlockRows(promptsAll) {
  /** @type {string[][]} */
  const header = [
    [
      'Block编号',
      '起始秒',
      '结束秒',
      '时长秒',
      '成片Prompt全文',
    ],
  ];
  /** @type {string[][]} */
  const body = [];

  const blocks = /** @type {{ blocks?: unknown }} */ (promptsAll).blocks;
  if (!Array.isArray(blocks)) {
    return header;
  }

  for (const row of blocks) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const bid = /** @type {{ block_id?: string }} */ (row).block_id;
    const result = /** @type {{ result?: unknown }} */ (row).result;
    if (typeof bid !== 'string' || !result || typeof result !== 'object') {
      continue;
    }
    const bt = /** @type {{ time?: { start_sec?: number, end_sec?: number, duration?: number } }} */ (
      result
    ).time;
    const start = bt && typeof bt.start_sec === 'number' ? bt.start_sec : '';
    const end = bt && typeof bt.end_sec === 'number' ? bt.end_sec : '';
    const dur = bt && typeof bt.duration === 'number' ? bt.duration : '';
    const prompt = String(
      /** @type {{ sd2_prompt?: string }} */ (result).sd2_prompt || '',
    );
    body.push([bid, String(start), String(end), String(dur), prompt]);
  }

  return header.concat(body);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let promptsPath = typeof args['prompts-all'] === 'string' ? args['prompts-all'] : '';
  let editMapPath = typeof args['edit-map'] === 'string' ? args['edit-map'] : '';
  let outDir = typeof args['output-dir'] === 'string' ? args['output-dir'] : '';

  const sd2Dir = typeof args['sd2-dir'] === 'string' ? args['sd2-dir'] : '';
  if (sd2Dir) {
    const root = path.resolve(process.cwd(), sd2Dir);
    promptsPath = path.join(root, 'sd2_prompts_all.json');
    editMapPath = path.join(root, 'edit_map_sd2.json');
    if (!outDir) {
      outDir = root;
    }
  }

  if (!promptsPath || !fs.existsSync(promptsPath)) {
    console.error('请指定 --sd2-dir <跑批目录> 或 --prompts-all sd2_prompts_all.json');
    process.exit(2);
  }

  const promptsAbs = path.resolve(process.cwd(), promptsPath);
  if (!outDir) {
    outDir = path.dirname(promptsAbs);
  }
  const outRoot = path.resolve(process.cwd(), outDir);

  const promptsAll = JSON.parse(fs.readFileSync(promptsAbs, 'utf8'));

  let editMap = null;
  const emAbs = editMapPath ? path.resolve(process.cwd(), editMapPath) : '';
  if (emAbs && fs.existsSync(emAbs)) {
    editMap = JSON.parse(fs.readFileSync(emAbs, 'utf8'));
  }

  const sliceRows = buildSliceRows(promptsAll, editMap);
  const blockRows = buildBlockRows(promptsAll);

  const sliceFile = path.join(outRoot, 'storyboard_time_slices.csv');
  const blockFile = path.join(outRoot, 'storyboard_blocks.csv');

  fs.writeFileSync(sliceFile, toCsv(sliceRows), 'utf8');
  fs.writeFileSync(blockFile, toCsv(blockRows), 'utf8');

  console.log(`[export_sd2_storyboard_csv] 时间片表: ${sliceFile}（${sliceRows.length - 1} 行数据）`);
  console.log(`[export_sd2_storyboard_csv] Block表:   ${blockFile}（${blockRows.length - 1} 行数据）`);
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main();
}

export { buildSliceRows, buildBlockRows, csvCell, toCsv };
