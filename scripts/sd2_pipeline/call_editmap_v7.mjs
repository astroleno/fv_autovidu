#!/usr/bin/env node
/**
 * EditMap v7 独立入口。
 *
 * 作用：
 *   - 固定默认 prompt 为 ledger-first pure_md 的 v7 版本；
 *   - 固定默认接入 L2 translator prompt；
 *   - 对外暴露新命令名，避免继续手动调用旧的 v6 入口脚本。
 *
 * 说明：
 *   - 真实实现仍复用 v6 调度器，因为下游 canonical JSON / hardgate / normalize 链路未分叉；
 *   - CLI 透传保持原样，用户显式传入的 `--prompt-file` / `--translator-prompt-file`
 *     会覆盖这里注入的默认值（parseArgs 以后值为准）。
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  getEditMapTranslatorPromptPath,
  getEditMapV7PromptPath,
} from './lib/sd2_prompt_paths_v6.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const IMPL = path.join('scripts', 'sd2_pipeline', 'call_editmap_sd2_v6.mjs');

const forwardedArgs = [
  IMPL,
  '--prompt-file',
  getEditMapV7PromptPath(),
  '--translator-prompt-file',
  getEditMapTranslatorPromptPath(),
  ...process.argv.slice(2),
];

const child = spawn(process.execPath, forwardedArgs, {
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    EDITMAP_SCRIPT_TAG: 'call_editmap_v7',
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error('[call_editmap_v7]', err instanceof Error ? err.message : err);
  process.exit(1);
});
