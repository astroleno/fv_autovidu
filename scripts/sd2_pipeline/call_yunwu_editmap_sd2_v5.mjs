#!/usr/bin/env node
/**
 * 使用云雾（Yunwu）OpenAI 兼容接口调用 `1_EditMap-SD2-v5.md`，生成 `edit_map_sd2.json`。
 *
 * 与 v4 相同的 retry 容错（finish_reason=length 自动调大 max_tokens，一次性自检 retry），
 * 只把系统提示词 / 归一化 / 版本号换成 v5。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import {
  annotateNormalizerRef,
  estimateTokens,
  loadEditMapSlices,
  loadNormalizedPackage,
  logEditMapSlicesSummary,
  mergeNormalizedPackageIntoPayload,
} from './lib/editmap_slices_v5.mjs';
import { parseJsonFromModelText } from './lib/llm_client.mjs';
import {
  callYunwuChatCompletions,
  getYunwuResolvedDefaults,
} from './lib/yunwu_chat.mjs';
import { normalizeEditMapSd2V5 } from './lib/normalize_edit_map_sd2_v5.mjs';
import { getEditMapSd2V5PromptPath } from './lib/sd2_prompt_paths_v5.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_TAG = 'call_yunwu_editmap_sd2_v5';

/**
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      continue;
    }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath =
    typeof args.input === 'string' ? path.resolve(process.cwd(), args.input) : '';
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('请指定有效 --input edit_map_input.json');
    process.exit(2);
  }

  const outPath =
    typeof args.output === 'string'
      ? path.resolve(process.cwd(), args.output)
      : path.join(path.dirname(inputPath), 'edit_map_sd2.json');

  const promptPath =
    typeof args['prompt-file'] === 'string'
      ? path.resolve(process.cwd(), args['prompt-file'])
      : getEditMapSd2V5PromptPath();

  const basePrompt = fs.readFileSync(promptPath, 'utf8');

  /**
   * v5.0 GA：editmap/ 方法论切片静态拼接（与 DashScope 版共用 lib/editmap_slices_v5.mjs）。
   * 切片缺失时会抛错；这是 v5 硬依赖，不允许静默退化。
   */
  const { text: slicesText, slices: sliceInfo } = loadEditMapSlices();
  const systemPrompt = `${basePrompt}\n${slicesText}`;
  logEditMapSlicesSummary(SCRIPT_TAG, sliceInfo, estimateTokens(basePrompt));

  const inputObj = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  /**
   * v5.0 HOTFIX：取 edit_map_input.json 的 workflowControls，用来驱动 normalize 派生镜头预算。
   */
  const normalizeOpts = {
    workflowControls:
      inputObj && typeof inputObj === 'object' && inputObj.workflowControls && typeof inputObj.workflowControls === 'object'
        ? inputObj.workflowControls
        : undefined,
  };

  /**
   * Stage 0 附加输入（可选 · 00 计划 §五 Phase 1）。
   * 未提供 / 读取失败 → 保持原 v5 行为（向后兼容）。
   */
  const normalizedPackagePath =
    typeof args['normalized-package'] === 'string'
      ? path.resolve(process.cwd(), args['normalized-package'])
      : '';
  const normalizedPackage = normalizedPackagePath
    ? loadNormalizedPackage(normalizedPackagePath)
    : null;
  if (normalizedPackage) {
    console.log(
      `[${SCRIPT_TAG}] 已挂载 Stage 0 产物: ${normalizedPackagePath}（按 §0.X 冲突仲裁：原文为准）`,
    );
  } else if (normalizedPackagePath) {
    console.log(
      `[${SCRIPT_TAG}] Stage 0 产物不存在或读取失败，按原 v5 行为执行: ${normalizedPackagePath}`,
    );
  }

  const userPayload = mergeNormalizedPackageIntoPayload(inputObj, normalizedPackage);

  const userMessage = [
    '以下为 globalSynopsis、scriptContent、assetManifest、episodeDuration、referenceAssets 等输入。',
    normalizedPackage
      ? '另附 __NORMALIZED_SCRIPT_PACKAGE__ 字段，为 Stage 0 · ScriptNormalizer 的事实归一化产物（仅作参考，冲突以原文为准）。'
      : '',
    '请严格按系统提示中的 Schema 输出唯一一个 JSON 对象，不要 Markdown 围栏。',
    '',
    JSON.stringify(userPayload, null, 2),
  ]
    .filter(Boolean)
    .join('\n');

  const defaults = getYunwuResolvedDefaults();
  const modelOverride = typeof args.model === 'string' ? args.model : undefined;
  const noThinking = args['no-thinking'] === true;

  console.log(
    `[call_yunwu_editmap_sd2_v5] 云雾 LLM：model=${modelOverride || defaults.model} base=${defaults.baseUrl} thinking=${!noThinking}`,
  );
  console.log('[call_yunwu_editmap_sd2_v5] 生成 EditMap-SD2 v5 …');

  const editMapMaxTokens = Math.max(
    32768,
    parseInt(process.env.YUNWU_EDITMAP_MAX_TOKENS || '200000', 10),
  );
  console.log(
    `[call_yunwu_editmap_sd2_v5] max_tokens=${editMapMaxTokens}（YUNWU_EDITMAP_MAX_TOKENS）`,
  );

  const chatOpts = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    model: modelOverride,
    temperature: 0.25,
    jsonObject: true,
    enableThinking: !noThinking,
    maxTokens: editMapMaxTokens,
  };

  let raw = '';
  try {
    raw = await callYunwuChatCompletions(chatOpts);
  } catch (firstErr) {
    const fr = /** @type {Error & { finishReason?: string }} */ (firstErr);
    if (fr.finishReason === 'length') {
      const cap = Math.max(
        editMapMaxTokens,
        parseInt(process.env.YUNWU_EDITMAP_MAX_RETRY_CAP || '262144', 10),
      );
      const bumped = Math.min(Math.floor(editMapMaxTokens * 1.5), cap);
      if (bumped > editMapMaxTokens) {
        console.warn(
          `[call_yunwu_editmap_sd2_v5] finish_reason=length，保持 thinking，max_tokens ${editMapMaxTokens}→${bumped} 重试一次…`,
        );
        raw = await callYunwuChatCompletions({ ...chatOpts, maxTokens: bumped });
      } else {
        throw firstErr;
      }
    } else {
      throw firstErr;
    }
  }

  let parsed;
  try {
    parsed = parseJsonFromModelText(raw);
  } catch (e) {
    console.error('[call_yunwu_editmap_sd2_v5] JSON 解析失败，原始前 800 字：');
    console.error(raw.slice(0, 800));
    throw e;
  }

  normalizeEditMapSd2V5(parsed, normalizeOpts);

  const blocks = /** @type {{ blocks?: unknown }} */ (parsed).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error(
      'EditMap v5 归一化后 blocks[] 为空：请检查云雾输出是否截断，或调大 YUNWU_EDITMAP_MAX_TOKENS。',
    );
  }

  // ── 自检：block_index 完整性 + 时长守恒（与 v4 共用同名字段）──
  const validation = /** @type {Record<string, unknown>} */ (parsed)._validation;
  if (validation && typeof validation === 'object') {
    const v = /** @type {{
      duration_sum_check?: boolean,
      skeleton_integrity_check?: boolean,
      max_block_duration_check?: boolean,
      over_limit_blocks?: string[],
      block_count?: number,
      paragraph_count?: number,
      actual_duration_sum?: number,
      target_duration?: number,
    }} */ (validation);

    const needsRetry =
      v.duration_sum_check === false ||
      v.skeleton_integrity_check === false ||
      v.max_block_duration_check === false;

    if (needsRetry) {
      const reasons = [];
      if (v.skeleton_integrity_check === false) {
        reasons.push(
          `block_index 仅 ${v.block_count} 条，但 markdown 有 ${v.paragraph_count} 段（JSON 截断）`,
        );
      }
      if (v.duration_sum_check === false) {
        reasons.push(
          `时长不一致：sum(blocks)=${v.actual_duration_sum}s ≠ target=${v.target_duration}s`,
        );
      }
      if (v.max_block_duration_check === false) {
        const overList = Array.isArray(v.over_limit_blocks) ? v.over_limit_blocks.join(', ') : '未知';
        reasons.push(`单组超时：${overList} 超过 15s 硬上限，必须在 Step 0 预推理阶段拆分为 2-3 个更小 beat`);
      }
      console.warn(
        `[call_yunwu_editmap_sd2_v5] 自检未通过：${reasons.join('；')}，尝试带修正提示 retry …`,
      );

      const retryHint = [
        '上一次输出违反了提示词 Section 0 的"时长拆分预推理"铁律，存在以下问题：',
        ...reasons.map((r, i) => `${i + 1}. ${r}`),
        '',
        '【强制修正流程】请严格回到 Step 0 从头预推理，不要在已有结果上做微调：',
        '1. Step 0.1: 重新通读剧本，标注所有叙事 beat',
        '2. Step 0.2: 对每个 beat 做"对白字数估算 + 动作反应估算" → 原始时长',
        '3. Step 0.3: **任何原始时长 > 15s 的 beat 立即拆分**',
        '4. Step 0.4: 确认所有 beat 均满足 4s ≤ duration ≤ 15s，且 sum == episodeDuration',
        '',
        '【硬约束清单】产出必须同时满足：',
        '- 所有 block.duration ∈ [4, 15]',
        '- block_index 条目数 == markdown_body 段落数',
        '- sum(block_index[].duration) == target_duration_sec',
        '- 每个 block_index 条目 routing 六字段齐全（v5 硬门 routing_schema_valid）',
        '',
        '请重新输出完整的 { "markdown_body": "...", "appendix": {...} } JSON。',
      ].join('\n');

      let retryRaw = '';
      try {
        retryRaw = await callYunwuChatCompletions({
          ...chatOpts,
          messages: [
            ...chatOpts.messages,
            { role: 'assistant', content: raw },
            { role: 'user', content: retryHint },
          ],
        });
      } catch (retryErr) {
        console.warn(
          '[call_yunwu_editmap_sd2_v5] retry 请求失败，使用首次结果。',
          retryErr instanceof Error ? retryErr.message : retryErr,
        );
      }

      if (retryRaw) {
        try {
          const retryParsed = parseJsonFromModelText(retryRaw);
          normalizeEditMapSd2V5(retryParsed, normalizeOpts);
          const retryBlocks = /** @type {{ blocks?: unknown }} */ (retryParsed).blocks;
          const retryV = /** @type {{ _validation?: Record<string, unknown> }} */ (retryParsed)._validation;

          const retrySkeletonOk = !retryV || retryV.skeleton_integrity_check !== false;
          const retryDurationOk = !retryV || retryV.duration_sum_check !== false;
          const retryMaxBlockOk = !retryV || retryV.max_block_duration_check !== false;
          const retryBlockCount = Array.isArray(retryBlocks) ? retryBlocks.length : 0;

          const firstDurationGap = Math.abs((v.actual_duration_sum ?? 0) - (v.target_duration ?? 0));
          const retryDurationSum =
            retryV && typeof retryV.actual_duration_sum === 'number' ? retryV.actual_duration_sum : 0;
          const retryTarget =
            retryV && typeof retryV.target_duration === 'number' ? retryV.target_duration : (v.target_duration ?? 0);
          const retryDurationGap = Math.abs(retryDurationSum - retryTarget);

          const firstMaxBlockOk = v.max_block_duration_check !== false;

          const fullPass = retrySkeletonOk && retryDurationOk && retryMaxBlockOk && retryBlockCount > 0;
          const partialImprove =
            retryMaxBlockOk &&
            retrySkeletonOk &&
            retryBlockCount >= blocks.length &&
            retryDurationGap < firstDurationGap;
          const maxBlockRegression = firstMaxBlockOk && !retryMaxBlockOk;

          if (fullPass) {
            console.log(
              `[call_yunwu_editmap_sd2_v5] retry 完全通过：blocks ${blocks.length} → ${retryBlockCount}，duration=${retryDurationSum}s`,
            );
            parsed = retryParsed;
          } else if (partialImprove) {
            console.log(
              `[call_yunwu_editmap_sd2_v5] retry 部分改善（duration gap ${firstDurationGap}→${retryDurationGap}，maxBlock 通过），接受 retry 结果`,
            );
            parsed = retryParsed;
          } else if (maxBlockRegression) {
            console.warn(
              `[call_yunwu_editmap_sd2_v5] retry 破坏了 maxBlock 约束（首次 OK → retry FAIL），保留首次结果`,
            );
          } else if (!retryMaxBlockOk) {
            const overList = retryV && Array.isArray(retryV.over_limit_blocks) ? retryV.over_limit_blocks.join(', ') : '未知';
            console.warn(
              `[call_yunwu_editmap_sd2_v5] retry 仍违反 maxBlock 硬约束（${overList} > 15s），拒绝接受。`,
            );
          } else {
            console.warn(
              `[call_yunwu_editmap_sd2_v5] retry 未改善（blocks=${retryBlockCount}，durationGap=${retryDurationGap}），保留首次结果`,
            );
          }
        } catch (parseErr) {
          const jsonMatch = retryRaw.match(/\{[\s\S]*"markdown_body"[\s\S]*"appendix"[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const extracted = parseJsonFromModelText(jsonMatch[0]);
              normalizeEditMapSd2V5(extracted, normalizeOpts);
              const exBlocks = /** @type {{ blocks?: unknown }} */ (extracted).blocks;
              if (Array.isArray(exBlocks) && exBlocks.length >= blocks.length) {
                console.log(
                  `[call_yunwu_editmap_sd2_v5] retry JSON 提取修复成功：blocks=${exBlocks.length}`,
                );
                parsed = extracted;
              } else {
                console.warn('[call_yunwu_editmap_sd2_v5] retry JSON 提取后 blocks 不足，保留首次结果');
              }
            } catch {
              console.warn('[call_yunwu_editmap_sd2_v5] retry JSON 提取+修复均失败，保留首次结果');
            }
          } else {
            console.warn(
              '[call_yunwu_editmap_sd2_v5] retry JSON 解析失败，无法提取有效 JSON，保留首次结果',
              parseErr instanceof Error ? parseErr.message : parseErr,
            );
          }
        }
      }
    }
  }

  annotateNormalizerRef(parsed, normalizedPackage, normalizedPackagePath);

  // ── v5.0 HOTFIX · H1：maxBlock 硬门最终校验 ──
  //   位置：retry 流程之后、写盘之前。
  //   为什么加：retry 链路里只做了 console.warn 保留首次结果，导致
  //   B08 这类 20s 超时的产物仍会被写盘 + 进入下游 Director/Prompter，
  //   最终在交付物里留下不符合 SD2 引擎硬上限的 block。
  //   统一行为：只要最终产物 max_block_duration_check=false，拒绝写盘并非零 exit。
  //   如何补救：上游 run_sd2_pipeline.mjs 捕获非零 exit 后应让用户回到 Stage 0
  //             重新生成（或调整 episodeShotCount / targetBlockCount 参数），
  //             而不是自动降级。
  {
    const finalValidation = /** @type {Record<string, unknown>} */ (parsed)._validation;
    if (finalValidation && typeof finalValidation === 'object') {
      const fv = /** @type {{
        max_block_duration_check?: boolean,
        over_limit_blocks?: string[],
      }} */ (finalValidation);
      if (fv.max_block_duration_check === false) {
        const overList = Array.isArray(fv.over_limit_blocks) ? fv.over_limit_blocks.join(', ') : '未知';
        console.error(
          `[${SCRIPT_TAG}] ❌ 硬门失败：max_block_duration_check=false（${overList} 超过 15s 硬上限）。` +
            `retry 仍未改善，拒绝写盘。请调整 episodeShotCount/targetBlockCount 或修剧本后重试。`,
        );
        process.exit(7);
      }
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`[${SCRIPT_TAG}] 已写入 ${outPath}`);
}

const entry = process.argv[1];
if (entry && pathToFileURL(path.resolve(entry)).href === import.meta.url) {
  main().catch((err) => {
    console.error(
      '[call_yunwu_editmap_sd2_v5]',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
