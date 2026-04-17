/**
 * SD2 v4 系统提示词路径（EditMap / Director / Prompter）。
 * 编排层只读 v4 文件（见 prompt/1_SD2Workflow/SD2Workflow-v4-接入指南.md）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * @returns {string}
 */
export function getEditMapSd2V4PromptPath() {
  return path.join(
    REPO_ROOT,
    'prompt',
    '1_SD2Workflow',
    '1_EditMap-SD2',
    '1_EditMap-SD2-v4.md',
  );
}

/**
 * @returns {string}
 */
export function getDirectorSd2V4PromptPath() {
  return path.join(
    REPO_ROOT,
    'prompt',
    '1_SD2Workflow',
    '2_SD2Director',
    '2_SD2Director-v4.md',
  );
}

/**
 * @returns {string}
 */
export function getPrompterSd2V4PromptPath() {
  return path.join(
    REPO_ROOT,
    'prompt',
    '1_SD2Workflow',
    '2_SD2Prompter',
    '2_SD2Prompter-v4.md',
  );
}

/**
 * 知识切片根目录（injection_map.yaml 所在目录）
 * @returns {string}
 */
export function getKnowledgeSlicesRootPath() {
  return path.join(
    REPO_ROOT,
    'prompt',
    '1_SD2Workflow',
    '4_KnowledgeSlices',
  );
}

/**
 * @param {string} absPath
 */
export function assertV4PromptFileExists(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`SD2 v4 系统提示词不存在: ${absPath}`);
  }
}
