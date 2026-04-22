#!/usr/bin/env node
/**
 * SD2 v6 · Stage 2（Director）+ Stage 3（Prompter）块链调度 —— **豆包（火山 Ark）** 后端入口。
 *
 * ## 与 `call_sd2_block_chain_v6.mjs` 的关系
 *
 * - 调度逻辑、v6 硬门、块间并发（fan-out）完全一致，仍由 `export async function main()` 承担。
 * - 差别仅在于 LLM HTTP：本入口在动态 import 之前调用 `applyArkEnvForSd2Pipeline()`，
 *   把 `ARK_*` 映射到 `SD2_LLM_*`，从而 `lib/llm_client.mjs` 的 `callLLM()` 走 Ark
 *   `POST /api/v3/chat/completions`。
 *
 * ## 并发语义（v6 后两段）
 *
 * - **块内**：同一 `block_id` 先 Director、再 Prompter（串行，Prompter 依赖 Director 的 markdown）。
 * - **块间**：默认全扇出并发；`--serial` 或 `--enforce-scene-serial` 行为与 v6 主脚本相同。
 *
 * ```mermaid
 * flowchart LR
 *   subgraph per_block [单 Block]
 *     D[Director LLM]
 *     P[Prompter LLM]
 *     D --> P
 *   end
 *   B01[Block B01] --> per_block
 *   B02[Block B02] --> per_block
 *   B03[Block B03] --> per_block
 *   B01 -. fan-out .- B02
 *   B02 -. fan-out .- B03
 * ```
 *
 * ## 用法（与 v6 主脚本相同 CLI，复制自其文件头说明）
 *
 *   node scripts/sd2_pipeline/call_sd2_block_chain_v6_doubao.mjs \
 *     --edit-map path/to/edit_map_sd2.json \
 *     --director-payloads path/to/sd2_director_payloads_v6.json \
 *     --out-root path/to/out_dir \
 *     [--normalized-package path/to/normalized_script_package.json]
 *
 * ## 环境变量
 *
 *   - ARK_API_KEY（必填，见 `reference/豆包/openai格式.md`）
 *   - ARK_BASE_URL（可选）
 *   - ARK_MODEL（可选）
 *   - ARK_MAX_OUTPUT_TOKENS（可选，建议 Director 场景 ≥ 8192）
 *
 * 若已手动设置 `SD2_LLM_*`，本脚本**不会覆盖**（便于混用自建代理）。
 */
import { applyArkEnvForSd2Pipeline, getArkResolvedDefaults } from './lib/doubao_ark_chat.mjs';

const SCRIPT_TAG = 'call_sd2_block_chain_v6_doubao';

applyArkEnvForSd2Pipeline();

if (!process.env.SD2_LLM_API_KEY?.trim()) {
  console.error(
    `[${SCRIPT_TAG}] 缺少 ARK_API_KEY（或未设置 SD2_LLM_API_KEY）。请配置后重试。`,
  );
  process.exit(2);
}

const ark = getArkResolvedDefaults();
console.log(
  `[${SCRIPT_TAG}] 已注入 Ark → SD2_LLM：base=${process.env.SD2_LLM_BASE_URL} model=${process.env.SD2_LLM_MODEL}（默认 ARK 模型名=${ark.model}）`,
);

const { main } = await import('./call_sd2_block_chain_v6.mjs');

await main().catch((err) => {
  console.error(`[${SCRIPT_TAG}]`, err instanceof Error ? err.message : err);
  process.exit(1);
});
