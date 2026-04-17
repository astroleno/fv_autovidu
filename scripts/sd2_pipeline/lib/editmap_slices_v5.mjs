/**
 * EditMap v5.0 GA · editmap/ 编剧方法论切片静态挂载公共模块。
 *
 * 架构决策（不可动）：
 *   - EditMap 是下游 Director / Prompter 的**路由器**；路由器本身不能被自己路由，
 *     所以它的方法论依赖（dramatic_action / character_want_need / subtext_and_signals
 *     / hook_strategies / two_track_pacing / proof_and_info_gap 六份切片）**不进**
 *     `injection_map.yaml`，改由 DashScope 版与 Yunwu 版 EditMap 调用器
 *     （call_editmap_sd2_v5.mjs / call_yunwu_editmap_sd2_v5.mjs）统一调用本模块，
 *     在 LLM 请求前把切片**静态拼接**到 system prompt 末尾。
 *   - 详细决策见 `prompt/1_SD2Workflow/docs/v5/08_v5-编剧方法论切片.md`
 *     与 `docs/v5/07_v5-schema-冻结.md §8.1`。
 *
 * Stage 0（ScriptNormalizer）附加输入：
 *   - Stage 0 与 editmap/ 切片**严格正交**（00 计划 §5.4）：
 *     前者给"事实数据"（进 user message），后者给"方法论"（进 system message），
 *     各走各的通道，永不交叉。本模块仅负责方法论通道。
 *
 * 使用约束：
 *   - 拼接顺序**不得**乱（见 EDITMAP_SLICE_ORDER 常量注释）。
 *   - 缺文件时必须抛错——v5 GA 的硬依赖，不允许"悄悄退化"到 v4 行为。
 *   - token 超硬限只记 warning，不阻塞；最终由 CI 门禁拦截（06 §E1）。
 */
import fs from 'fs';
import path from 'path';

import { getKnowledgeSlicesRootPath } from './sd2_prompt_paths_v5.mjs';

/**
 * editmap/ 切片的**固定拼接顺序**（08 §3.1 硬约束）。
 *
 * 为什么顺序重要：后一份切片的判定规则可能引用前一份建立的概念。
 * 例如 hook_strategies 要用到 dramatic_action 的「戏剧动作合格三问」，
 * proof_and_info_gap 要用到 subtext_and_signals 的「信号提取」。
 * 任何实现**不得**乱序。
 */
export const EDITMAP_SLICE_ORDER = Object.freeze([
  'dramatic_action.md',
  'character_want_need.md',
  'subtext_and_signals.md',
  'hook_strategies.md',
  'two_track_pacing.md',
  'proof_and_info_gap.md',
]);

/**
 * editmap/ 切片整体 token 硬限（08 §3.2）。
 *
 * 只作警告阈值，由独立 CI 工具（非本模块）做阻塞式拦截。
 */
export const EDITMAP_SLICES_TOKEN_HARD_LIMIT = 12_000;

/**
 * 粗略 token 估算系数：中英文混合 · 经验值。
 *
 * 精确计量由独立 CI 工具处理（tokenizer 对齐 LLM 真实值）；
 * 本模块只用于 pipeline 日志，不做产物字段。
 */
const TOKENS_PER_CHAR = 1 / 1.6;

/**
 * 估算给定文本的 token 数。
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

/**
 * 切片元信息。
 *
 * @typedef {Object} SliceInfo
 * @property {string} name   切片文件名（含 .md）
 * @property {number} chars  切片正文字符数
 * @property {number} tokens 估算 tokens（仅日志用）
 */

/**
 * 加载并拼接 editmap/ 6 份切片为单一字符串，供 system prompt 追加。
 *
 * 返回值：
 *   - text：可直接追加到 base prompt 末尾的完整拼接文本（含分隔头）
 *   - slices：每份切片的元信息数组（供日志 / QA）
 *
 * 错误策略：任何切片缺失都抛错——v5 GA 硬依赖。
 *
 * @returns {{ text: string, slices: SliceInfo[] }}
 */
export function loadEditMapSlices() {
  const editmapDir = path.join(getKnowledgeSlicesRootPath(), 'editmap');
  if (!fs.existsSync(editmapDir)) {
    throw new Error(
      `editmap/ 切片目录不存在: ${editmapDir}\n` +
        '请从 feeling_video_prompt 仓库同步 4_KnowledgeSlices/editmap/ 六份切片' +
        '（见 docs/v5/08_v5-编剧方法论切片.md）。',
    );
  }

  /** @type {SliceInfo[]} */
  const sliceInfo = [];
  /** @type {string[]} */
  const bodies = [];
  bodies.push('', '---', '', '## 【编剧方法论知识库 · 静态挂载】', '');
  bodies.push(
    '以下 6 份切片为 EditMap 的编剧方法论认知框架，由 call_editmap_sd2_v5.mjs',
    '（以及 Yunwu 版）按固定顺序静态拼接进 system prompt，**不走** injection_map 路由。',
    '你在做 block 切分、status_curve、routing 标签判断时必须以这些方法论为准；',
    '但它们是"方法论"而非"事实"——任何判断仍以 scriptContent 原文为最终依据。',
    '',
  );

  for (const fileName of EDITMAP_SLICE_ORDER) {
    const filePath = path.join(editmapDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `editmap/ 切片缺失: ${filePath}\n` +
          `（08 计划固定顺序: ${EDITMAP_SLICE_ORDER.join(' → ')}）`,
      );
    }
    const body = fs.readFileSync(filePath, 'utf8');
    bodies.push(`### 切片 · ${fileName.replace(/\.md$/, '')}`, '', body, '');
    sliceInfo.push({
      name: fileName,
      chars: body.length,
      tokens: estimateTokens(body),
    });
  }

  return { text: bodies.join('\n'), slices: sliceInfo };
}

/**
 * 读取 Stage 0 `normalizedScriptPackage.json`；失败时返回 null（不抛错 · Phase 1 兜底）。
 *
 * 为什么失败不抛错：00 计划 §九 明确规定 Stage 0 调用失败时 pipeline 应**静默跳过**
 * Stage 0 附加输入，让 EditMap 按原 v5 行为执行。本函数对应 pipeline 层的兜底点。
 *
 * @param {string} absPath 绝对路径
 * @returns {unknown | null}
 */
export function loadNormalizedPackage(absPath) {
  if (!absPath || !fs.existsSync(absPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[editmap_slices_v5] 读取 normalizedScriptPackage 失败（Phase 1 兜底跳过）: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * 把 Stage 0 产物挂到 user payload 顶层 `__NORMALIZED_SCRIPT_PACKAGE__` 字段。
 *
 * 选择顶层下划线大写字段名的原因：
 *   1. 不与 `scriptContent / assetManifest / episodeDuration` 等正式输入字段冲突；
 *   2. 明显"元数据/外部挂载"的视觉信号，避免 EditMap 把它当作剧本正文的一部分；
 *   3. 双下划线前后缀让它不会被脑补为 Schema 硬字段。
 *
 * @param {unknown} inputObj            原始 edit_map_input
 * @param {unknown | null} normalizedPackage Stage 0 产物
 * @returns {unknown}                   合并后的 payload
 */
export function mergeNormalizedPackageIntoPayload(inputObj, normalizedPackage) {
  if (!normalizedPackage) {
    return inputObj;
  }
  if (inputObj && typeof inputObj === 'object' && !Array.isArray(inputObj)) {
    return { ...inputObj, __NORMALIZED_SCRIPT_PACKAGE__: normalizedPackage };
  }
  return { __INPUT__: inputObj, __NORMALIZED_SCRIPT_PACKAGE__: normalizedPackage };
}

/**
 * 在 EditMap 产物的 `appendix.meta.normalizer_ref` 登记 Stage 0 追溯信息。
 *
 * 软字段（07 schema 无此硬字段），仅用于回归审计；缺失不影响下游。
 *
 * @param {unknown} parsed              归一化后的 EditMap 输出
 * @param {unknown | null} normalizedPackage Stage 0 产物（null 时 no-op）
 * @param {string} sourcePath           Stage 0 产物磁盘路径
 * @returns {void}
 */
export function annotateNormalizerRef(parsed, normalizedPackage, sourcePath) {
  if (!normalizedPackage || typeof normalizedPackage !== 'object') {
    return;
  }
  if (!parsed || typeof parsed !== 'object') {
    return;
  }
  const appendix = /** @type {Record<string, unknown>} */ (parsed).appendix;
  if (!appendix || typeof appendix !== 'object') {
    return;
  }
  const meta = /** @type {Record<string, unknown>} */ (appendix).meta;
  if (!meta || typeof meta !== 'object') {
    return;
  }
  const pkg = /** @type {Record<string, unknown>} */ (normalizedPackage);
  const packageId = typeof pkg.package_id === 'string' ? pkg.package_id : '';
  /** @type {Record<string, unknown>} */ (meta).normalizer_ref = {
    package_id: packageId,
    source_path: sourcePath,
  };
}

/**
 * 按统一格式打印 editmap/ 切片拼接日志。
 *
 * @param {string} scriptTag          日志前缀（如 call_editmap_sd2_v5）
 * @param {SliceInfo[]} slices
 * @param {number} baseTokens         基础 prompt 的 token 估算
 * @returns {void}
 */
export function logEditMapSlicesSummary(scriptTag, slices, baseTokens) {
  const totalSliceTokens = slices.reduce((sum, s) => sum + s.tokens, 0);
  console.log(
    `[${scriptTag}] editmap/ 静态挂载 · ${slices.length} 切片 · 合计 ${totalSliceTokens} tokens（硬限 ${EDITMAP_SLICES_TOKEN_HARD_LIMIT}）`,
  );
  for (const s of slices) {
    console.log(`  · ${s.name}  ${s.chars} chars  ≈ ${s.tokens} tokens`);
  }
  if (totalSliceTokens > EDITMAP_SLICES_TOKEN_HARD_LIMIT) {
    console.warn(
      `[${scriptTag}] 警告：editmap/ 切片合计 tokens (${totalSliceTokens}) 超过硬限 ${EDITMAP_SLICES_TOKEN_HARD_LIMIT}，请按 docs/v5/08 §3.2 瘦身。`,
    );
  }
  console.log(
    `[${scriptTag}] system prompt 合计 ≈ ${baseTokens + totalSliceTokens} tokens（基础 ${baseTokens} + editmap/ ${totalSliceTokens}）`,
  );
}
