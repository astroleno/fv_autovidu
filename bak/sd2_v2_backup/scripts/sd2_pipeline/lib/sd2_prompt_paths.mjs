/**
 * SD2 系统提示词路径解析（Prompter v1/v2 切换、环境变量覆盖）。
 * 默认使用 2_SD2Prompter-v2.md，与 prompt/1_SD2Workflow 下新版提示词对齐。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * 解析 SD2Prompter 系统提示词绝对路径。
 * - 环境变量 `SD2_PROMPTER_PROMPT`：相对仓库根或绝对路径。
 * - 未设置时使用仓库内默认 v2 文件。
 * @returns {string}
 */
export function getResolvedPrompterPromptPath() {
  const env = process.env.SD2_PROMPTER_PROMPT;
  if (typeof env === 'string' && env.trim()) {
    const t = env.trim();
    return path.isAbsolute(t) ? t : path.resolve(REPO_ROOT, t);
  }
  return path.join(
    REPO_ROOT,
    'prompt',
    '1_SD2Workflow',
    '2_SD2Prompter',
    '2_SD2Prompter-v2.md',
  );
}

/**
 * 启动前校验文件存在，便于报错信息清晰。
 * @param {string} absPath
 */
export function assertPromptFileExists(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`SD2Prompter 系统提示词不存在: ${absPath}`);
  }
}
