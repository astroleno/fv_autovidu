/**
 * SD2 v6 系统提示词路径（Normalizer v2 / EditMap v6 / Director v6 / Prompter v6）
 * + 知识切片根目录。
 *
 * 与 v5 的关系：
 *   - **文件名档位**：v5 与 v6 可以在同一份 `prompt/1_SD2Workflow/` 目录下并存。
 *     切换只通过 `run_sd2_pipeline --sd2-version` 决定调用哪份系统提示词。
 *   - **共用知识切片目录**：v5 / v6 共用 `4_KnowledgeSlices/`，但读取的
 *     `injection_map.yaml` 已经升级到 v2.1（新增 `has_kva` 匹配键、director
 *     条件切片 `v6_kva_examples.md`、director 无条件切片 `v6_segment_consumption_priority.md`）。
 *   - **editmap/ 方法论切片**：v6 在 v5 的 6 份方法论切片之外**追加**
 *     `editmap/v6_rhythm_templates.md`，由 `lib/editmap_slices_v6.mjs` 单独负责拼装；
 *     本文件**不**涉及 editmap/ 切片列表。
 *
 * 路径解析优先级（与 v5 一致）：
 *   1. `process.env.SD2_PROMPT_ROOT` —— 外部注入的绝对路径（测试、替身）；
 *   2. 仓库根 `prompt/1_SD2Workflow` —— 默认值，历史行为完全兼容。
 *
 * 目录结构要求（无论 env 指向哪里都要满足）：
 *   <root>/
 *     ├── 0_ScriptNormalizer/ScriptNormalizer-v2.md
 *     ├── 1_EditMap-SD2/1_EditMap-SD2-v6.md
 *     ├── 2_SD2Director/2_SD2Director-v6.md
 *     ├── 2_SD2Prompter/2_SD2Prompter-v6.md
 *     └── 4_KnowledgeSlices/
 *         ├── injection_map.yaml        （v2.1：新增 has_kva 条件键）
 *         ├── editmap/v6_rhythm_templates.md   （v6 追加的 editmap/ 方法论切片）
 *         └── director/v6_kva_examples.md、v6_segment_consumption_priority.md
 *
 * 契约源：
 *   - `prompt/1_SD2Workflow/docs/v6/07_v6-schema-冻结.md` §1 提示词入口
 *   - `prompt/1_SD2Workflow/docs/v6/00_v6-升级计划总览.md`
 *
 * 注意事项：
 *   - 本文件**只**提供路径计算；不读文件、不做切片拼装。
 *   - 存在性断言 `assertV6PromptFileExists` 只校验单文件；上层（call_editmap_sd2_v6
 *     / call_sd2_block_chain_v6 / call_script_normalizer_v2）负责按需调用。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 仓库根目录绝对路径（本文件位置回溯 3 层：lib → sd2_pipeline → scripts → repo）。
 * 与 v5 同值，只是为了让 v6 路径计算保持自给自足，不 re-export v5 的 REPO_ROOT。
 */
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** 默认 prompt root（仓库根 `prompt/1_SD2Workflow`），用于向后兼容。 */
const DEFAULT_PROMPT_ROOT = path.join(REPO_ROOT, 'prompt', '1_SD2Workflow');

/**
 * 计算当前生效的 prompt root。
 *
 * env 优先；env 未设时走仓库根默认值。
 * env 值即使是相对路径也会被 resolve 为绝对路径，以避免工作目录切换（cwd）造成路径漂移。
 *
 * @returns {string}
 */
export function getPromptRootV6() {
  const fromEnv = process.env.SD2_PROMPT_ROOT;
  if (fromEnv && fromEnv.trim()) {
    return path.resolve(fromEnv.trim());
  }
  return DEFAULT_PROMPT_ROOT;
}

/**
 * Stage 0 · ScriptNormalizer v2 系统提示词绝对路径。
 *
 * 对应 `prompt/1_SD2Workflow/0_ScriptNormalizer/ScriptNormalizer-v2.md`；
 * v2 相对于 v1 新增字段：
 *   - `beat_ledger[].key_visual_actions[]`（KVA · Key Visual Actions）
 *   - `beat_ledger[].structure_hints[]`（高亮结构提示）
 *   - `beat_ledger[].segments[].dialogue_char_count`（对白字数计量）
 *   - `meta.genre_bias_inferred`（体裁偏向推断）
 *   - `author_hint.shortened_text`（作者授权的对白压缩标注）
 *
 * @returns {string}
 */
export function getScriptNormalizerV2PromptPath() {
  return path.join(
    getPromptRootV6(),
    '0_ScriptNormalizer',
    'ScriptNormalizer-v2.md',
  );
}

/**
 * EditMap-SD2 v6 系统提示词绝对路径。
 *
 * 对应 `prompt/1_SD2Workflow/1_EditMap-SD2/1_EditMap-SD2-v6.md`（delta 文档）；
 * v6 相对于 v5 新增：
 *   - `meta.style_inference`（风格三轴独立推断）
 *   - `block.covered_segment_ids[]` + `block.script_chunk_hint`（段覆盖显式化）
 *   - `meta.rhythm_timeline`（节奏时间线：golden_open_3s / mini_climaxes / major_climax / closing_hook）
 *
 * @returns {string}
 */
export function getEditMapSd2V6PromptPath() {
  return path.join(getPromptRootV6(), '1_EditMap-SD2', '1_EditMap-SD2-v6.md');
}

/**
 * Director v6 系统提示词绝对路径。
 *
 * 对应 `prompt/1_SD2Workflow/2_SD2Director/2_SD2Director-v6.md`（delta 文档）；
 * v6 新增铁律：剧本原文消费、KVA / structure_hints 消费、info_delta 密度、
 * 五段式 slot 填充、major_climax 三选一校验、closing_hook 要求。
 *
 * @returns {string}
 */
export function getDirectorSd2V6PromptPath() {
  return path.join(getPromptRootV6(), '2_SD2Director', '2_SD2Director-v6.md');
}

/**
 * Stage 1.5 · Scene Architect v1 系统提示词绝对路径。
 *
 * 对应 `prompt/1_SD2Workflow/1_5_SceneArchitect/1_5_SceneArchitect-v1.md`；
 * Scene Architect 是 EditMap 与 Director 之间的调度层（v1 PoC 只做
 * rhythm_timeline 微调 + KVA 编排建议；不产出 scene_blocking_sheets / audio_intent_ledger）。
 *
 * 契约源：
 *   - `prompt/1_SD2Workflow/docs/v6/05_v6-场级调度与音频意图.md`
 *   - `prompt/1_SD2Workflow/docs/v6/06_v6-节奏推导与爆点密度.md`
 *
 * @returns {string}
 */
export function getSceneArchitectV1PromptPath() {
  return path.join(
    getPromptRootV6(),
    '1_5_SceneArchitect',
    '1_5_SceneArchitect-v1.md',
  );
}

/**
 * Prompter v6 系统提示词绝对路径。
 *
 * 对应 `prompt/1_SD2Workflow/2_SD2Prompter/2_SD2Prompter-v6.md`（delta 文档）；
 * v6 新增铁律（编号 12, 13, 17, 18, 19）：对白保真 / KVA 视觉化 / info 密度 /
 * 五段式完整性 / climax & closing_hook 签名。
 *
 * @returns {string}
 */
export function getPrompterSd2V6PromptPath() {
  return path.join(getPromptRootV6(), '2_SD2Prompter', '2_SD2Prompter-v6.md');
}

/**
 * 知识切片根目录（`injection_map.yaml` 所在目录）。
 *
 * v5 与 v6 共用同一目录；但 `injection_map.yaml` 已升级到 v2.1（新增
 * `has_kva` 条件键），由 `lib/knowledge_slices_v6.mjs` 负责解析。
 *
 * @returns {string}
 */
export function getKnowledgeSlicesRootPathV6() {
  return path.join(getPromptRootV6(), '4_KnowledgeSlices');
}

/**
 * 存在性断言：主 prompt 文件必须可读，否则抛错。
 *
 * 注意：只检查入参的单一文件，不做递归校验。
 *
 * @param {string} absPath
 */
export function assertV6PromptFileExists(absPath) {
  if (!fs.existsSync(absPath)) {
    throw new Error(`SD2 v6 系统提示词不存在: ${absPath}`);
  }
}
