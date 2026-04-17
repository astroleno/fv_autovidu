/**
 * SD2 v4 系统提示词路径（EditMap / Director / Prompter）+ 知识切片根目录。
 *
 * 路径解析优先级（从高到低）：
 *   1. process.env.SD2_PROMPT_ROOT  —— 外部注入的绝对路径，典型使用者：
 *      skills/generating-sd2-storyboards 在调流水线前会设置这个 env，
 *      指向 skill 内部自带的那一份 prompts 副本。
 *   2. 仓库根 prompt/1_SD2Workflow —— 默认值，保持与历史硬编码行为 100% 兼容，
 *      直接调用 run_sd2_pipeline.mjs 的现有用法完全不受影响。
 *
 * 目录结构要求（无论 env 指向哪里，都要满足）：
 *   <root>/
 *     ├── 1_EditMap-SD2/1_EditMap-SD2-v4.md
 *     ├── 2_SD2Director/2_SD2Director-v4.md
 *     ├── 2_SD2Prompter/2_SD2Prompter-v4.md
 *     └── 4_KnowledgeSlices/
 *         ├── injection_map.yaml
 *         └── (slice 子目录下各 .md 文件)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录绝对路径（本文件位置回溯 3 层） */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** 默认 prompt root（仓库根 prompt/1_SD2Workflow），用于向后兼容 */
const DEFAULT_PROMPT_ROOT = path.join(REPO_ROOT, 'prompt', '1_SD2Workflow');

/**
 * 计算当前生效的 prompt root。env 优先；env 未设时走仓库根默认值。
 * 注意：env 值即使是相对路径也会被 resolve 为绝对路径，
 * 以避免工作目录切换（cwd）造成路径漂移。
 * @returns {string}
 */
export function getPromptRoot() {
  const fromEnv = process.env.SD2_PROMPT_ROOT;
  if (fromEnv && fromEnv.trim()) {
    return path.resolve(fromEnv.trim());
  }
  return DEFAULT_PROMPT_ROOT;
}

/**
 * EditMap v4 系统提示词绝对路径。
 * @returns {string}
 */
export function getEditMapSd2V4PromptPath() {
  return path.join(getPromptRoot(), '1_EditMap-SD2', '1_EditMap-SD2-v4.md');
}

/**
 * Director v4 系统提示词绝对路径。
 * @returns {string}
 */
export function getDirectorSd2V4PromptPath() {
  return path.join(getPromptRoot(), '2_SD2Director', '2_SD2Director-v4.md');
}

/**
 * Prompter v4 系统提示词绝对路径。
 * @returns {string}
 */
export function getPrompterSd2V4PromptPath() {
  return path.join(getPromptRoot(), '2_SD2Prompter', '2_SD2Prompter-v4.md');
}

/**
 * 知识切片根目录（injection_map.yaml 所在目录）。
 * @returns {string}
 */
export function getKnowledgeSlicesRootPath() {
  return path.join(getPromptRoot(), '4_KnowledgeSlices');
}

/**
 * 存在性断言：主 prompt 文件必须可读，否则抛错。
 * 注意：只检查入参的单一文件，不做递归校验。
 * @param {string} absPath
 */
export function assertV4PromptFileExists(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`SD2 v4 系统提示词不存在: ${absPath}`);
  }
}
