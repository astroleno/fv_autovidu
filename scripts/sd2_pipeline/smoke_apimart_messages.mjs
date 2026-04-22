/**
 * Smoke test: APIMart /v1/messages + claude-opus-4-6-thinking + SSE + thinking block 过滤。
 *
 * 目的：
 *   - 最小 prompt（两行）验证端到端通路：请求头、SSE 解析、thinking 过滤、stop_reason 回读
 *   - 不跑 editmap 全量（避免 10+ min 白白等）
 *
 * 运行：
 *   node scripts/sd2_pipeline/smoke_apimart_messages.mjs
 *
 * 通过标准：stdout 打印一小段 JSON（{"ok":true,"echo":"..."}）且无异常。
 */
import { callApimartMessages, getApimartMessagesDefaults } from './lib/apimart_messages_chat.mjs';

async function main() {
  const d = getApimartMessagesDefaults();
  console.log(
    `[smoke] base=${d.baseUrl} model=${d.model} anthropic-version=${d.anthropicVersion}`,
  );

  const systemPrompt = '你是只输出 JSON 的 smoke-test 助手。必须输出一个合法 JSON 对象。';
  const userMessage =
    '输出一个 JSON 对象：{"ok": true, "echo": "apimart-messages-v6-smoke"}。不要 markdown 围栏，不要任何其他文字。';

  const t0 = Date.now();
  const raw = await callApimartMessages({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    model: d.model,
    temperature: 0,
    maxTokens: 2048,
    stream: true,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`[smoke] elapsed=${elapsed}s raw.length=${raw.length}`);
  console.log(`[smoke] raw preview:\n${raw.slice(0, 400)}`);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      parsed = JSON.parse(m[0]);
    } else {
      throw e;
    }
  }
  if (!parsed || typeof parsed !== 'object' || parsed.ok !== true) {
    throw new Error(`[smoke] parsed 不满足期望 ok=true: ${JSON.stringify(parsed)}`);
  }
  console.log(`[smoke] ✅ 通路 OK, parsed=${JSON.stringify(parsed)}`);
}

main().catch((err) => {
  console.error('[smoke] ❌', err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
