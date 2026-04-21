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
  /**
   * v5.0-rev3 · Scheme B：返回 0 以让调用方用 DEFAULT_EPISODE_DURATION_SEC（120）统一兜底，
   * 不在此处返回硬编码 60。旧版本依赖 60 的外部消费者：已检查仅 prepare 内部使用。
   */
  if (!episode || typeof episode !== 'object') {
    return 0;
  }
  const scenes = /** @type {{ scenes?: unknown[] }} */ (episode).scenes;
  if (!Array.isArray(scenes)) {
    return 0;
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
 * 从 directorBrief 自然语言中仅解析「单集总时长」作为 episodeDuration 的最后兜底。
 *
 * v5.0-rev3（Scheme B · 去锚点）：**不再**从 brief 抽取镜头数 / block 数 / 时长区间等"推理空间"
 * 数字。这些数字应由 EditMap LLM 自己根据 brief + 剧本推理（写入 meta.parsed_brief），
 * prepare 层不再做任何"正则 → 数据锚"的降级处理。
 *
 * 保留时长解析是因为 episodeDuration 是**物理事实**（客户订单长度），LLM 无法从剧本自推。
 *
 * @param {string} text
 * @returns {{ episodeDuration?: number }}
 */
function parseBriefStructuredHints(text) {
  const out = /** @type {{ episodeDuration?: number }} */ ({});
  if (!text || typeof text !== 'string') {
    return out;
  }
  const patterns = [
    /单集总时长\s*(\d+)\s*秒/,
    /本集(?:约|共)?\s*(\d+)\s*秒/,
    /每集(?:约|共)?\s*(\d+)\s*秒/,
    /总时长\s*(\d+)\s*秒/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) {
        out.episodeDuration = n;
        break;
      }
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

/** v5.0-rev3 · Scheme B：默认单集时长（当 CLI / brief / episode 都没有给时兜底） */
const DEFAULT_EPISODE_DURATION_SEC = 120;

/** v5.0-rev3 · Scheme B：默认兜底镜头数的软参考，仅用于写入 brief 的参考区间（不进数据字段） */
const DEFAULT_AVG_SHOT_DURATION_SEC = 2;

/**
 * v5.0-rev3 · Scheme B 核心：构造"有效 directorBrief"——一段**自然语言**，
 * 作为 EditMap LLM 的**最高优先级约束**（高于任何数据字段默认值）。
 *
 * 设计原则（用户落地决策 2026-04-17）：
 *   - 用户给什么就用什么（brief / shot-hint / block-count 等 CLI hint）；
 *   - 没给的，**不进 workflowControls 数字表**，而是合并成一段自然语言后缀给 LLM，
 *     让 LLM 自己权衡"要不要参考这个默认值"；
 *   - 剧本与 brief 永远优先；默认值只在"完全没输入"时兜底。
 *
 * 三段结构：
 *   A. 用户自己的 brief（若有）；
 *   B. 系统补齐段（若用户 brief 未提时长 / 镜头数，由这里补——自然语言软提示，非硬约束）；
 *   C. 自主推理授权（明确告诉 LLM"默认值仅供参考，剧本优先"）。
 *
 * @param {{ userBrief: string, episodeDuration: number, shotHintFromCli?: number, targetBlockCountFromCli?: number }} input
 * @returns {string}
 */
function composeEffectiveBrief(input) {
  const { userBrief, episodeDuration, shotHintFromCli, targetBlockCountFromCli } = input;
  const parts = /** @type {string[]} */ ([]);

  const trimmedUser = (userBrief || '').trim();
  if (trimmedUser) {
    parts.push(trimmedUser);
  }

  /**
   * 系统补齐段：只有在用户 brief 里没写对应信息时才追加。
   * 用关键词粗查（同 parseBriefStructuredHints 的启发式），漏报不致命（LLM 可兼容）。
   */
  const userMentionsDuration = /\d+\s*秒|总时长|每集|本集|单集/.test(trimmedUser);
  const userMentionsShotCount = /镜头|分镜|shot|镜数/i.test(trimmedUser);
  const userMentionsBlockCount = /\d+\s*(?:块|段|组|block)/i.test(trimmedUser);

  const suppl = /** @type {string[]} */ ([]);
  if (!userMentionsDuration) {
    suppl.push(`本集约 ${episodeDuration} 秒。`);
  }
  if (!userMentionsShotCount) {
    const ref = Math.round(episodeDuration / DEFAULT_AVG_SHOT_DURATION_SEC);
    const lo = Math.round(ref * 0.75);
    const hi = Math.round(ref * 1.25);
    suppl.push(
      `镜头总数请基于剧本密度、钩子分布、情绪曲线自主决定（参考区间 ${lo}–${hi}，以剧本节奏为准）。`,
    );
  }
  if (!userMentionsBlockCount) {
    suppl.push(
      `Block 切分数量与每块时长由你根据剧本自主决定（铁律：每块 4–15 秒、总时长守恒）。`,
    );
  }

  /** CLI 仍传了 hint 的向后兼容：把它们合入 brief 文末（软提示），而不是硬塞数据字段 */
  if (typeof shotHintFromCli === 'number' && shotHintFromCli > 0) {
    suppl.push(`（CLI 参考 hint：镜头数约 ${shotHintFromCli}，剧本节奏仍然优先。）`);
  }
  if (typeof targetBlockCountFromCli === 'number' && targetBlockCountFromCli > 0) {
    suppl.push(
      `（CLI 参考 hint：Block 约 ${targetBlockCountFromCli} 块，剧本节奏仍然优先。）`,
    );
  }

  if (suppl.length > 0) {
    parts.push(suppl.join(' '));
  }

  if (parts.length === 0) {
    /** 完全兜底：没有任何用户输入，也没有 CLI 补齐 */
    parts.push(
      `本集约 ${episodeDuration} 秒。Block 切分、每块时长、总镜头数均由你根据剧本自主决定；铁律：每块 4–15 秒、总时长守恒。`,
    );
  }

  return parts.join('\n\n');
}

/**
 * v5.0-rev3 · Scheme B：构造 EditMap 输入 JSON。
 *
 * **字段分层**（用户落地决策 2026-04-17）：
 *
 *  [A] 物理事实 / 必给（LLM 不能自推）
 *      - scriptContent     剧本
 *      - episodeDuration   总时长（缺省 120s）
 *      - assetManifest / referenceAssets   可用资产清单
 *
 *  [B] 自然语言约束 · 最高优先级（优先级 > 任何默认值）
 *      - directorBrief     用户自然语言 brief（由 composeEffectiveBrief 与默认兜底合并）
 *
 *  [C] 审美诉求（用户显式给了就用）
 *      - motionBias / genre / renderingStyle / artStyle
 *
 *  [D] 已删除字段（v5.0-rev3 去锚点重构）
 *      - ❌ workflowControls             → 所有数字让 LLM 自行从 brief 推理
 *      - ❌ episodeShotCount（顶层）     → 合入 brief 文案
 *      - ❌ globalSynopsis 头部前缀      → 不再污染剧本入口
 *
 * CLI 仍允许传 --shot-hint / --target-block-count 作为"软 hint"，但**不再**进数据字段，
 * 而是通过 composeEffectiveBrief 合入 directorBrief 文末。
 *
 * @param {unknown} episode episode.json 解析结果
 * @param {{ globalSynopsis?: string, scriptContent?: string, episodeDuration?: number, shotCountApprox?: number, motionBias?: string, genre?: string, renderingStyle?: string, artStyle?: string, targetBlockCount?: number, directorBrief?: string }} options
 * @returns {{ globalSynopsis: string, scriptContent: string, assetManifest: object, episodeDuration: number, referenceAssets: Array<{ assetName: string, assetType: string }>, directorBrief: string, motionBias: string }}
 */
function buildEditMapInput(episode, options) {
  const globalSynopsis = (options.globalSynopsis || '').trim();
  let scriptContent = options.scriptContent || '';
  if (!scriptContent) {
    scriptContent = buildScriptFromShots(episode);
  }

  const briefRaw = typeof options.directorBrief === 'string' ? options.directorBrief.trim() : '';
  const fromBrief = briefRaw ? parseBriefStructuredHints(briefRaw) : {};

  /**
   * episodeDuration 解析优先级（Scheme B · 仅保留物理事实）：
   *   1. CLI --duration
   *   2. brief 文本里的"本集 N 秒"（仅时长，不再抽镜头数）
   *   3. episode.json 分镜累加
   *   4. 默认兜底 DEFAULT_EPISODE_DURATION_SEC（120s）
   */
  const explicitDuration =
    typeof options.episodeDuration === 'number' && options.episodeDuration > 0
      ? options.episodeDuration
      : undefined;
  const episodeDuration =
    explicitDuration !== undefined
      ? explicitDuration
      : typeof fromBrief.episodeDuration === 'number' && fromBrief.episodeDuration > 0
        ? fromBrief.episodeDuration
        : sumShotDurations(episode) || DEFAULT_EPISODE_DURATION_SEC;

  /** CLI 里的镜头数 / block 数 hint：不再进数据字段，而是合入 brief 文末 */
  const shotHintFromCli =
    typeof options.shotCountApprox === 'number' && options.shotCountApprox > 0
      ? options.shotCountApprox
      : undefined;
  const targetBlockCountFromCli =
    typeof options.targetBlockCount === 'number' &&
    Number.isFinite(options.targetBlockCount) &&
    options.targetBlockCount > 0
      ? Math.round(options.targetBlockCount)
      : undefined;

  const effectiveBrief = composeEffectiveBrief({
    userBrief: briefRaw,
    episodeDuration,
    shotHintFromCli,
    targetBlockCountFromCli,
  });

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

  /** @type {Record<string, unknown>} */
  const out = {
    globalSynopsis,
    scriptContent,
    assetManifest: manifest,
    episodeDuration,
    referenceAssets,
    directorBrief: effectiveBrief,
    motionBias,
  };

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

  return /** @type {any} */ (out);
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
  composeEffectiveBrief,
  DEFAULT_EPISODE_DURATION_SEC,
  DEFAULT_AVG_SHOT_DURATION_SEC,
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const episodePath = /** @type {string | undefined} */ (args.episode);
  if (!episodePath) {
    console.error(
      '用法: --episode <episode.json> [--script-file e1.md] [--global-synopsis "..."] [--global-synopsis-file path.md]\n' +
        '  [--duration 120]   单集时长（默认 120；物理事实，LLM 不能自推）\n' +
        '  [--motion-bias 平衡] [--genre sweet_romance] [--rendering-style "真人电影"] [--art-style "冷调偏青"]\n' +
        '  [--brief "本集约120秒，节奏偏紧，参考 60 镜"] / [--brief-file brief.txt]\n' +
        '                     自然语言约束，优先级最高（高于所有默认值）\n' +
        '  [--shot-hint 60]   ⚠ deprecated：合入 brief 文末，不再进数据字段\n' +
        '  [--target-block-count 8]   ⚠ deprecated：合入 brief 文末，不再进数据字段\n' +
        '  [--output out.json]',
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
