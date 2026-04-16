#!/usr/bin/env node
/**
 * 从「一行一名称」的资产列表 .md 生成最小 episode.json，供 prepare_editmap_input 使用。
 *
 * 用法:
 *   node scripts/sd2_pipeline/emit_episode_from_asset_list.mjs \
 *     --asset-list output/sd2/leji-v1/assest_list.md \
 *     --episode-id leji-v1 \
 *     --output output/sd2/leji-v1/episode.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { parseAssetListMarkdown } from './lib/asset_list_md.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  const out = /** @type {Record<string, string | boolean>} */ ({});
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const listPath = typeof args['asset-list'] === 'string' ? args['asset-list'] : '';
  const outPath = typeof args.output === 'string' ? args.output : '';
  const episodeId =
    typeof args['episode-id'] === 'string' ? args['episode-id'] : 'local-episode';

  if (!listPath || !outPath) {
    console.error(
      '用法: --asset-list <assest_list.md> --output <episode.json> [--episode-id leji-v1]',
    );
    process.exit(2);
  }

  const resolved = path.resolve(process.cwd(), listPath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const rows = parseAssetListMarkdown(raw);

  const episode = {
    episodeId,
    assets: rows,
    scenes: [
      {
        title: 'placeholder',
        shots: [{ duration: 120, visualDescription: '（时长占位；剧本见 --script-file）', dialogue: '' }],
      },
    ],
  };

  const outp = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(outp), { recursive: true });
  fs.writeFileSync(outp, JSON.stringify(episode, null, 2) + '\n', 'utf8');
  console.log(`[emit_episode_from_asset_list] 已写入 ${outp}（${rows.length} 条资产）`);
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main();
}
