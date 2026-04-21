/**
 * 读取 `public/assets/生死边缘/assets_list.json`，生成 VLM 白名单与后续 @图N 映射用的名称列表。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {{ assetName: string; assetDescription?: string }} AssetEntry
 * @typedef {{ characters: AssetEntry[]; props: AssetEntry[]; scenes: AssetEntry[] }} AssetManifest
 */

/**
 * 默认资产清单路径（相对仓库根目录）。
 */
export const DEFAULT_ASSETS_REL = 'public/assets/生死边缘/assets_list.json';

/**
 * @param {string} repoRoot 仓库根目录绝对路径
 * @returns {{ manifest: AssetManifest; referenceAssets: { assetName: string; assetType: string }[] }}
 */
export function loadAssetRegistry(repoRoot) {
  const p = path.join(repoRoot, DEFAULT_ASSETS_REL);
  if (!fs.existsSync(p)) {
    throw new Error(`资产清单不存在: ${p}`);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const manifest = raw.assetManifest;
  const referenceAssets = Array.isArray(raw.referenceAssets) ? raw.referenceAssets : [];
  return { manifest, referenceAssets };
}

/**
 * 拼成一段供 Gemini system/user 注入的纯文本（中文名称枚举）。
 *
 * @param {AssetManifest} manifest
 * @returns {string}
 */
export function formatAssetsForPrompt(manifest) {
  const ch = (manifest.characters || []).map((c) => c.assetName).join('、');
  const pr = (manifest.props || []).map((c) => c.assetName).join('、');
  const sc = (manifest.scenes || []).map((c) => c.assetName).join('、');
  return [
    '【本剧可用资产名称（仅允许从这些名称里选，不要臆造新角色名）】',
    `人物：${ch || '（无）'}`,
    `道具：${pr || '（无）'}`,
    `场景：${sc || '（无）'}`,
  ].join('\n');
}

/**
 * 解析仓库根：本文件位于 scripts/sd2_pipeline/vlm_reverse/lib/
 *
 * @returns {string}
 */
export function resolveRepoRootFromHere() {
  return path.resolve(__dirname, '..', '..', '..', '..');
}
