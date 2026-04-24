#!/usr/bin/env node
/**
 * v7 全链路入口（新编排）。
 *
 * 路由：
 *   - Stage 0 ScriptNormalizer v2：豆包 Ark
 *   - Stage 1 EditMap v7 L1：APIMart Anthropic /messages，默认 Opus 4.6 thinking
 *   - Stage 1 EditMap v7 L2 translator：本地 deterministic compiler
 *   - Stage 1.5 Scene Architect：APIMart Anthropic /messages，默认 Opus 4.6 thinking
 *   - Stage 2/3 并发 Block Chain：豆包 Ark
 *
 * 说明：
 *   - 这是新的用户入口，内部按阶段显式编排；
 *   - 后半段仍复用 `run_sd2_pipeline.mjs` 的 payload/build/final-report 逻辑，
 *     但 EditMap / Stage 1.5 都在这里先完成，不再依赖老入口调度。
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadEnvFromDotenv } from './lib/load_env.mjs';
import { checkFullPromptsV7 } from './lib/prompt_full_builder_v7.mjs';

loadEnvFromDotenv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT_TAG = 'run_pipeline_v7';

const DEFAULT_EDITMAP_MODEL = 'claude-opus-4-6-thinking';
const DEFAULT_SCENE_ARCHITECT_MODEL = 'claude-opus-4-6-thinking';

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
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
 * @param {string[]} nodeArgs
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<void>}
 */
function runNode(nodeArgs, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
      cwd: REPO_ROOT,
      env,
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`命令被信号中断: ${signal} :: node ${nodeArgs.join(' ')}`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`命令失败 (exit ${code ?? 'unknown'}): node ${nodeArgs.join(' ')}`));
    });
    child.on('error', (err) => reject(err));
  });
}

/**
 * 不覆盖用户显式 SD2_LLM_*；否则用 ARK_* 生成一份适合豆包的环境。
 *
 * @returns {NodeJS.ProcessEnv}
 */
function buildDoubaoEnv() {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  const base = (env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
  if (!env.SD2_LLM_BASE_URL?.trim()) env.SD2_LLM_BASE_URL = base;
  if (!env.SD2_LLM_API_KEY?.trim() && env.ARK_API_KEY?.trim()) env.SD2_LLM_API_KEY = env.ARK_API_KEY.trim();
  if (!env.SD2_LLM_MODEL?.trim()) env.SD2_LLM_MODEL = env.ARK_MODEL?.trim() || 'doubao-seed-2-0-pro-260215';
  if (!env.SD2_LLM_MAX_OUTPUT_TOKENS?.trim() && env.ARK_MAX_OUTPUT_TOKENS?.trim()) {
    env.SD2_LLM_MAX_OUTPUT_TOKENS = env.ARK_MAX_OUTPUT_TOKENS.trim();
  }
  if (!env.SD2_LLM_TIMEOUT_MS?.trim() && env.ARK_TIMEOUT_MS?.trim()) {
    env.SD2_LLM_TIMEOUT_MS = env.ARK_TIMEOUT_MS.trim();
  }
  if (!env.SD2_LLM_DISABLE_JSON_RESPONSE_FORMAT?.trim()) {
    env.SD2_LLM_DISABLE_JSON_RESPONSE_FORMAT = '1';
  }
  return env;
}

/**
 * prepare_editmap_input / late pipeline 共用的输入字段。
 *
 * @param {Record<string, string | boolean>} args
 * @returns {string[]}
 */
function collectSharedInputArgs(args) {
  /** @type {string[]} */
  const out = [];
  for (const key of [
    'episode-json',
    'script-file',
    'global-synopsis',
    'global-synopsis-file',
    'duration',
    'shot-hint',
    'motion-bias',
    'genre',
    'rendering-style',
    'art-style',
    'target-block-count',
    'brief',
    'brief-file',
  ]) {
    const v = args[key];
    if (typeof v === 'string') {
      out.push(`--${key}`, v);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const episodeJson =
    typeof args['episode-json'] === 'string' ? path.resolve(process.cwd(), args['episode-json']) : '';
  if (!episodeJson || !fs.existsSync(episodeJson)) {
    console.error(`[${SCRIPT_TAG}] 请提供有效 --episode-json`);
    process.exit(2);
  }

  const epData = JSON.parse(fs.readFileSync(episodeJson, 'utf8'));
  const episodeId = String(epData.episodeId || path.basename(path.dirname(episodeJson)));
  const outRoot =
    typeof args['output-dir'] === 'string'
      ? path.resolve(process.cwd(), args['output-dir'])
      : path.join(REPO_ROOT, 'output', 'sd2', `${episodeId}-v7`);
  const editMapInputOverride =
    typeof args['edit-map-input'] === 'string' && args['edit-map-input'].trim()
      ? path.resolve(process.cwd(), args['edit-map-input'].trim())
      : '';

  fs.mkdirSync(outRoot, { recursive: true });
  process.env.SD2_V7_FULL_PROMPTS = '1';

  const promptCheck = checkFullPromptsV7({});
  const promptManifestPath = path.join(outRoot, 'prompt_manifest.json');
  fs.writeFileSync(
    promptManifestPath,
    JSON.stringify(
      {
        workflow: 'sd2_v7',
        ok: promptCheck.ok,
        generated_prompt_mode: true,
        prompts: promptCheck.prompts.map(({ content: _content, ...rest }) => rest),
        diffs: promptCheck.diffs,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  if (!promptCheck.ok) {
    console.error(`[${SCRIPT_TAG}] generated full prompt 未同步，请先运行: node scripts/sd2_pipeline/build_full_prompts_v7.mjs --write`);
    for (const diff of promptCheck.diffs) {
      console.error(`  - ${diff.id}: ${diff.reason} (${diff.output})`);
    }
    process.exit(3);
  }
  console.log(`[${SCRIPT_TAG}] prompt manifest 已写入: ${promptManifestPath}`);

  const editMapInput = path.join(outRoot, 'edit_map_input.json');
  const normalizedPackage = path.join(outRoot, 'normalized_script_package.json');
  const editMapOut = path.join(outRoot, 'edit_map_sd2.json');

  const editMapModel =
    typeof args['editmap-model'] === 'string' ? args['editmap-model'] : DEFAULT_EDITMAP_MODEL;
  const translatorBackend =
    typeof args['translator-backend'] === 'string' ? args['translator-backend'] : 'local';
  const translatorModel =
    typeof args['translator-model'] === 'string' ? args['translator-model'] : '';
  const sceneArchitectModel =
    typeof args['scene-architect-model'] === 'string'
      ? args['scene-architect-model']
      : DEFAULT_SCENE_ARCHITECT_MODEL;

  const sharedInputArgs = collectSharedInputArgs(args);
  const doubaoEnv = buildDoubaoEnv();

  if (editMapInputOverride) {
    if (!fs.existsSync(editMapInputOverride)) {
      console.error(`[${SCRIPT_TAG}] --edit-map-input 文件不存在: ${editMapInputOverride}`);
      process.exit(2);
    }
    fs.copyFileSync(editMapInputOverride, editMapInput);
    console.log(`[${SCRIPT_TAG}] Stage 0 · 复用 edit_map_input: ${editMapInputOverride}`);
  } else {
    console.log(`[${SCRIPT_TAG}] Stage 0 · prepare_editmap_input`);
    await runNode([
      path.join('scripts', 'sd2_pipeline', 'prepare_editmap_input.mjs'),
      '--episode',
      episodeJson,
      ...sharedInputArgs.filter((_, idx, arr) => !(arr[idx - 1] === '--episode-json' || arr[idx] === '--episode-json')),
      '--output',
      editMapInput,
    ]);
  }

  console.log(`[${SCRIPT_TAG}] Stage 1 · ScriptNormalizer v2（豆包）`);
  await runNode(
    [
      path.join('scripts', 'sd2_pipeline', 'call_script_normalizer_v2.mjs'),
      '--input',
      editMapInput,
      '--output',
      normalizedPackage,
    ],
    doubaoEnv,
  );

  console.log(
    `[${SCRIPT_TAG}] Stage 2 · EditMap v7（L1 Opus/messages；L2 translator ${translatorBackend}）`,
  );
  const editMapArgs = [
    path.join('scripts', 'sd2_pipeline', 'call_editmap_v7.mjs'),
    '--input',
    editMapInput,
    '--output',
    editMapOut,
    '--normalized-package',
    normalizedPackage,
    '--apimart',
    '--model',
    editMapModel,
    '--translator-backend',
    translatorBackend,
  ];
  if (translatorModel) {
    editMapArgs.push('--translator-model', translatorModel);
  }
  await runNode(editMapArgs, doubaoEnv);

  console.log(`[${SCRIPT_TAG}] Stage 3 · Scene Architect 1.5（Opus 4.6 thinking / messages）`);
  await runNode([
    path.join('scripts', 'sd2_pipeline', 'call_scene_architect_v1.mjs'),
    '--edit-map',
    editMapOut,
    '--normalized-package',
    normalizedPackage,
    '--episode-json',
    episodeJson,
    '--output-dir',
    outRoot,
    '--model',
    sceneArchitectModel,
    '--apimart-messages',
  ]);

  console.log(`[${SCRIPT_TAG}] Stage 4 · Payload + Block Chain（豆包）`);
  /** @type {string[]} */
  const lateArgs = [
    path.join('scripts', 'sd2_pipeline', 'run_sd2_pipeline.mjs'),
    '--sd2-version',
    'v6',
    '--skip-editmap',
    '--output-dir',
    outRoot,
    '--block-chain-backend',
    'doubao',
    ...sharedInputArgs,
  ];
  if (editMapInputOverride) {
    lateArgs.push('--edit-map-input', editMapInputOverride);
  }
  for (const flag of [
    'skip-director',
    'skip-prompter',
    'allow-v6-soft',
    'skip-kva-hard',
    'skip-segment-coverage-hard',
    'skip-info-density-hard',
    'skip-dialogue-fidelity-hard',
    'skip-prompter-selfcheck-hard',
    'strict-quality-hard',
    'skip-dialogue-per-shot-hard',
    'skip-min-shots-hard',
    'skip-character-whitelist-hard',
    'skip-editmap-coverage-hard',
    'skip-last-seg-hard',
    'skip-source-integrity-hard',
  ]) {
    if (args[flag] === true) lateArgs.push(`--${flag}`);
  }
  await runNode(lateArgs, doubaoEnv);
}

main().catch((err) => {
  console.error(`[${SCRIPT_TAG}]`, err instanceof Error ? err.message : err);
  process.exit(1);
});
