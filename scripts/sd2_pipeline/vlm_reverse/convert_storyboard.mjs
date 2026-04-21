#!/usr/bin/env node
/**
 * 一次性工具：把客户分镜 xlsx 转换成 storyboard.json
 * （因为 VLM 每次调用时自动加载 json 比现场解析 xlsx 稳定得多）。
 *
 * 默认输入：  output/sd2/甲方脚本/边缘-第一集.xlsx
 * 默认输出：  output/sd2/甲方脚本/storyboard.json
 *
 * 依赖：Python3 + openpyxl（已验证本机满足）
 *
 * 用法：
 *   node scripts/sd2_pipeline/vlm_reverse/convert_storyboard.mjs
 *   node scripts/sd2_pipeline/vlm_reverse/convert_storyboard.mjs --in path.xlsx --out path.json
 *
 * 产物 storyboard.json 结构：
 *   {
 *     "source": "<xlsx 相对路径>",
 *     "title":  "第一集 分镜脚本",
 *     "generated_at": "<ISO 时间戳>",
 *     "total_shots": N,
 *     "total_duration_s": S,
 *     "scene_groups": [
 *       { "key": "1-1", "scene": "医院（走廊）", "time": "日/内", "characters": "...",
 *         "shot_no_range": [start, end] }, ...
 *     ],
 *     "shots": [
 *       { "shot_no": 1,
 *         "scene_group_key": "1-1",
 *         "景别": "定场镜头", "机位": "俯视", "运镜": "无人机拍摄",
 *         "场景": "医院", "画面描述": "...", "台词": "无",
 *         "建议时长_s": 2.5, "cum_start_s": 0, "cum_end_s": 2.5 },
 *       ...
 *     ]
 *   }
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

function parseArgs() {
  const args = process.argv.slice(2);
  /** @type {{ in?: string; out?: string }} */
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--in') out.in = args[++i];
    else if (a === '--out') out.out = args[++i];
  }
  return out;
}

/**
 * 用 Python + openpyxl 把 xlsx 读成一个二维 string 数组（纯文本，方便下游解析）。
 *
 * @param {string} xlsxAbs
 * @returns {{ rows: Array<Array<string | null>>; title: string }}
 */
function readXlsxAsRows(xlsxAbs) {
  const pyScript = `
import json, sys
import openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = wb.worksheets[0]
rows = []
for row in ws.iter_rows(values_only=True):
    rows.append([
        (str(v).strip() if v is not None else None) for v in row
    ])
print(json.dumps({"rows": rows, "title": ws.title}, ensure_ascii=False))
`;
  const res = spawnSync('python3', ['-c', pyScript, xlsxAbs], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`python3 读取 xlsx 失败: ${res.stderr || res.stdout}`);
  }
  /** @type {{ rows: Array<Array<string | null>>; title: string }} */
  const parsed = JSON.parse(res.stdout);
  return parsed;
}

/**
 * 把 "2.5秒" / "1秒" / "0.8" 等形式解析为 number（秒）。
 *
 * @param {string | null | undefined} raw
 * @returns {number}
 */
function parseDurationS(raw) {
  if (!raw) return 0;
  const m = String(raw).match(/([\d.]+)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 判断一行是否为"场景分组"行：
 *   - 第一列非空且形如 "1-1\n\n场景：..."
 *   - 其余列全部为 null/空
 *
 * @param {Array<string | null>} row
 * @returns {boolean}
 */
function isSceneGroupRow(row) {
  if (!row || row.length === 0) return false;
  const first = (row[0] || '').toString();
  if (!/^\d+-\d+/.test(first)) return false;
  for (let i = 1; i < row.length; i++) {
    if (row[i] && String(row[i]).trim() !== '') return false;
  }
  return true;
}

/**
 * 解析场景分组行为结构化字段。
 *
 * @param {string} text
 * @returns {{ key: string; scene: string; time: string; characters: string; raw: string }}
 */
function parseSceneGroup(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const key = (lines[0] || '').trim();
  /** @type {string[]} */
  const rest = lines.slice(1);
  let scene = '';
  let time = '';
  let characters = '';
  for (const l of rest) {
    if (l.startsWith('场景')) {
      const body = l.replace(/^场景[:：]\s*/, '');
      const parts = body.split(/\s+/).filter(Boolean);
      scene = parts.slice(0, Math.max(1, parts.length - 1)).join(' ');
      time = parts[parts.length - 1] || '';
    } else if (l.startsWith('人物')) {
      characters = l.replace(/^人物[:：]\s*/, '');
    }
  }
  return { key, scene, time, characters, raw: text };
}

function main() {
  const { in: inArg, out: outArg } = parseArgs();
  const xlsxAbs = path.resolve(
    REPO_ROOT,
    inArg || 'output/sd2/甲方脚本/边缘-第一集.xlsx',
  );
  const jsonAbs = path.resolve(
    REPO_ROOT,
    outArg || 'output/sd2/甲方脚本/storyboard.json',
  );

  if (!fs.existsSync(xlsxAbs)) {
    console.error(`[convert_storyboard] 找不到 xlsx: ${xlsxAbs}`);
    process.exit(1);
  }

  const { rows } = readXlsxAsRows(xlsxAbs);
  if (!rows.length) {
    console.error('[convert_storyboard] xlsx 为空');
    process.exit(1);
  }

  const title = (rows[0][0] || '').toString().trim();
  const header = rows[2] || [];
  const expectedHeader = ['镜号', '景别', '机位', '运镜', '场景', '画面描述', '台词', '建议时长'];
  for (let i = 0; i < expectedHeader.length; i++) {
    if ((header[i] || '').toString().trim() !== expectedHeader[i]) {
      console.warn(
        `[convert_storyboard] 警告：表头第 ${i + 1} 列为 "${header[i]}", 期望 "${expectedHeader[i]}"`,
      );
    }
  }

  /** @type {Array<{ key: string; scene: string; time: string; characters: string; shot_no_range: [number, number] }>} */
  const sceneGroups = [];
  /** @type {Array<{ shot_no: number; scene_group_key: string; 景别: string; 机位: string; 运镜: string; 场景: string; 画面描述: string; 台词: string; 建议时长_s: number; cum_start_s: number; cum_end_s: number }>} */
  const shots = [];
  let currentGroupKey = '';
  let cumulative = 0;

  for (let i = 1; i < rows.length; i++) {
    if (i === 2) continue;
    const row = rows[i];
    if (!row || row.every((c) => !c || String(c).trim() === '')) continue;
    if (isSceneGroupRow(row)) {
      const g = parseSceneGroup(String(row[0]));
      sceneGroups.push({
        key: g.key,
        scene: g.scene,
        time: g.time,
        characters: g.characters,
        shot_no_range: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      });
      currentGroupKey = g.key;
      continue;
    }
    const shotNoStr = (row[0] || '').toString();
    const shotNo = Number(shotNoStr);
    if (!Number.isFinite(shotNo)) {
      console.warn(`[convert_storyboard] 跳过非数字镜号行（row ${i + 1}）: ${shotNoStr}`);
      continue;
    }
    const durS = parseDurationS(row[7]);
    const shot = {
      shot_no: shotNo,
      scene_group_key: currentGroupKey,
      景别: (row[1] || '').toString().trim(),
      机位: (row[2] || '').toString().trim(),
      运镜: (row[3] || '').toString().trim(),
      场景: (row[4] || '').toString().trim(),
      画面描述: (row[5] || '').toString().trim(),
      台词: (row[6] || '').toString().trim(),
      建议时长_s: durS,
      cum_start_s: cumulative,
      cum_end_s: cumulative + durS,
    };
    shots.push(shot);
    cumulative += durS;

    const g = sceneGroups[sceneGroups.length - 1];
    if (g) {
      if (shotNo < g.shot_no_range[0]) g.shot_no_range[0] = shotNo;
      if (shotNo > g.shot_no_range[1]) g.shot_no_range[1] = shotNo;
    }
  }

  for (const g of sceneGroups) {
    if (!Number.isFinite(g.shot_no_range[0])) g.shot_no_range = [0, 0];
  }

  const out = {
    source: path.relative(REPO_ROOT, xlsxAbs),
    title,
    generated_at: new Date().toISOString(),
    total_shots: shots.length,
    total_duration_s: Number(cumulative.toFixed(3)),
    scene_groups: sceneGroups,
    shots,
  };

  fs.mkdirSync(path.dirname(jsonAbs), { recursive: true });
  fs.writeFileSync(jsonAbs, JSON.stringify(out, null, 2), 'utf8');
  console.log(
    `[convert_storyboard] OK → ${path.relative(REPO_ROOT, jsonAbs)}  (${shots.length} 镜, 共 ${cumulative.toFixed(
      2,
    )} 秒, ${sceneGroups.length} 场景组)`,
  );
}

main();
