/**
 * 审片包 CSV / 资产清单 小工具（供 prepare 与 apply 共用，避免重复实现）。
 */

import fs from 'fs';

/**
 * @param {string} field
 */
export function csvEscape(field) {
  if (field.includes('"') || field.includes(',') || field.includes('\n') || field.includes('\r')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * @param {Record<string, string>[]} rows
 * @param {string[]} headers
 */
export function rowsToCsv(rows, headers) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {string} assetsPath
 * @returns {unknown}
 */
export function readJsonFile(assetsPath) {
  const t = fs.readFileSync(assetsPath, 'utf8');
  return JSON.parse(t);
}

/**
 * @typedef {{ assetName: string, assetDescription?: string }} AssetItem
 * @typedef {{ characters: AssetItem[], props: AssetItem[], scenes: AssetItem[], vfx: AssetItem[] }} AssetManifest
 */

/**
 * @param {unknown} data
 * @returns {AssetManifest}
 */
export function parseAssetManifest(data) {
  if (!data || typeof data !== 'object') {
    return { characters: [], props: [], scenes: [], vfx: [] };
  }
  const am = 'assetManifest' in data ? data.assetManifest : null;
  if (!am || typeof am !== 'object') {
    return { characters: [], props: [], scenes: [], vfx: [] };
  }
  const o = am;
  return {
    characters: Array.isArray(o.characters) ? o.characters : [],
    props: Array.isArray(o.props) ? o.props : [],
    scenes: Array.isArray(o.scenes) ? o.scenes : [],
    vfx: Array.isArray(o.vfx) ? o.vfx : [],
  };
}
