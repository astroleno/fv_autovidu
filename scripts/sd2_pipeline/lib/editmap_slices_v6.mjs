/**
 * EditMap v6.0 · editmap/ 编剧方法论切片静态挂载公共模块。
 *
 * 与 v5 的核心差异：
 *   - **切片列表追加一份**：v5 的 6 份方法论切片基础上，**末尾追加**
 *     `v6_rhythm_templates.md`（节奏模板库），为 v6 EditMap 在推断
 *     `meta.rhythm_timeline` 时提供 5 种题材的节奏档位、golden_open_3s /
 *     mini_climaxes / major_climax / closing_hook 的 slot 公式，以及
 *     major_climax.strategy 与 KVA.action_type 的映射表。
 *   - **拼接顺序保持稳定**：v6_rhythm_templates 放在最后，与前 6 份方法论切片
 *     互不干扰（前者讲「事件/信号/信息差」，后者讲「节奏骨架与爆点密度」）。
 *   - **共用 Stage 0 兜底**：`loadNormalizedPackage` / `trimNormalizedPackageForEditMap`
 *     / `mergeNormalizedPackageIntoPayload` / `annotateNormalizerRef` 直接从
 *     `editmap_slices_v5` 复用（v6 对 Stage 0 兜底规则无调整），不重复实现。
 *
 * 架构决策（与 v5 一致，不可动）：
 *   - EditMap 是下游 Director / Prompter 的路由器；路由器本身不能被自己路由，
 *     所以它的方法论依赖**不进** `injection_map.yaml`，由本模块在请求前**静态拼接**
 *     到 system prompt 末尾。
 *   - 详细决策见：
 *       `prompt/1_SD2Workflow/docs/v6/06_v6-节奏推导与爆点密度.md`
 *       `prompt/1_SD2Workflow/docs/v5/08_v5-编剧方法论切片.md`
 *
 * 使用约束：
 *   - 拼接顺序**不得**乱（见 `EDITMAP_V6_SLICE_ORDER` 注释）。
 *   - 缺文件时必须抛错 —— v6 的硬依赖，不允许悄悄退化到 v5 行为。
 *   - token 超硬限只记 warning，不阻塞；最终由 CI 门禁拦截（与 v5 同）。
 */
import fs from 'fs';
import path from 'path';

import { getKnowledgeSlicesRootPathV6 } from './sd2_prompt_paths_v6.mjs';
import {
  annotateNormalizerRef as annotateNormalizerRefV5,
  estimateTokens as estimateTokensV5,
  loadNormalizedPackage as loadNormalizedPackageV5,
  mergeNormalizedPackageIntoPayload as mergeNormalizedPackageIntoPayloadV5,
} from './editmap_slices_v5.mjs';

/**
 * editmap/ 切片的**固定拼接顺序**（v6 · 新增末尾 1 份）。
 *
 * 为什么顺序重要：
 *   - 前 6 份是「事件 / 欲望 / 信号 / 钩子 / 双轨 / 举证」方法论，由 v5 GA 建立；
 *   - 最后一份 v6_rhythm_templates 是「节奏骨架与爆点密度」，消费前面的概念
 *     （例如用 dramatic_action 的三问校验 mini_climaxes 的五段式是否有效）。
 *   - 反过来不会引用：v6_rhythm_templates 不会在前 6 份切片里被提及。
 *
 * 顺序硬约束（不得乱）：
 *   1. dramatic_action.md
 *   2. character_want_need.md
 *   3. subtext_and_signals.md
 *   4. hook_strategies.md
 *   5. two_track_pacing.md
 *   6. proof_and_info_gap.md
 *   7. v6_rhythm_templates.md  ← v6 新增
 */
export const EDITMAP_V6_SLICE_ORDER = Object.freeze([
  'dramatic_action.md',
  'character_want_need.md',
  'subtext_and_signals.md',
  'hook_strategies.md',
  'two_track_pacing.md',
  'proof_and_info_gap.md',
  'v6_rhythm_templates.md',
]);

/**
 * editmap/ 切片整体 token 硬限（v6 · 略高于 v5 的 12_000）。
 *
 * v6_rhythm_templates 按 v6-schema 估约 2500 tokens；加上前 6 份约 9000-11000，
 * 故把硬限提到 14_000，留出安全余量。超过只打 warning，不阻塞。
 */
export const EDITMAP_V6_SLICES_TOKEN_HARD_LIMIT = 14_000;

/**
 * 切片元信息（与 v5 同结构，保持审计字段一致，方便对比）。
 *
 * @typedef {Object} SliceInfo
 * @property {string} name   切片文件名（含 .md）
 * @property {number} chars  切片正文字符数
 * @property {number} tokens 估算 tokens（仅日志用）
 */

/** @returns {number} */
export function estimateTokens(text) {
  return estimateTokensV5(text);
}

/**
 * 加载并拼接 editmap/ 7 份切片为单一字符串，供 system prompt 追加。
 *
 * 返回值：
 *   - text：可直接追加到 base prompt 末尾的完整拼接文本（含分隔头）
 *   - slices：每份切片的元信息数组（供日志 / QA）
 *
 * 错误策略：任何切片缺失都抛错 —— v6 硬依赖。
 *
 * @returns {{ text: string, slices: SliceInfo[] }}
 */
export function loadEditMapSlicesV6() {
  const editmapDir = path.join(getKnowledgeSlicesRootPathV6(), 'editmap');
  if (!fs.existsSync(editmapDir)) {
    throw new Error(
      `editmap/ 切片目录不存在: ${editmapDir}\n` +
        '请从 feeling_video_prompt 仓库同步 4_KnowledgeSlices/editmap/ 七份切片' +
        '（v5 六份方法论 + v6_rhythm_templates.md）。',
    );
  }

  /** @type {SliceInfo[]} */
  const sliceInfo = [];
  /** @type {string[]} */
  const bodies = [];
  bodies.push('', '---', '', '## 【编剧方法论知识库 · v6 静态挂载】', '');
  bodies.push(
    '以下 7 份切片为 EditMap v6 的方法论认知框架，由 call_editmap_sd2_v6.mjs',
    '（以及 Yunwu 版 · 若启用）按固定顺序静态拼接进 system prompt，**不走** injection_map 路由。',
    '',
    '拼接次序（不可变）：',
    '  1-6. 事件 / 欲望 / 信号 / 钩子 / 双轨 / 举证（v5 GA 建立，方法论认知层）',
    '  7.   v6_rhythm_templates（v6 新增，节奏骨架与爆点密度档位库）',
    '',
    '你在做 block 切分、status_curve、routing 标签判断、**以及**',
    '`meta.rhythm_timeline` / `meta.style_inference` 推断时，必须以这些方法论为准；',
    '但它们是"方法论"而非"事实"——任何判断仍以 scriptContent 原文为最终依据。',
    '',
  );

  for (const fileName of EDITMAP_V6_SLICE_ORDER) {
    const filePath = path.join(editmapDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `editmap/ 切片缺失: ${filePath}\n` +
          `（v6 固定顺序: ${EDITMAP_V6_SLICE_ORDER.join(' → ')}）`,
      );
    }
    const body = fs.readFileSync(filePath, 'utf8');
    bodies.push(`### 切片 · ${fileName.replace(/\.md$/, '')}`, '', body, '');
    sliceInfo.push({
      name: fileName,
      chars: body.length,
      tokens: estimateTokensV5(body),
    });
  }

  return { text: bodies.join('\n'), slices: sliceInfo };
}

/**
 * 读取 Stage 0 `normalizedScriptPackage.json`；失败时返回 null。
 *
 * v6 完全复用 v5 的兜底策略：Stage 0 调用失败时 pipeline 应静默跳过附加输入，
 * EditMap 按原 v6 行为执行（除非显式 opt-in 阻断，见 run_sd2_pipeline `SD2_NORMALIZER_FALLBACK`）。
 *
 * @param {string} absPath
 * @returns {unknown | null}
 */
export function loadNormalizedPackage(absPath) {
  return loadNormalizedPackageV5(absPath);
}

/**
 * 把 Stage 0 产物挂到 user payload 顶层 `__NORMALIZED_SCRIPT_PACKAGE__` 字段。
 *
 * v6 直接复用 v5 的 trim + 挂载逻辑。**不做** v6 专属裁剪（v6 Normalizer 新增字段
 * KVA / structure_hints / dialogue_char_count 对 EditMap 有增量价值，不能在此裁掉）。
 *
 * @param {unknown} inputObj
 * @param {unknown | null} normalizedPackage
 * @returns {unknown}
 */
export function mergeNormalizedPackageIntoPayload(inputObj, normalizedPackage) {
  return mergeNormalizedPackageIntoPayloadV5(inputObj, normalizedPackage);
}

/**
 * 在 EditMap 产物的 `appendix.meta.normalizer_ref` 登记 Stage 0 追溯信息。
 *
 * v6 复用 v5 的实现（软字段；缺失不影响下游）。
 *
 * @param {unknown} parsed
 * @param {unknown | null} normalizedPackage
 * @param {string} sourcePath
 */
export function annotateNormalizerRef(parsed, normalizedPackage, sourcePath) {
  annotateNormalizerRefV5(parsed, normalizedPackage, sourcePath);
}

/**
 * 按统一格式打印 editmap/ v6 切片拼接日志。
 *
 * @param {string} scriptTag  日志前缀（如 `call_editmap_sd2_v6`）
 * @param {SliceInfo[]} slices
 * @param {number} baseTokens  基础 prompt 的 token 估算
 */
export function logEditMapSlicesSummaryV6(scriptTag, slices, baseTokens) {
  const totalSliceTokens = slices.reduce((sum, s) => sum + s.tokens, 0);
  console.log(
    `[${scriptTag}] editmap/ v6 静态挂载 · ${slices.length} 切片 · 合计 ${totalSliceTokens} tokens（硬限 ${EDITMAP_V6_SLICES_TOKEN_HARD_LIMIT}）`,
  );
  for (const s of slices) {
    console.log(`  · ${s.name}  ${s.chars} chars  ≈ ${s.tokens} tokens`);
  }
  if (totalSliceTokens > EDITMAP_V6_SLICES_TOKEN_HARD_LIMIT) {
    console.warn(
      `[${scriptTag}] 警告：editmap/ 切片合计 tokens (${totalSliceTokens}) 超过硬限 ${EDITMAP_V6_SLICES_TOKEN_HARD_LIMIT}，请按 v6 §6 瘦身 rhythm_templates 或精简前置方法论。`,
    );
  }
  console.log(
    `[${scriptTag}] system prompt 合计 ≈ ${baseTokens + totalSliceTokens} tokens（基础 ${baseTokens} + editmap/ ${totalSliceTokens}）`,
  );
}
