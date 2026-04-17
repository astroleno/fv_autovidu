/**
 * SD2 v5 系统提示词路径（EditMap / Director / Prompter）+ 知识切片根目录。
 *
 * 设计要点（与 v4 的区别）：
 *   - 仅把默认文件名从 `-v4.md` 换成 `-v5.md`；
 *   - 其余（SD2_PROMPT_ROOT 优先级、向后兼容默认路径、知识切片根目录）全部保持不变；
 *   - 这样 v4 与 v5 可以在同一个 `prompt/1_SD2Workflow` 目录下并存（档位式），
 *     切换只通过 run_sd2_pipeline --sd2-version 参数决定调用哪份系统提示词。
 *
 * 路径解析优先级（从高到低）：
 *   1. process.env.SD2_PROMPT_ROOT —— 外部注入的绝对路径；
 *   2. 仓库根 prompt/1_SD2Workflow —— 默认值，历史行为完全兼容。
 *
 * 目录结构要求（无论 env 指向哪里都要满足）：
 *   <root>/
 *     ├── 1_EditMap-SD2/1_EditMap-SD2-v5.md
 *     ├── 2_SD2Director/2_SD2Director-v5.md
 *     ├── 2_SD2Prompter/2_SD2Prompter-v5.md
 *     └── 4_KnowledgeSlices/
 *         ├── injection_map.yaml      (v2.0：按 routing.* / psychology_group 路由)
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
 * EditMap v5 系统提示词绝对路径。
 * @returns {string}
 */
export function getEditMapSd2V5PromptPath() {
  return path.join(getPromptRoot(), '1_EditMap-SD2', '1_EditMap-SD2-v5.md');
}

/**
 * Director v5 系统提示词绝对路径。
 * @returns {string}
 */
export function getDirectorSd2V5PromptPath() {
  return path.join(getPromptRoot(), '2_SD2Director', '2_SD2Director-v5.md');
}

/**
 * Prompter v5 系统提示词绝对路径。
 * @returns {string}
 */
export function getPrompterSd2V5PromptPath() {
  return path.join(getPromptRoot(), '2_SD2Prompter', '2_SD2Prompter-v5.md');
}

/**
 * Stage 0 · ScriptNormalizer v1 系统提示词绝对路径。
 * 对应 `prompt/1_SD2Workflow/0_ScriptNormalizer/ScriptNormalizer-v1.md`。
 * 详见 `docs/stage0-normalizer/00_ScriptNormalizer-v1-计划.md`。
 *
 * @returns {string}
 */
export function getScriptNormalizerV1PromptPath() {
  return path.join(
    getPromptRoot(),
    '0_ScriptNormalizer',
    'ScriptNormalizer-v1.md',
  );
}

/**
 * Stage 0 `normalizedScriptPackage` 的 JSON Schema 绝对路径。
 * 对应 `docs/stage0-normalizer/01_schema.json`。
 *
 * @returns {string}
 */
export function getScriptNormalizerV1SchemaPath() {
  return path.join(
    getPromptRoot(),
    'docs',
    'stage0-normalizer',
    '01_schema.json',
  );
}

/**
 * 知识切片根目录（injection_map.yaml 所在目录）。
 * v5 与 v4 共用同一目录，但读取的是 v5 版本的 injection_map.yaml（v2.0 schema）。
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
export function assertV5PromptFileExists(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`SD2 v5 系统提示词不存在: ${absPath}`);
  }
}
