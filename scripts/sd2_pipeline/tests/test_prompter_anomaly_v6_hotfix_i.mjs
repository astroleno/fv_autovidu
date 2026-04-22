/**
 * SD2 v6.2 · Prompter 产物异常检测（HOTFIX I）· 回归脚本
 *
 * 背景：leji-v6f 豆包/qwen 实验里观察到两类偶发的 Prompter 单次调用崩溃：
 *   1. B03 的 global_prefix 被 LLM 循环填充"偶像剧、家庭剧、伦理剧…"成 23KB 字符串，
 *      耗光 max_tokens，其余自检字段全部被截断；
 *   2. 顶层 JSON 语法正确但 LLM 只写了 shots + global_prefix，未输出 tail 自检字段。
 *
 * HOTFIX I 的处置：
 *   - `detectPrefixRepetitionCollapse`：抓 global_prefix 内 3–6 字短语重复 ≥ 20 次
 *     且 prefix 长度 > 4000；
 *   - `detectTailFieldsMissing`：dialogue_fidelity_check / segment_coverage_overall /
 *     forbidden_words_self_check 必须至少有 1 个；
 *   - `shouldRetryPrompter`：综合判定是否触发"温度升档自动重试 1 次"。
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_prompter_anomaly_v6_hotfix_i.mjs
 * 非零退出表示有用例失败。
 */

import {
  detectPrefixRepetitionCollapse,
  detectTailFieldsMissing,
  shouldRetryPrompter,
} from '../lib/sd2_prompter_anomaly_v6.mjs';

let passed = 0;
let failed = 0;

/** @param {string} name @param {boolean} cond @param {unknown} [extra] */
function assert(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}`, extra ?? '');
  }
}

console.log('── HOTFIX I · detectPrefixRepetitionCollapse: 真实 v6f B03 复现 ──');
{
  // 构造一个长 prefix，末尾把"偶像剧、家庭剧、伦理剧"循环几十次
  const head = '真人电影，写实主义，9:16竖屏；禁词：面颊泛红、发白…'.repeat(20); // ~400 字
  const loop = '偶像剧、家庭剧、伦理剧、婆媳剧、宅斗剧、权谋剧、谍战剧、刑侦剧';
  const tail = loop.repeat(200); // 触发循环（200×32 = 6400 字 ≫ 4000）
  const prefix = head + tail;
  const r = detectPrefixRepetitionCollapse(prefix);
  assert('v6f B03 样式循环被抓到', r.detected, r);
  assert('phrase 命中 3–6 字短语', r.phrase.length >= 3 && r.phrase.length <= 6, r);
  assert('count ≥ 20', r.count >= 20, r);
  assert('prefixLength 透出', r.prefixLength === prefix.length);
}

console.log('\n── HOTFIX I · detectPrefixRepetitionCollapse: 正常 prefix 不误伤 ──');
{
  const prefix = '真人电影，写实主义医疗剧，冷高对比色调，9:16竖屏安全区适配，禁词：面颊泛红、发白、泛白';
  const r = detectPrefixRepetitionCollapse(prefix);
  assert('< 4000 字符直接放过', !r.detected, r);
}

{
  // 边界：英文重复 + 混合标点的长 prefix → 不应命中（算法只关心纯中文短语重复）
  const prefix = 'A'.repeat(500) + ('foo,bar,baz,qux,' .repeat(1000));
  const r = detectPrefixRepetitionCollapse(prefix);
  assert('英文重复/标点混合的长 prefix 不误伤', !r.detected, r);
}
{
  // 同一个中文字符重复（如 '啊啊啊'）也不算真实崩溃模式 → 不命中
  const prefix = 'A'.repeat(100) + '啊'.repeat(8000);
  const r = detectPrefixRepetitionCollapse(prefix);
  assert('单字重复不命中', !r.detected, r);
}

console.log('\n── HOTFIX I · detectTailFieldsMissing ──');
{
  assert('三字段全缺 → missing',
    detectTailFieldsMissing({ shots: [], global_prefix: '' }).missing === true);
  assert('只有 dialogue_fidelity_check → pass',
    detectTailFieldsMissing({ dialogue_fidelity_check: { status: 'pass' } }).missing === false);
  assert('只有 segment_coverage_overall → pass',
    detectTailFieldsMissing({ segment_coverage_overall: { pass_l2: true } }).missing === false);
  assert('只有 forbidden_words_self_check → pass',
    detectTailFieldsMissing({ forbidden_words_self_check: { ok: true } }).missing === false);
  assert('presentFields 准确',
    detectTailFieldsMissing({ dialogue_fidelity_check: {}, segment_coverage_overall: {} }).presentFields.length === 2);
  assert('null → missing', detectTailFieldsMissing(null).missing === true);
  assert('数组 → missing', detectTailFieldsMissing([]).missing === true);
}

console.log('\n── HOTFIX I · shouldRetryPrompter: 综合判定 ──');
{
  // 健康样本（像 v6f 的 B01）
  const healthy = {
    shots: [{ sd2_prompt: '[FRAME] ...' }],
    global_prefix: '真人电影，写实主义医疗剧',
    dialogue_fidelity_check: { status: 'pass' },
    segment_coverage_overall: { pass_l2: true },
    forbidden_words_self_check: { ok: true },
  };
  const r = shouldRetryPrompter(healthy);
  assert('健康产物 → shouldRetry=false', r.shouldRetry === false, r.reasons);

  // v6f B03：只有 shots + global_prefix，且 prefix 循环爆炸
  const collapseLoop = '偶像剧、家庭剧、伦理剧、婆媳剧、宅斗剧、权谋剧、谍战剧、刑侦剧'.repeat(200);
  const bad = {
    shots: [{ sd2_prompt: '...' }],
    global_prefix: 'X'.repeat(100) + collapseLoop,
  };
  const r2 = shouldRetryPrompter(bad);
  assert('v6f B03 双重信号 → shouldRetry=true', r2.shouldRetry === true);
  assert('tail 字段缺失命中', r2.reasons.some((x) => x === 'tail_fields_missing'), r2.reasons);
  assert('prefix 循环命中', r2.reasons.some((x) => x.startsWith('prefix_repetition_collapse')), r2.reasons);

  // 只缺 tail 字段（prefix 正常）
  const badTailOnly = {
    shots: [],
    global_prefix: '正常的 prefix 字符串',
  };
  const r3 = shouldRetryPrompter(badTailOnly);
  assert('只缺 tail → shouldRetry=true', r3.shouldRetry === true, r3);
  assert('只应一个 reason', r3.reasons.length === 1);

  // 只有 prefix 爆炸（字段在）
  const badCollapseOnly = {
    shots: [],
    global_prefix: '正常 prefix... '.repeat(10) + collapseLoop,
    dialogue_fidelity_check: { status: 'pass' },
  };
  const r4 = shouldRetryPrompter(badCollapseOnly);
  assert('只有 prefix 爆炸 → shouldRetry=true', r4.shouldRetry === true);
  assert('只一个 reason（collapse）',
    r4.reasons.length === 1 && r4.reasons[0].startsWith('prefix_repetition_collapse'), r4);
}

console.log(`\n── 结果：${passed} passed, ${failed} failed ──`);
process.exit(failed === 0 ? 0 : 1);
