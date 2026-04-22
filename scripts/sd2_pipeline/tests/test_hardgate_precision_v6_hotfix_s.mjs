/**
 * SD2 v6.2 · 硬门口径精确化（HOTFIX S）· 回归脚本
 *
 * 背景：leji-v6-apimart-doubao / leji-v6-apimart-qwen 两轮排查暴露三条
 * "总审计器 vs 文件内自检" 口径不一致的假阳性硬门：
 *
 *   Bug B · prompter_dialogue_fidelity
 *     scriptChunk.segments[i].text 里常带 "（动作指示）" 括号注释，
 *     Prompter 合法剥除后写入 sd2_prompt；原 checkPrompterDialogueFidelityV6
 *     用 indexOf 严格比对带括号原文 → 找不到 → 假 fail。
 *     修复：增加 annotation_stripped fallback（剥成对 （） / () 注释后再 indexOf）。
 *
 *   Bug C1 · director_segment_coverage
 *     Director 合法 defer 某 seg 到后续 block（`deferred_to_block` 非空），
 *     coverage_ratio 本身因此 <0.9。原 checkDirectorSegmentCoverageV6 直接
 *     判 fail，未先剔除合法 deferred → 假 fail。
 *     修复：effective_ratio = consumed / (total - legally_deferred) 再比阈值。
 *
 *   Bug C2 · director_kva_coverage
 *     Director 在 appendix 中手填 kva_coverage_ratio=0，但 kva_consumption_report
 *     里实际已有 consumed_at_shot 非 null 的项 → LLM 数值错填。
 *     修复：当填值与 report 重算偏差 ≥ 0.1 时，以 report 重算为准。
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_hardgate_precision_v6_hotfix_s.mjs
 * 非零退出表示有用例失败。
 */

import {
  checkDirectorSegmentCoverageV6,
  checkDirectorKvaCoverageV6,
  checkPrompterDialogueFidelityV6,
} from '../lib/sd2_block_chain_v6_helpers.mjs';

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

// ──────────────────────────────────────────────────────────────────
// Bug B · prompter_dialogue_fidelity
// ──────────────────────────────────────────────────────────────────
console.log('── HOTFIX S · Bug B · annotation_stripped fallback（B14 真实案例）──');
{
  // B14 SEG_054 原文（带全角括号舞台指示）
  const scriptChunk = {
    segments: [
      {
        seg_id: 'SEG_054',
        segment_type: 'dialogue',
        text: '诶呀~凯哥，你干嘛，秦主任还在外面呢，你就不怕她知道吗？（手指故意在赵凯胸口画圈）',
      },
      {
        seg_id: 'SEG_055',
        segment_type: 'dialogue',
        text: '她知道了又能怎么样？你才是我的宝贝儿，（抚摸许倩的肚子）还有你肚子里的孩子。',
      },
      {
        seg_id: 'SEG_056',
        segment_type: 'dialogue',
        text: '那你准备什么时候娶我？',
      },
    ],
  };
  // Prompter 实际输出：剥除括号注释，保留主对白
  const sd2Prompt = [
    '[DIALOG] 诶呀~凯哥，你干嘛，秦主任还在外面呢，你就不怕她知道吗？',
    '[DIALOG] 她知道了又能怎么样？你才是我的宝贝儿，还有你肚子里的孩子。',
    '[DIALOG] 那你准备什么时候娶我？',
  ].join('\n');
  const r = checkPrompterDialogueFidelityV6(sd2Prompt, scriptChunk);
  assert('全部 3 段通过（含 2 段 annotation_stripped）', r.status === 'pass', r);
  assert('missing_seg_ids 为空', r.missing_seg_ids.length === 0, r.missing_seg_ids);
}

console.log('\n── HOTFIX S · Bug B · 真缺失仍要报出 ──');
{
  const scriptChunk = {
    segments: [
      { seg_id: 'SEG_X1', segment_type: 'dialogue', text: '我要去地狱见你' },
      { seg_id: 'SEG_X2', segment_type: 'dialogue', text: '你已经输了' },
    ],
  };
  const sd2Prompt = '[DIALOG] 我要去地狱见你'; // 真丢 SEG_X2
  const r = checkPrompterDialogueFidelityV6(sd2Prompt, scriptChunk);
  assert('真缺失 SEG_X2 → fail', r.status === 'fail', r);
  assert('missing_seg_ids 正确', r.missing_seg_ids.length === 1 && r.missing_seg_ids[0] === 'SEG_X2', r.missing_seg_ids);
}

console.log('\n── HOTFIX S · Bug B · 半角圆括号注释也能剥 ──');
{
  const scriptChunk = {
    segments: [
      { seg_id: 'SEG_Y1', segment_type: 'dialogue', text: '对不起(低头)我不该这样' },
    ],
  };
  const sd2Prompt = '[DIALOG] 对不起我不该这样';
  const r = checkPrompterDialogueFidelityV6(sd2Prompt, scriptChunk);
  assert('半角括号注释剥除后命中', r.status === 'pass', r);
}

console.log('\n── HOTFIX S · Bug B · shortened_by_author_hint 不被破坏 ──');
{
  const scriptChunk = {
    segments: [
      {
        seg_id: 'SEG_Z1',
        segment_type: 'dialogue',
        text: '这是一段非常非常非常长的台词，作者建议压缩',
        author_hint: { shortened_text: '这是一段台词' },
      },
    ],
  };
  const sd2Prompt = '[DIALOG] 这是一段台词';
  const r = checkPrompterDialogueFidelityV6(sd2Prompt, scriptChunk);
  assert('shortened_by_author_hint 仍然优先命中', r.status === 'pass', r);
}

// ──────────────────────────────────────────────────────────────────
// Bug C1 · director_segment_coverage
// ──────────────────────────────────────────────────────────────────
console.log('\n── HOTFIX S · Bug C1 · 合法 deferred 应从分母剔除（B14 真实案例）──');
{
  // B14：Director 把 SEG_057 合法 defer 到 B15
  const dirAppendix = {
    segment_coverage_report: {
      block_id: 'B14',
      consumed_segments: [
        { seg_id: 'SEG_054', segment_type: 'dialogue', consumed_at_shot: 2 },
        { seg_id: 'SEG_055', segment_type: 'dialogue', consumed_at_shot: 3 },
        { seg_id: 'SEG_056', segment_type: 'dialogue', consumed_at_shot: 4 },
      ],
      total_segments_in_covered_beats: 4,
      consumed_count: 3,
      coverage_ratio: 0.75,
      missing_must_cover: [
        { seg_id: 'SEG_057', reason: '本block时长不足，无法承载长对白', deferred_to_block: 'B15' },
      ],
    },
  };
  const scriptChunk = { segments: [] };
  const r = checkDirectorSegmentCoverageV6(dirAppendix, scriptChunk);
  assert('effective_ratio 重算后 pass（3/3=1.0）', r.status === 'pass', r);
  assert('coverage_ratio 仍透出原值 0.75 供审计', r.coverage_ratio === 0.75, r);
}

console.log('\n── HOTFIX S · Bug C1 · 无 deferred 的 missing 仍要 fail ──');
{
  const dirAppendix = {
    segment_coverage_report: {
      total_segments_in_covered_beats: 4,
      consumed_count: 2,
      coverage_ratio: 0.5,
      missing_must_cover: [
        { seg_id: 'SEG_100', reason: '忘了处理', deferred_to_block: '' },
        { seg_id: 'SEG_101', reason: '忘了处理', deferred_to_block: null },
      ],
    },
  };
  const scriptChunk = { segments: [] };
  const r = checkDirectorSegmentCoverageV6(dirAppendix, scriptChunk);
  assert('无合法 deferred 的 missing → fail', r.status === 'fail', r);
}

console.log('\n── HOTFIX S · Bug C1 · 部分合法 deferred 也要 fail（全部合法才放行）──');
{
  const dirAppendix = {
    segment_coverage_report: {
      total_segments_in_covered_beats: 4,
      consumed_count: 2,
      coverage_ratio: 0.5,
      missing_must_cover: [
        { seg_id: 'SEG_200', deferred_to_block: 'B15' }, // 合法
        { seg_id: 'SEG_201', deferred_to_block: '' },     // 非法
      ],
    },
  };
  const scriptChunk = { segments: [] };
  const r = checkDirectorSegmentCoverageV6(dirAppendix, scriptChunk);
  assert('有一条无 deferred → 仍 fail', r.status === 'fail', r);
}

console.log('\n── HOTFIX S · Bug C1 · 原本就 ≥ 0.9 的 pass 路径不变 ──');
{
  const dirAppendix = {
    segment_coverage_report: {
      total_segments_in_covered_beats: 10,
      consumed_count: 10,
      coverage_ratio: 1.0,
      missing_must_cover: [],
    },
  };
  const r = checkDirectorSegmentCoverageV6(dirAppendix, { segments: [] });
  assert('coverage=1.0 仍 pass', r.status === 'pass', r);
}

// ──────────────────────────────────────────────────────────────────
// Bug C2 · director_kva_coverage
// ──────────────────────────────────────────────────────────────────
console.log('\n── HOTFIX S · Bug C2 · LLM 填 0 但 report 实际全 consumed（B08 真实案例）──');
{
  const scriptChunk = {
    key_visual_actions: [
      { kva_id: 'KVA_P0_a', priority: 'P0' },
      { kva_id: 'KVA_P0_b', priority: 'P0' },
    ],
  };
  const dirAppendix = {
    // LLM 数值填错
    kva_coverage_ratio: 0,
    // 但 report 里实际全 consumed
    kva_consumption_report: [
      { kva_id: 'KVA_P0_a', consumed_at_shot: 1, verification: 'ok' },
      { kva_id: 'KVA_P0_b', consumed_at_shot: 2, verification: 'ok' },
    ],
  };
  const r = checkDirectorKvaCoverageV6(dirAppendix, scriptChunk, false);
  assert('report 重算后 pass', r.status === 'pass', r);
  assert('kva_ratio 应反映重算值 1.0', r.kva_ratio === 1, r);
}

console.log('\n── HOTFIX S · Bug C2 · LLM 填 1 但 report 实际只 consumed 一半 → 不能放水 ──');
{
  const scriptChunk = {
    key_visual_actions: [
      { kva_id: 'KVA_P0_a', priority: 'P0' },
      { kva_id: 'KVA_P0_b', priority: 'P0' },
    ],
  };
  const dirAppendix = {
    kva_coverage_ratio: 1, // LLM 虚报
    kva_consumption_report: [
      { kva_id: 'KVA_P0_a', consumed_at_shot: 1 },
      { kva_id: 'KVA_P0_b', consumed_at_shot: null, deferred_to_block: null },
    ],
  };
  const r = checkDirectorKvaCoverageV6(dirAppendix, scriptChunk, false);
  assert('LLM 虚报被 report 打回原形 → fail', r.status === 'fail', r);
}

console.log('\n── HOTFIX S · Bug C2 · 合法 deferred 的 P0 不扣分 ──');
{
  const scriptChunk = {
    key_visual_actions: [
      { kva_id: 'KVA_P0_a', priority: 'P0' },
      { kva_id: 'KVA_P0_b', priority: 'P0' },
    ],
  };
  const dirAppendix = {
    kva_coverage_ratio: 0.5, // LLM 算了带 deferred 的比例
    kva_consumption_report: [
      { kva_id: 'KVA_P0_a', consumed_at_shot: 1 },
      { kva_id: 'KVA_P0_b', consumed_at_shot: null, deferred_to_block: 'B10', priority: 'P0' },
    ],
  };
  const r = checkDirectorKvaCoverageV6(dirAppendix, scriptChunk, false);
  assert('合法 deferred 剔除后 pass（1/1=1.0）', r.status === 'pass', r);
}

console.log('\n── HOTFIX S · Bug C2 · 无 P0 KVA 时不产生硬失败 ──');
{
  const scriptChunk = {
    key_visual_actions: [{ kva_id: 'KVA_P1_a', priority: 'P1' }],
  };
  const dirAppendix = { kva_coverage_ratio: 0 };
  const r = checkDirectorKvaCoverageV6(dirAppendix, scriptChunk, false);
  assert('无 P0 → 非 fail（口径容忍）', r.status !== 'fail', r);
}

console.log('\n── HOTFIX S · Bug C2 · skipKvaHard 降级行为不变 ──');
{
  const scriptChunk = {
    key_visual_actions: [{ kva_id: 'KVA_P0_a', priority: 'P0' }],
  };
  const dirAppendix = {
    kva_coverage_ratio: 0,
    kva_consumption_report: [{ kva_id: 'KVA_P0_a', consumed_at_shot: null }],
  };
  const r = checkDirectorKvaCoverageV6(dirAppendix, scriptChunk, true);
  assert('skipKvaHard=true → warn 而非 fail', r.status === 'warn', r);
}

// ──────────────────────────────────────────────────────────────────
console.log(`\nTotal: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
