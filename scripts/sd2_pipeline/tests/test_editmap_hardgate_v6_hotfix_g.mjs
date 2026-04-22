/**
 * SD2 v6.2 · EditMap 层硬门（HOTFIX G · source_integrity）· 回归脚本
 *
 * 背景：leji-v6f 豆包实验暴露出 LLM 会在 `appendix.block_index[].covered_segment_ids`
 * 里**伪造 universe 之外的 seg_id**（真实池只到 SEG_062，LLM 却自造 SEG_063–SEG_072）。
 * HOTFIX D 的 L1 coverage 用 universe 过滤伪段，**伪段既不计入覆盖率也不触发任何警报**，
 * 因此被当作"全部通过"写盘，下游 Director/Prompter 再拿着伪 seg_id 造假内容，
 * 从而把"假段 → 假镜头 → 假镜号"传染到最终报告。
 *
 * HOTFIX G 的处置：
 *   G-1) 新增纯函数 `collectAllReferencedSegIds(parsed)`：**不过滤 universe**，
 *        扫出所有被 EditMap 引用的 seg_id（含 covered / must_cover / script_chunk_hint.*）。
 *   G-2) 新增纯函数 `runSourceIntegrityCheck(parsed, normalizedPackage)`：
 *        - 'pass' 当所有引用 ∈ universe；
 *        - 'fail' 并列出 outOfUniverseIds 当任何引用 ∉ universe；
 *        - 'skip' 当 universe 为空（未挂载 Stage 0）。
 *   G-3) 在 main() 升级为硬门，可通过 `--skip-source-integrity-hard` / `--allow-v6-soft`
 *        降级为 warn。
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_editmap_hardgate_v6_hotfix_g.mjs
 * 非零退出表示有用例失败。
 */

import {
  collectAllReferencedSegIds,
  runSourceIntegrityCheck,
} from '../call_editmap_sd2_v6.mjs';

/**
 * 构造一个含 `segCount` 个 seg 的 Normalizer 包（仅模拟结构）。
 *
 * @param {number} segCount
 * @returns {{ beat_ledger: { segments: { seg_id: string }[] }[] }}
 */
function makeNormalizedPackage(segCount) {
  /** @type {{ segments: { seg_id: string }[] }[]} */
  const beats = [];
  let i = 1;
  while (i <= segCount) {
    const chunk = Math.min(10, segCount - i + 1);
    const segments = [];
    for (let j = 0; j < chunk; j += 1, i += 1) {
      segments.push({ seg_id: `SEG_${String(i).padStart(3, '0')}` });
    }
    beats.push({ segments });
  }
  return { beat_ledger: beats };
}

/** 构造一个 EditMap parsed（只保留我们关心的 appendix.block_index[]） */
function makeParsed(blockIndex) {
  return { appendix: { block_index: blockIndex } };
}

/** 最小测试骨架 */
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

console.log('── HOTFIX G · collectAllReferencedSegIds ──');
{
  const parsed = makeParsed([
    {
      block_id: 'B01',
      covered_segment_ids: ['SEG_001', 'SEG_002'],
      must_cover_segment_ids: ['SEG_002'],
      script_chunk_hint: {
        lead_seg_id: 'SEG_001',
        tail_seg_id: 'SEG_002',
        must_cover_segment_ids: ['SEG_002'],
      },
    },
    {
      block_id: 'B02',
      covered_segment_ids: ['SEG_003', 'SEG_004', 'SEG_063'],
      script_chunk_hint: { lead_seg_id: 'SEG_003', tail_seg_id: 'SEG_070' },
    },
  ]);
  const ids = collectAllReferencedSegIds(parsed);
  assert('收集到所有引用（含伪段）', ids.has('SEG_063') && ids.has('SEG_070'));
  assert('引用去重', ids.size === 6, [...ids].sort());
  assert('script_chunk_hint.lead/tail 进集合', ids.has('SEG_001') && ids.has('SEG_070'));
  assert('hint.must_cover 进集合', ids.has('SEG_002'));
}

{
  // 空 appendix / 无 block_index 时返回空集
  const ids1 = collectAllReferencedSegIds({});
  assert('parsed 无 appendix → empty', ids1.size === 0);
  const ids2 = collectAllReferencedSegIds({ appendix: {} });
  assert('appendix 无 block_index → empty', ids2.size === 0);
}

console.log('\n── HOTFIX G · runSourceIntegrityCheck: pass 路径 ──');
{
  const pkg = makeNormalizedPackage(62);
  const parsed = makeParsed([
    { block_id: 'B01', covered_segment_ids: ['SEG_001', 'SEG_002', 'SEG_003'] },
    { block_id: 'B02', covered_segment_ids: ['SEG_060', 'SEG_061', 'SEG_062'] },
  ]);
  const r = runSourceIntegrityCheck(parsed, pkg);
  assert('全部 ∈ universe → pass', r.status === 'pass', r);
  assert('outOfUniverseIds 空', r.outOfUniverseIds.length === 0);
  assert('totalReferenced 统计准确', r.totalReferenced === 6, r);
}

console.log('\n── HOTFIX G · runSourceIntegrityCheck: fail 路径（v6f 豆包复现） ──');
{
  const pkg = makeNormalizedPackage(62);
  const parsed = makeParsed([
    { block_id: 'B01', covered_segment_ids: ['SEG_001', 'SEG_002'] },
    {
      block_id: 'B15',
      covered_segment_ids: ['SEG_063', 'SEG_064', 'SEG_065'],
    },
    {
      block_id: 'B16',
      covered_segment_ids: ['SEG_066', 'SEG_067', 'SEG_068', 'SEG_069', 'SEG_070', 'SEG_071', 'SEG_072'],
    },
  ]);
  const r = runSourceIntegrityCheck(parsed, pkg);
  assert('存在伪段 → fail', r.status === 'fail', r);
  assert('outOfUniverseIds 准确',
    r.outOfUniverseIds.length === 10 &&
      r.outOfUniverseIds[0] === 'SEG_063' &&
      r.outOfUniverseIds[r.outOfUniverseIds.length - 1] === 'SEG_072',
    r.outOfUniverseIds);
  assert('reason 含前 8 项预览', r.reason.includes('SEG_063') && r.reason.includes(',…'));
}

console.log('\n── HOTFIX G · runSourceIntegrityCheck: skip 路径 ──');
{
  const r = runSourceIntegrityCheck({ appendix: { block_index: [] } }, null);
  assert('normalizedPackage 为 null → skip', r.status === 'skip', r);
  const r2 = runSourceIntegrityCheck({ appendix: { block_index: [] } }, { beat_ledger: [] });
  assert('universe 为空 → skip', r2.status === 'skip', r2);
}

console.log('\n── HOTFIX G · hint.must_cover 也会引入伪段 ──');
{
  const pkg = makeNormalizedPackage(62);
  const parsed = makeParsed([
    {
      block_id: 'B01',
      covered_segment_ids: ['SEG_001'],
      script_chunk_hint: {
        lead_seg_id: 'SEG_001',
        tail_seg_id: 'SEG_001',
        must_cover_segment_ids: ['SEG_999'],
      },
    },
  ]);
  const r = runSourceIntegrityCheck(parsed, pkg);
  assert('hint.must_cover 里的伪 seg 被抓到',
    r.status === 'fail' && r.outOfUniverseIds.includes('SEG_999'), r);
}

console.log(`\n── 结果：${passed} passed, ${failed} failed ──`);
process.exit(failed === 0 ? 0 : 1);
