/**
 * SD2 v3 系统提示词路径（EditMap / Director / Prompter）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function getEditMapSd2V3PromptPath() {
  return path.join(
    REPO_ROOT,
    'prompt',
    '1_SD2Workflow',
    '1_EditMap-SD2',
    '1_EditMap-SD2-v3.md',
  );
}

export function getDirectorSd2V3PromptPath() {
  return path.join(
    REPO_ROOT,
    'prompt',
    '1_SD2Workflow',
    '2_SD2Director',
    '2_SD2Director-v3.md',
  );
}

export function getPrompterSd2V3PromptPath() {
  return path.join(
    REPO_ROOT,
    'prompt',
    '1_SD2Workflow',
    '2_SD2Prompter',
    '2_SD2Prompter-v3.md',
  );
}

/**
 * @param {string} absPath
 */
export function assertV3PromptFileExists(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`SD2 v3 系统提示词不存在: ${absPath}`);
  }
}
