#!/usr/bin/env node
/**
 * 将本地 episode.json（及可选剧本 .md）组装为 EditMap-SD2 所需输入 JSON。
 *
 * 用法:
 *   node scripts/sd2_pipeline/prepare_editmap_input.mjs \
 *     --episode data/.../episode.json \
 *     --script-file public/script/test/e1.md \
 *     --output output/sd2/{episodeId}/edit_map_input.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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

/**
 * 将 Feeling 资产 type 映射到 EditMap manifest 分组。
 * @param {string} assetType
 * @param {string} name
 * @returns {'characters'|'props'|'scenes'|'vfx'}
 */
function manifestBucket(assetType, name) {
  const t = (assetType || '').toLowerCase();
  if (t === 'character') {
    return 'characters';
  }
  if (t === 'location') {
    return 'scenes';
  }
  if (t === 'prop') {
    return 'props';
  }
  if (t === 'other') {
    const n = name || '';
    if (/走廊|办公室|医院|场景|内景|外景|房间|大厅/i.test(n)) {
      return 'scenes';
    }
    return 'props';
  }
  return 'props';
}

/**
 * @param {unknown} episode
 * @returns {number}
 */
function sumShotDurations(episode) {
  if (!episode || typeof episode !== 'object') {
    return 60;
  }
  const scenes = /** @type {{ scenes?: unknown[] }} */ (episode).scenes;
  if (!Array.isArray(scenes)) {
    return 60;
  }
  let total = 0;
  for (const sc of scenes) {
    if (!sc || typeof sc !== 'object') {
      continue;
    }
    const shots = /** @type {{ shots?: unknown[] }} */ (sc).shots;
    if (!Array.isArray(shots)) {
      continue;
    }
    for (const sh of shots) {
      if (!sh || typeof sh !== 'object') {
        continue;
      }
      const d = /** @type {{ duration?: number }} */ (sh).duration;
      total += typeof d === 'number' && d > 0 ? d : 5;
    }
  }
  return total > 0 ? total : 60;
}

/**
 * 从 directorBrief 自然语言抽取「单集时长 / 目标镜头数」数值。
 * 优先级在 buildEditMapInput 内与 CLI 配合：显式 --duration/--shot-hint 始终覆盖此处结果。
 * 与 EditMap 提示词中「parsed_brief」互补：prepare 侧先把可确定数字写入 JSON，便于离线核对。
 *
 * @param {string} text
 * @returns {{ episodeDuration?: number, shotCountApprox?: number }}
 */
function parseBriefStructuredHints(text) {
  const out = /** @type {{ episodeDuration?: number, shotCountApprox?: number }} */ ({});
  if (!text || typeof text !== 'string') {
    return out;
  }
  const dur = text.match(/单集总时长\s*(\d+)\s*秒/);
  if (dur && dur[1]) {
    const n = parseInt(dur[1], 10);
    if (Number.isFinite(n) && n > 0) {
      out.episodeDuration = n;
    }
  }
  const shot =
    text.match(/目标(?:剪辑)?镜头数约\s*(\d+)/) ||
    text.match(/目标镜头数约\s*(\d+)/) ||
    text.match(/镜头数约\s*(\d+)/);
  if (shot && shot[1]) {
    const n = parseInt(shot[1], 10);
    if (Number.isFinite(n) && n > 0) {
      out.shotCountApprox = n;
    }
  }
  return out;
}

/**
 * 无 --script-file 时，从分镜拼接类剧本文本。
 * @param {unknown} episode
 * @returns {string}
 */
function buildScriptFromShots(episode) {
  if (!episode || typeof episode !== 'object') {
    return '';
  }
  const lines = [];
  const scenes = /** @type {{ scenes?: unknown[] }} */ (episode).scenes;
  if (!Array.isArray(scenes)) {
    return '';
  }
  for (const sc of scenes) {
    if (!sc || typeof sc !== 'object') {
      continue;
    }
    const title = /** @type {{ title?: string }} */ (sc).title || '场景';
    lines.push(`【${title}】`);
    const shots = /** @type {{ shots?: unknown[] }} */ (sc).shots;
    if (!Array.isArray(shots)) {
      continue;
    }
    for (const sh of shots) {
      if (!sh || typeof sh !== 'object') {
        continue;
      }
      const vd = String(
        /** @type {{ visualDescription?: string }} */ (sh).visualDescription || '',
      ).trim();
      const dlg = String(/** @type {{ dialogue?: string }} */ (sh).dialogue || '').trim();
      if (vd) {
        lines.push(vd);
      }
      if (dlg) {
        lines.push(dlg);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** motionBias 中文→英文映射，接受中英文输入 */
const MOTION_BIAS_MAP = /** @type {Record<string, string>} */ ({
  '激进': 'aggressive',
  '平衡': 'balanced',
  '沉稳': 'steady',
  'aggressive': 'aggressive',
  'balanced': 'balanced',
  'steady': 'steady',
});

/** motionBias → SD2Director speed_bias 映射 */
const MOTION_TO_SPEED = /** @type {Record<string, string>} */ ({
  'aggressive': 'fast',
  'balanced': 'neutral',
  'steady': 'slow',
});

/**
 * 规范化 motionBias 输入（中/英文均可），返回英文标准值。
 * @param {string | undefined} raw
 * @returns {string}
 */
function normalizeMotionBias(raw) {
  if (!raw) return 'balanced';
  const trimmed = raw.trim();
  return MOTION_BIAS_MAP[trimmed] || 'balanced';
}

/**
 * 由单集时长与「目标镜头数」生成 workflowControls（供 EditMap-SD2 读取；Block 数仍受 Prompt 内规则约束）。
 * @param {number} durationSec
 * @param {number} shotCountApprox
 * @param {string} [motionBias] 英文标准值
 * @returns {Record<string, unknown>}
 */
function buildDefaultWorkflowControls(durationSec, shotCountApprox, motionBias) {
  const targetBlockDurationSec = 15;
  const rawCount = Math.round(durationSec / targetBlockDurationSec);
  const targetBlockCount = Math.max(4, Math.min(12, rawCount || 8));
  const avgShotDuration = shotCountApprox > 0
    ? Math.round((durationSec / shotCountApprox) * 10) / 10
    : null;
  const biasLabel = motionBias || 'balanced';
  const speedBias = MOTION_TO_SPEED[biasLabel] || 'neutral';
  return {
    targetBlockDurationSec,
    targetBlockCount,
    blockDurationRange: { min_sec: 13, max_sec: 17 },
    shotCountTargetApprox: shotCountApprox,
    avgShotDuration,
    motionBias: biasLabel,
    speedBias,
    editorialDensityNote:
      `单集总时长 ${durationSec} 秒；目标镜头数约 ${shotCountApprox}（avg_shot_duration ≈ ${avgShotDuration}s）；运镜偏好 ${biasLabel}（speed_bias=${speedBias}）。`,
  };
}

/**
 * @param {unknown} episode episode.json 解析结果
 * @param {{ globalSynopsis?: string, scriptContent?: string, episodeDuration?: number, shotCountApprox?: number, motionBias?: string, genre?: string, renderingStyle?: string, artStyle?: string, workflowControls?: object, targetBlockCount?: number, directorBrief?: string }} options
 * @returns {{ globalSynopsis: string, scriptContent: string, assetManifest: object, episodeDuration: number, referenceAssets: Array<{ assetName: string, assetType: string }>, workflowControls?: object, directorBrief?: string }}
 */
function buildEditMapInput(episode, options) {
  let globalSynopsis = options.globalSynopsis || '';
  let scriptContent = options.scriptContent || '';
  if (!scriptContent) {
    scriptContent = buildScriptFromShots(episode);
  }

  const briefRaw = typeof options.directorBrief === 'string' ? options.directorBrief.trim() : '';
  const fromBrief = briefRaw ? parseBriefStructuredHints(briefRaw) : {};

  /** 显式 CLI > directorBrief 解析 > episode 分镜累加 */
  const explicitDuration =
    typeof options.episodeDuration === 'number' && options.episodeDuration > 0
      ? options.episodeDuration
      : undefined;
  /** @type {number | undefined} */
  const explicitShot =
    typeof options.shotCountApprox === 'number' && options.shotCountApprox > 0
      ? options.shotCountApprox
      : undefined;

  const episodeDuration =
    explicitDuration !== undefined
      ? explicitDuration
      : typeof fromBrief.episodeDuration === 'number' && fromBrief.episodeDuration > 0
        ? fromBrief.episodeDuration
        : sumShotDurations(episode);

  /** @type {number | undefined} */
  const shotHint =
    explicitShot !== undefined
      ? explicitShot
      : typeof fromBrief.shotCountApprox === 'number' && fromBrief.shotCountApprox > 0
        ? fromBrief.shotCountApprox
        : undefined;
  if (shotHint !== undefined) {
    const prefix = `【编排附加条件】单集总时长 ${episodeDuration} 秒；目标剪辑镜头数约 ${shotHint}（传统分镜/剪辑密度参考，Block 划分仍须满足 EditMap-SD2 时长守恒与 Schema）。\n\n`;
    globalSynopsis = prefix + globalSynopsis;
  }

  const assets = /** @type {{ assets?: unknown[] }} */ (episode).assets;
  const manifest = {
    characters: /** @type {Array<{ assetName: string, assetDescription: string }>} */ ([]),
    props: /** @type {Array<{ assetName: string, assetDescription: string }>} */ ([]),
    scenes: /** @type {Array<{ assetName: string, assetDescription: string }>} */ ([]),
    vfx: /** @type {Array<{ assetName: string, assetDescription: string }>} */ ([]),
  };

  if (Array.isArray(assets)) {
    for (const a of assets) {
      if (!a || typeof a !== 'object') {
        continue;
      }
      const name = String(/** @type {{ name?: string }} */ (a).name || '').trim();
      const prompt = String(/** @type {{ prompt?: string }} */ (a).prompt || '').trim();
      const type = String(/** @type {{ type?: string }} */ (a).type || 'other');
      const item = { assetName: name, assetDescription: prompt || name };
      const bucket = manifestBucket(type, name);
      manifest[bucket].push(item);
    }
  }

  /** @type {Array<{ assetName: string, assetType: string }>} */
  const referenceAssets = [];
  const order = /** @type {const} */ (['characters', 'props', 'scenes', 'vfx']);
  for (const k of order) {
    for (const row of manifest[k]) {
      referenceAssets.push({
        assetName: row.assetName,
        assetType: k === 'characters' ? 'character' : k === 'scenes' ? 'scene' : k === 'props' ? 'prop' : 'vfx',
      });
    }
  }

  const motionBias = normalizeMotionBias(options.motionBias);

  const out = {
    globalSynopsis,
    scriptContent,
    assetManifest: manifest,
    episodeDuration,
    referenceAssets,
  };

  if (shotHint !== undefined) {
    out.episodeShotCount = shotHint;
  }
  out.motionBias = motionBias;

  if (briefRaw) {
    out.directorBrief = briefRaw;
  }

  const GENRE_ENUM = /** @type {const} */ (['sweet_romance', 'revenge', 'suspense', 'fantasy', 'general']);
  if (options.genre && GENRE_ENUM.includes(/** @type {typeof GENRE_ENUM[number]} */ (options.genre))) {
    out.genre = options.genre;
  }

  const rs = typeof options.renderingStyle === 'string' ? options.renderingStyle.trim() : '';
  if (rs) {
    out.renderingStyle = rs;
  }
  const ars = typeof options.artStyle === 'string' ? options.artStyle.trim() : '';
  if (ars) {
    out.artStyle = ars;
  }

  if (options.workflowControls && typeof options.workflowControls === 'object') {
    out.workflowControls = options.workflowControls;
  } else if (shotHint !== undefined) {
    out.workflowControls = buildDefaultWorkflowControls(episodeDuration, shotHint, motionBias);
  }

  const tbc = options.targetBlockCount;
  if (tbc !== undefined && Number.isFinite(tbc)) {
    const n = Math.max(4, Math.min(12, Math.round(Number(tbc))));
    const base =
      typeof out.workflowControls === 'object' && out.workflowControls !== null
        ? /** @type {Record<string, unknown>} */ (out.workflowControls)
        : buildDefaultWorkflowControls(
            episodeDuration,
            shotHint !== undefined ? shotHint : Math.max(8, Math.round(episodeDuration / 2)),
            motionBias,
          );
    out.workflowControls = { ...base, targetBlockCount: n };
  }

  return out;
}

/**
 * @param {string} episodePath
 * @returns {unknown}
 */
function readEpisodeJson(episodePath) {
  const resolved = path.resolve(process.cwd(), episodePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

export {
  buildEditMapInput,
  buildScriptFromShots,
  sumShotDurations,
  manifestBucket,
  normalizeMotionBias,
  MOTION_BIAS_MAP,
  MOTION_TO_SPEED,
  parseBriefStructuredHints,
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const episodePath = /** @type {string | undefined} */ (args.episode);
  if (!episodePath) {
    console.error(
      '用法: --episode <episode.json> [--script-file e1.md] [--global-synopsis "..."] [--global-synopsis-file path.md] [--duration 120] [--shot-hint 60] [--motion-bias 平衡] [--genre sweet_romance] [--rendering-style "真人电影"] [--art-style "冷调偏青"] [--target-block-count 6] [--brief "单集总时长120秒；目标镜头数约60。现代都市医疗情感短剧，真人电影风格。"] [--brief-file brief.txt] [--output out.json]',
    );
    process.exit(2);
  }

  const episode = readEpisodeJson(episodePath);
  let scriptContent = '';
  if (typeof args['script-file'] === 'string') {
    const sp = path.resolve(process.cwd(), args['script-file']);
    scriptContent = fs.readFileSync(sp, 'utf8');
  }

  const durationArg = args.duration;
  const episodeDuration =
    typeof durationArg === 'string' ? parseInt(durationArg, 10) : undefined;

  const shotHintArg = args['shot-hint'];
  const shotCountApprox =
    typeof shotHintArg === 'string' ? parseInt(shotHintArg, 10) : undefined;

  let globalSynopsisText = typeof args['global-synopsis'] === 'string' ? args['global-synopsis'] : '';
  if (typeof args['global-synopsis-file'] === 'string') {
    const sp = path.resolve(process.cwd(), args['global-synopsis-file']);
    globalSynopsisText = fs.readFileSync(sp, 'utf8').trim();
  }

  const motionBiasArg = typeof args['motion-bias'] === 'string' ? args['motion-bias'] : undefined;
  const genreArg = typeof args['genre'] === 'string' ? args['genre'] : undefined;
  const renderingStyleArg =
    typeof args['rendering-style'] === 'string' ? args['rendering-style'] : undefined;
  const artStyleArg = typeof args['art-style'] === 'string' ? args['art-style'] : undefined;

  const tbcArg = args['target-block-count'];
  const targetBlockCount =
    typeof tbcArg === 'string' ? parseInt(tbcArg, 10) : undefined;

  let briefText = typeof args['brief'] === 'string' ? args['brief'] : '';
  if (!briefText && typeof args['brief-file'] === 'string') {
    const bp = path.resolve(process.cwd(), args['brief-file']);
    briefText = fs.readFileSync(bp, 'utf8').trim();
  }

  const input = buildEditMapInput(episode, {
    globalSynopsis: globalSynopsisText,
    scriptContent,
    episodeDuration: Number.isFinite(episodeDuration) ? episodeDuration : undefined,
    shotCountApprox: Number.isFinite(shotCountApprox) ? shotCountApprox : undefined,
    motionBias: motionBiasArg,
    genre: genreArg,
    renderingStyle: renderingStyleArg,
    artStyle: artStyleArg,
    targetBlockCount: Number.isFinite(targetBlockCount) ? targetBlockCount : undefined,
    directorBrief: briefText || undefined,
  });

  const text = JSON.stringify(input, null, 2) + '\n';
  if (typeof args.output === 'string') {
    const outp = path.resolve(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outp), { recursive: true });
    fs.writeFileSync(outp, text, 'utf8');
    console.log(`[prepare_editmap_input] 已写入 ${outp}`);
  } else {
    process.stdout.write(text);
  }
}

const _entry = process.argv[1];
if (_entry && pathToFileURL(path.resolve(_entry)).href === import.meta.url) {
  main();
}
