#!/usr/bin/env node
/**
 * 探测云雾上各 Claude 模型 slug：极小 JSON 请求，观察 HTTP/空 content/429。
 * 用法：node scripts/sd2_pipeline/dev_yunwu_model_probe.mjs
 */
import { callYunwuChatCompletions } from './lib/yunwu_chat.mjs';

/** @type {string[]} */
const MODELS = [
  'claude-opus-4-7-thinking',
  'claude-opus-4-7',
  'claude-opus-4-6-thinking',
  'claude-opus-4-6',
];

async function probe() {
  for (const model of MODELS) {
    const enableThinking = model.includes('thinking');
    process.stdout.write(`\n=== ${model} (enable_thinking=${enableThinking}) ===\n`);
    try {
      const t = await callYunwuChatCompletions({
        messages: [
          {
            role: 'user',
            content:
              'Output a single JSON object with keys "model_id" (string) and "ok" (boolean true). No markdown fence.',
          },
        ],
        model,
        jsonObject: true,
        enableThinking,
        maxTokens: 4096,
        maxRetries: 1,
      });
      process.stdout.write(`OK text_len=${t.length} head=${JSON.stringify(t.slice(0, 160))}\n`);
    } catch (e) {
      process.stdout.write(
        `FAIL ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }
}

probe().catch((e) => {
  console.error(e);
  process.exit(1);
});
