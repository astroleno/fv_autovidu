#!/usr/bin/env node
/**
 * generating-sd2-storyboards 薄封装：(script + brief + assets-file + slug) 四参数
 * 驱动 scripts/sd2_pipeline/run_sd2_pipeline.mjs 跑出完整 SD2 分镜产物。
 *
 * 重试策略（与 SKILL.md 对齐）：第 1 次 thinking ON；失败则第 2 次 thinking OFF + 提高
 * max_tokens；两次仍失败 exit 3。退出码：0 成功 / 2 输入非法 / 3 重试仍失败 / 4 前置缺失。
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

import { buildEditMapInput } from '../../../scripts/sd2_pipeline/prepare_editmap_input.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根绝对路径（本脚本回溯 3 层） */
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
/** skill 自带 prompts 副本绝对路径（运行时传给流水线作为 SD2_PROMPT_ROOT） */
const SKILL_PROMPT_ROOT = path.resolve(SCRIPT_DIR, '..', 'prompts');

/** preCheck 时必须存在的 prompts 文件清单；任一缺失直接 exit 4 */
const REQUIRED_PROMPT_FILES = /** @type {const} */ (['1_EditMap-SD2/1_EditMap-SD2-v4.md', '2_SD2Director/2_SD2Director-v4.md', '2_SD2Prompter/2_SD2Prompter-v4.md', '4_KnowledgeSlices/injection_map.yaml', 'VERSION']);

/** 第 1 次运行时 EditMap max_tokens：覆盖云雾默认 8192，留足 Opus thinking 占位 */
const EDITMAP_MAX_TOKENS_FIRST = 32000;

/** 第 2 次重试：+50% 经验值，兜住"brief 长 + 剧本长"场景 */
const EDITMAP_MAX_TOKENS_RETRY = 48000;

/** 硬超时：10~14 Block × 2 次 LLM + stagger ≈ 18 分钟，留 2 分钟 buffer */
const PIPELINE_TIMEOUT_MS = 20 * 60 * 1000;

/** 固定的流水线 flag（v4 Block 链 + 云雾 EditMap + qwen-plus 下游） */
const FIXED_PIPELINE_ARGS = /** @type {const} */ (['--sd2-version', 'v4', '--yunwu', '--downstream-model', 'qwen-plus']);

/** 资产 type 4 个合法枚举 */
const ASSET_TYPES = /** @type {const} */ (['character', 'scene', 'prop', 'vfx']);

/**
 * @typedef {Object} ParsedArgs
 * @property {string} script
 * @property {string} brief
 * @property {string} assetsFile
 * @property {string} slug
 *
 * @typedef {Object} AssetItem
 * @property {string} name
 * @property {('character'|'scene'|'prop'|'vfx')} type
 * @property {string} [description]
 *
 * @typedef {Object} PipelineOutcome
 * @property {boolean} success
 * @property {string}  [reason]
 */

/** 统一前缀日志；level=err 时走 stderr @param {string} msg @param {'info'|'err'} [level] */
const log = (msg, level = 'info') => {
  const line = `[generate-sd2-storyboard] ${msg}`;
  if (level === 'err') console.error(line); else console.log(line);
};

/**
 * 解析 `--key value` 形式 argv。零依赖，故意不用第三方。
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArgv(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = '';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * 校验并规范化 CLI 输入；失败 exit 2。
 * @param {Record<string, string>} raw
 * @returns {ParsedArgs}
 */
function normalizeArgs(raw) {
  const errors = /** @type {string[]} */ ([]);
  const script = (raw.script || '').trim();
  const brief = (raw.brief || '').trim();
  const assetsFile = (raw['assets-file'] || '').trim();
  let slug = (raw.slug || '').trim();

  if (!script) errors.push('--script 必填（剧本路径或内联文本）');
  if (!brief) errors.push('--brief 必填（一句话导演简报）');
  if (!assetsFile) errors.push('--assets-file 必填（资产列表 JSON 文件路径）');

  if (!slug) {
    const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    slug = `sd2-${ts}`;
  }
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) {
    errors.push(`--slug 仅允许 a-z/0-9/- 且 ≤40 字符，收到: ${slug}`);
  }

  if (errors.length > 0) {
    log('输入校验失败:', 'err');
    for (const e of errors) log(`  - ${e}`, 'err');
    log('示例: --script path.md --brief "单集 120 秒..." --assets-file assets.json --slug demo', 'err');
    process.exit(2);
  }
  return { script, brief, assetsFile, slug };
}

/**
 * 前置条件检查：仓库根 / 流水线脚本 / .env / 密钥。失败 exit 4。
 */
function preCheck() {
  const envPath = path.join(REPO_ROOT, '.env');
  const pipelineScript = path.join(REPO_ROOT, 'scripts', 'sd2_pipeline', 'run_sd2_pipeline.mjs');

  if (!fs.existsSync(pipelineScript)) {
    log(`未找到流水线脚本: ${pipelineScript}`, 'err');
    log('请确认当前工作目录是 fv_autovidu 仓库根。', 'err');
    process.exit(4);
  }
  if (!fs.existsSync(envPath)) {
    log(`未找到 ${envPath}；请从 .env.example 复制并填入密钥`, 'err');
    process.exit(4);
  }
  const envText = fs.readFileSync(envPath, 'utf8');
  const missing = /** @type {string[]} */ ([]);
  if (!/\bYUNWU_API_KEY\s*=\s*\S+/.test(envText)) missing.push('YUNWU_API_KEY');
  if (!/\bDASHSCOPE_API_KEY\s*=\s*\S+/.test(envText)) missing.push('DASHSCOPE_API_KEY');
  if (missing.length > 0) {
    log(`.env 缺少必需密钥: ${missing.join(', ')}`, 'err');
    process.exit(4);
  }

  // 校验 skill 自带 prompts 副本的完整性（SKILL_PROMPT_ROOT 不存在时 existsSync 返回 false，会体现在 missing 列表里）
  const missingPrompts = REQUIRED_PROMPT_FILES.filter(
    (rel) => !fs.existsSync(path.join(SKILL_PROMPT_ROOT, rel)),
  );
  if (missingPrompts.length > 0) {
    log(`skill 自带 prompts 副本不完整 (root=${SKILL_PROMPT_ROOT}):`, 'err');
    for (const rel of missingPrompts) log(`  - prompts/${rel}`, 'err');
    log('请跑 skills/generating-sd2-storyboards/scripts/sync-from-repo.mjs 重新同步', 'err');
    process.exit(4);
  }
}

/**
 * value 是文件路径则读取，否则按内联文本返回。
 * @param {string} value
 * @returns {string}
 */
function readScript(value) {
  const resolved = path.resolve(process.cwd(), value);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return fs.readFileSync(resolved, 'utf8');
  }
  return value;
}

/**
 * 读资产 JSON 并做 schema 校验，失败 exit 2。
 * @param {string} filePath
 * @returns {AssetItem[]}
 */
function loadAssets(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    log(`--assets-file 不存在: ${resolved}`, 'err');
    process.exit(2);
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (e) {
    log(`资产文件 JSON 解析失败: ${resolved}`, 'err');
    log(e instanceof Error ? e.message : String(e), 'err');
    process.exit(2);
  }
  if (!Array.isArray(parsed)) {
    log('资产文件顶层必须是数组', 'err');
    process.exit(2);
  }
  /** @type {AssetItem[]} */
  const assets = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const row = /** @type {Record<string, unknown>} */ (parsed[i]);
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const type = typeof row.type === 'string' ? row.type.trim() : '';
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    if (!name) {
      log(`第 ${i} 项缺少 name`, 'err');
      process.exit(2);
    }
    if (!ASSET_TYPES.includes(/** @type {typeof ASSET_TYPES[number]} */ (type))) {
      log(`第 ${i} 项 type 非法（应为 character/scene/prop/vfx）: ${type}`, 'err');
      process.exit(2);
    }
    assets.push({
      name,
      type: /** @type {AssetItem['type']} */ (type),
      description: description || name,
    });
  }
  if (assets.length === 0) {
    log('资产列表为空', 'err');
    process.exit(2);
  }
  if (!assets.some((a) => a.type === 'character') || !assets.some((a) => a.type === 'scene')) {
    log('至少需要 1 个 character 和 1 个 scene', 'err');
    process.exit(2);
  }
  return assets;
}

/**
 * 生成产物目录，写 edit_map_input.json 和最小 episode.json。
 * @param {ParsedArgs} args
 * @param {string} scriptContent
 * @param {AssetItem[]} assets
 * @returns {{ outDir: string, editMapInputPath: string, episodeJsonPath: string }}
 */
function writeInputs(args, scriptContent, assets) {
  const outDir = path.join(REPO_ROOT, 'output', 'sd2', args.slug);
  fs.mkdirSync(outDir, { recursive: true });

  // 最小 episode：仅为 buildEditMapInput 提供 assets 数组与 episodeId
  const episode = {
    episodeId: args.slug,
    assets: assets.map((a) => ({
      name: a.name,
      prompt: a.description || a.name,
      type: a.type,
    })),
  };

  const editMapInput = buildEditMapInput(episode, {
    scriptContent,
    directorBrief: args.brief,
  });

  const editMapInputPath = path.join(outDir, 'edit_map_input.json');
  fs.writeFileSync(editMapInputPath, JSON.stringify(editMapInput, null, 2) + '\n', 'utf8');

  const episodeJsonPath = path.join(outDir, 'episode.json');
  fs.writeFileSync(
    episodeJsonPath,
    JSON.stringify({ episodeId: args.slug }, null, 2) + '\n',
    'utf8',
  );

  return { outDir, editMapInputPath, episodeJsonPath };
}

/**
 * 调 run_sd2_pipeline.mjs，stdout/stderr 透传，超时自动 kill。
 * @param {{ outDir: string, editMapInputPath: string, episodeJsonPath: string }} paths
 * @param {{ noThinking: boolean, maxTokens: number }} options
 * @returns {Promise<PipelineOutcome>}
 */
function runPipeline(paths, options) {
  return new Promise((resolve) => {
    /** @type {string[]} */
    const nodeArgs = [
      path.join('scripts', 'sd2_pipeline', 'run_sd2_pipeline.mjs'), ...FIXED_PIPELINE_ARGS,
      '--edit-map-input', paths.editMapInputPath,
      '--episode-json', paths.episodeJsonPath,
      '--output-dir', paths.outDir,
    ];
    if (options.noThinking) nodeArgs.push('--no-thinking');
    // 关键：SD2_PROMPT_ROOT 让流水线读 skill 自带 prompts 副本而非仓库根，
    // 保证 skill 运行结果不受仓库根 prompt/ 开发中改动影响
    const env = { ...process.env, YUNWU_EDITMAP_MAX_TOKENS: String(options.maxTokens), SD2_PROMPT_ROOT: SKILL_PROMPT_ROOT };
    const child = spawn(process.execPath, nodeArgs, { cwd: REPO_ROOT, stdio: 'inherit', env });

    const timer = setTimeout(() => {
      log(`流水线超过 ${PIPELINE_TIMEOUT_MS / 60000} 分钟未完成，强制中止`, 'err');
      child.kill('SIGTERM');
    }, PIPELINE_TIMEOUT_MS);

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ success: true });
      else resolve({ success: false, reason: `pipeline exit code ${code}` });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ success: false, reason: e.message });
    });
  });
}

/**
 * 机械校验关键产物是否就绪。
 * @param {string} outDir
 * @returns {PipelineOutcome}
 */
function checkArtifacts(outDir) {
  const editMapPath = path.join(outDir, 'edit_map_sd2.json');
  const reportJsonPath = path.join(outDir, 'sd2_final_report.json');

  if (!fs.existsSync(editMapPath)) return { success: false, reason: 'edit_map_sd2.json 未生成' };
  try {
    JSON.parse(fs.readFileSync(editMapPath, 'utf8'));
  } catch {
    return { success: false, reason: 'edit_map_sd2.json 解析失败（可能被截断）' };
  }
  if (!fs.existsSync(reportJsonPath)) return { success: false, reason: 'sd2_final_report.json 未生成' };

  /** @type {unknown} */
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
  } catch {
    return { success: false, reason: 'sd2_final_report.json 解析失败' };
  }
  const summary = /** @type {{ summary?: { blockCount?: number, blocks?: unknown[] } }} */ (
    report
  ).summary;
  if (!summary || typeof summary.blockCount !== 'number' || summary.blockCount <= 0) {
    return { success: false, reason: 'final report 缺少 summary.blockCount' };
  }
  const blocks = Array.isArray(summary.blocks) ? summary.blocks : [];
  if (blocks.length !== summary.blockCount) {
    return { success: false, reason: 'blocks 数量与 blockCount 不一致' };
  }
  return { success: true };
}

async function main() {
  const args = normalizeArgs(parseArgv(process.argv.slice(2)));
  preCheck();
  // 读 prompts VERSION 仅用于启动日志，读不到不致命（preCheck 已保证文件存在）
  const promptsVer = (() => {
    try { return fs.readFileSync(path.join(SKILL_PROMPT_ROOT, 'VERSION'), 'utf8').trim(); }
    catch { return 'unknown'; }
  })();

  log(`slug=${args.slug}`);
  log(`prompts 副本版本: v${promptsVer}  (来源: ${SKILL_PROMPT_ROOT})`);
  const scriptContent = readScript(args.script);
  const assets = loadAssets(args.assetsFile);
  log(`剧本长度 ${scriptContent.length} 字；资产 ${assets.length} 项`);

  const paths = writeInputs(args, scriptContent, assets);
  log(`输入已写入: ${paths.outDir}`);

  log('第 1 次运行（thinking ON）...');
  let outcome = await runPipeline(paths, {
    noThinking: false,
    maxTokens: EDITMAP_MAX_TOKENS_FIRST,
  });
  if (outcome.success) outcome = checkArtifacts(paths.outDir);

  if (!outcome.success) {
    log(`第 1 次失败: ${outcome.reason}`, 'err');
    log('触发第 2 次重试（thinking OFF + 更大 max_tokens）...');
    outcome = await runPipeline(paths, {
      noThinking: true,
      maxTokens: EDITMAP_MAX_TOKENS_RETRY,
    });
    if (outcome.success) outcome = checkArtifacts(paths.outDir);
  }

  if (!outcome.success) {
    log(`两次重试仍失败: ${outcome.reason}`, 'err');
    log(`产物目录（含最后一次快照）: ${paths.outDir}`, 'err');
    log('按 skills/generating-sd2-storyboards/reference/troubleshooting.md 处置', 'err');
    process.exit(3);
  }

  log('生成完成');
  log(`产物目录: ${paths.outDir}`);
  log(`Markdown 报告: ${path.join(paths.outDir, 'sd2_final_report.md')}`);
}

const _entry = process.argv[1];
if (_entry && pathToFileURL(path.resolve(_entry)).href === import.meta.url) {
  main().catch((e) => {
    log(e instanceof Error ? e.message : String(e), 'err');
    process.exit(1);
  });
}
