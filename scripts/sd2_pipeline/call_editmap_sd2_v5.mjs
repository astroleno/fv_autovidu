#!/usr/bin/env node
/**
 * EditMap-SD2 v5：输出 `{ markdown_body, appendix }`（契约见 1_EditMap-SD2-v5.md
 * 与 docs/v5/07_v5-schema-冻结.md）。
 *
 * v5.0 GA 升级（编剧方法论静态挂载 · 2026-04-17）：
 *   - 在 system prompt 末尾**静态拼接** 6 份 editmap/ 编剧方法论切片（固定顺序，
 *     见 lib/editmap_slices_v5.mjs 的 EDITMAP_SLICE_ORDER 常量）。
 *   - 该机制**不走** `injection_map.yaml`；详细架构决策见
 *     `docs/v5/08_v5-编剧方法论切片.md` + `docs/v5/07_v5-schema-冻结.md §8.1`。
 *
 * Stage 0 附加输入（可选 · 2026-04-17）：
 *   - 支持 `--normalized-package <path>` 读取 `normalizedScriptPackage.json`，
 *     挂载到 user message 顶层 `__NORMALIZED_SCRIPT_PACKAGE__` 字段；
 *   - 未提供 / 读取失败 → 按原 v5 行为执行（向后兼容 · 00 计划 §九 失败兜底）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import {
  callLLM,
  getResolvedLlmBaseUrl,
  getResolvedLlmModel,
  parseJsonFromModelText,
} from './lib/llm_client.mjs';
import {
  annotateNormalizerRef,
  estimateTokens,
  loadEditMapSlices,
  loadNormalizedPackage,
  logEditMapSlicesSummary,
  mergeNormalizedPackageIntoPayload,
} from './lib/editmap_slices_v5.mjs';
import { normalizeEditMapSd2V5 } from './lib/normalize_edit_map_sd2_v5.mjs';
import { getEditMapSd2V5PromptPath } from './lib/sd2_prompt_paths_v5.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_TAG = 'call_editmap_sd2_v5';

/**
 * @param {string[]} argv
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

  const { text: slicesText, slices: sliceInfo } = loadEditMapSlices();
  const systemPrompt = `${basePrompt}\n${slicesText}`;
  logEditMapSlicesSummary(SCRIPT_TAG, sliceInfo, estimateTokens(basePrompt));

  const inputObj = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

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
    '请严格按系统提示输出唯一一个 JSON 对象（含 markdown_body 与 appendix），不要 Markdown 围栏。',
    '',
    JSON.stringify(userPayload, null, 2),
  ]
    .filter(Boolean)
    .join('\n');

  console.log(
    `[${SCRIPT_TAG}] 调用 LLM：model=${getResolvedLlmModel()} base=${getResolvedLlmBaseUrl()}`,
  );
  console.log(`[${SCRIPT_TAG}] 生成 EditMap-SD2 v5 …`);
  const raw = await callLLM({
    systemPrompt,
    userMessage,
    temperature: 0.25,
    jsonObject: true,
  });

  let parsed;
  try {
    parsed = parseJsonFromModelText(raw);
  } catch (e) {
    console.error(`[${SCRIPT_TAG}] JSON 解析失败，原始前 500 字：`);
    console.error(raw.slice(0, 500));
    throw e;
  }

  /**
   * v5.0-rev3 · Scheme B：normalize 不再接收 workflowControls。
   * 镜头预算推导链路：meta.target_shot_count（LLM 自填） > meta.parsed_brief（LLM 解析 brief） > meta.video（兜底）。
   */
  normalizeEditMapSd2V5(parsed);

  annotateNormalizerRef(parsed, normalizedPackage, normalizedPackagePath);

  // ── v5.0 HOTFIX · H1：maxBlock 校验 → **软门**（与 v6 一致：只 warn，仍落盘）──
  {
    const finalValidation = /** @type {Record<string, unknown>} */ (parsed)._validation;
    if (finalValidation && typeof finalValidation === 'object') {
      const fv = /** @type {{
        max_block_duration_check?: boolean,
        over_limit_blocks?: string[],
      }} */ (finalValidation);
      if (fv.max_block_duration_check === false) {
        const overList = Array.isArray(fv.over_limit_blocks) ? fv.over_limit_blocks : [];
        const overStr = overList.length ? overList.join(', ') : '未知';
        console.warn(
          `[${SCRIPT_TAG}] ⚠️ max_block_duration 软告警：${overStr} 超过单组建议上限（默认 16s）· 仍落盘`,
        );
        const app = parsed.appendix && typeof parsed.appendix === 'object'
          ? /** @type {Record<string, unknown>} */ (parsed.appendix)
          : null;
        const diag = app && app.diagnosis && typeof app.diagnosis === 'object'
          ? /** @type {Record<string, unknown>} */ (app.diagnosis)
          : null;
        if (diag) {
          const entry = `max_block_duration_soft: ${overStr}`;
          const w = diag.warning_msg;
          if (Array.isArray(w)) {
            w.push(entry);
          } else if (typeof w === 'string' && w.trim()) {
            diag.warning_msg = [w, entry];
          } else {
            diag.warning_msg = [entry];
          }
        }
      }
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`[${SCRIPT_TAG}] 已写入 ${outPath}`);
}

const _e = process.argv[1];
if (_e && pathToFileURL(path.resolve(_e)).href === import.meta.url) {
  main().catch((err) => {
    console.error(`[${SCRIPT_TAG}]`, err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
