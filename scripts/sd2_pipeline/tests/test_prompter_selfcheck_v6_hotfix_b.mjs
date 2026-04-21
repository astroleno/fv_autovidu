/**
 * SD2 v6.1 · Prompter 自检假阳性清洁化 · 回归脚本
 *
 * 背景：leji-v6d 跑完后发现 B10 的 dialogue_fidelity_check 自报 pass=true，
 *       但 checked_segments[0].raw_text="" 且 prompt_text="<silent>"——LLM 在无
 *       scriptChunk 参照时"自己骗自己"。HOTFIX B 在 pipeline 侧加入假阳性判定。
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_prompter_selfcheck_v6_hotfix_b.mjs
 * 非零退出表示有用例失败。
 */

import { checkPrompterSelfDialogueFidelity } from '../lib/sd2_prompter_selfcheck_v6.mjs';

/**
 * @typedef {Object} Case
 * @property {string} name   用例名
 * @property {unknown} input Prompter 输出片段
 * @property {'pass'|'fail'|'skip'} expect 期望状态
 */

/** @type {Case[]} */
const cases = [
  {
    name: 'HOTFIX B 命中：raw_text="" 且 prompt_text="<silent>" 自报 pass（leji-v6d B10 场景）',
    input: {
      dialogue_fidelity_check: {
        checked_segments: [
          { seg_id: 'SEG_025', raw_text: '', prompt_text: '<silent>', pass: true },
        ],
        total: 1,
        passed: 1,
        fidelity_ratio: 1,
        pass: true,
      },
    },
    expect: 'fail',
  },
  {
    name: '真实无对白场景：checked_segments=[] fidelity_ratio=1 → pass',
    input: {
      dialogue_fidelity_check: {
        checked_segments: [],
        total: 0,
        passed: 0,
        fidelity_ratio: 1,
        pass: true,
      },
    },
    expect: 'pass',
  },
  {
    name: '真实 pass：raw_text / prompt_text 都非空且 LLM 自报 pass',
    input: {
      dialogue_fidelity_check: {
        checked_segments: [
          { seg_id: 'SEG_001', raw_text: '你怎么来了？', prompt_text: '[DIALOG] 你怎么来了？', pass: true },
        ],
        total: 1,
        passed: 1,
        fidelity_ratio: 1,
        pass: true,
      },
    },
    expect: 'pass',
  },
  {
    name: '真实 fail：fidelity_ratio=0.5 LLM 自报未通过',
    input: {
      dialogue_fidelity_check: {
        checked_segments: [
          { seg_id: 'SEG_001', raw_text: '你怎么来了？', prompt_text: '你好', pass: false },
        ],
        total: 1,
        passed: 0,
        fidelity_ratio: 0.5,
        pass: false,
      },
    },
    expect: 'fail',
  },
  {
    name: '字段缺失：dialogue_fidelity_check 本体没有 → skip',
    input: {},
    expect: 'skip',
  },
  {
    name: 'HOTFIX B 多条假阳性：任一条空 raw_text + 非空 prompt_text 即降级',
    input: {
      dialogue_fidelity_check: {
        checked_segments: [
          { seg_id: 'SEG_001', raw_text: '真对白', prompt_text: '真对白', pass: true },
          { seg_id: 'SEG_002', raw_text: '', prompt_text: '<beat>', pass: true },
        ],
        total: 2,
        passed: 2,
        fidelity_ratio: 1,
        pass: true,
      },
    },
    expect: 'fail',
  },
];

let failed = 0;
for (const c of cases) {
  const r = checkPrompterSelfDialogueFidelity(c.input);
  const ok = r.status === c.expect;
  if (!ok) failed += 1;
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${c.name}\n        → status=${r.status}/${c.expect} reason=${r.reason}`,
  );
}
const total = cases.length;
console.log(`\n--- ${total - failed}/${total} passed ---`);
process.exit(failed > 0 ? 1 : 0);
