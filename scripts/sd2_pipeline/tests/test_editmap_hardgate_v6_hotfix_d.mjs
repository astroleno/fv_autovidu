/**
 * SD2 v6.1 · EditMap 层硬门（HOTFIX D + F）· 回归脚本
 *
 * 背景：leji-v6e_pass2 观察到 EditMap 只处理前半段脚本（62 个 seg 只覆盖 26 个 =
 *       41.9%），但 LLM 自填 `diagnosis.segment_coverage_ratio_estimated = 0.97`
 *       与事实相反，形成"自欺的 pass"。L1 段覆盖此前是软门，不阻塞；
 *       tail_seg 也没有单独几何约束。
 *
 * HOTFIX D 两条：
 *   D-1) L1 段覆盖升级为硬门（可 --allow-v6-soft / --skip-editmap-coverage-hard 降级）。
 *   D-2) 新增 last_seg_covered_check 硬门（时间轴末段必须被任一 block 覆盖）。
 *   D-3) 回填 diagnosis.segment_coverage_check / *_ratio_estimated 为 pipeline
 *        实算值，LLM 自报留底为 *_llm_self_reported 字段，阻断幻觉传导。
 *
 * HOTFIX F：动态硬下限生成器，按 segs_count 计算：
 *   - shot 硬下限 = max(50, segs_count)
 *   - block 硬下限 = max(15, ceil(segs_count/4))
 *   - tail_seg 必须进最后一个 block
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_editmap_hardgate_v6_hotfix_d.mjs
 * 非零退出表示有用例失败。
 */

import {
  computeSegmentUniverseFromPackage,
  runSegmentCoverageL1Check,
  runLastSegCoveredCheck,
  runStyleInferenceShapeCheck,
  backfillDiagnosisAuthoritativeMetrics,
  composeDynamicHardFloorBrief,
  appendHardFloorToDirectorBrief,
} from '../call_editmap_sd2_v6.mjs';

/** 常用测试夹具：一个含 62 个 seg 的 normalizedPackage（只模拟结构） */
function makeNormalizedPackage(segCount) {
  /** @type {{ segments: { seg_id: string }[] }[]} */
  const beats = [];
  let i = 1;
  while (i <= segCount) {
    const chunk = Math.min(5, segCount - i + 1);
    /** @type {{ seg_id: string }[]} */
    const segs = [];
    for (let j = 0; j < chunk; j += 1) {
      segs.push({ seg_id: `SEG_${String(i + j).padStart(3, '0')}` });
    }
    beats.push({ segments: segs });
    i += chunk;
  }
  return { beat_ledger: beats };
}

/** 构造一个 EditMap parsed（仅含 appendix.block_index，用于覆盖率计算） */
function makeParsedWithCoverage(coveredIds) {
  return {
    appendix: {
      block_index: [
        { block_id: 'B01', covered_segment_ids: coveredIds },
      ],
    },
  };
}

let failed = 0;
let passed = 0;

/**
 * @param {string} name
 * @param {() => boolean} fn
 */
function check(name, fn) {
  let ok = false;
  let err = '';
  try {
    ok = fn();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  if (ok) {
    passed += 1;
    console.log(`[PASS] ${name}`);
  } else {
    failed += 1;
    console.log(`[FAIL] ${name}${err ? ` · ${err}` : ''}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. computeSegmentUniverseFromPackage · 基础抽取
// ─────────────────────────────────────────────────────────────────────────

check('universe 抽取：62 个 seg，tail=SEG_062，顺序保留', () => {
  const pkg = makeNormalizedPackage(62);
  const { ordered, universe, tailSegId } = computeSegmentUniverseFromPackage(pkg);
  return (
    universe.size === 62 &&
    tailSegId === 'SEG_062' &&
    ordered[0] === 'SEG_001' &&
    ordered[ordered.length - 1] === 'SEG_062'
  );
});

check('universe 抽取：空 package → universe.size=0, tail=null', () => {
  const { universe, tailSegId } = computeSegmentUniverseFromPackage(null);
  return universe.size === 0 && tailSegId === null;
});

check('universe 抽取：beat_ledger 缺失 → 空集', () => {
  const { universe, tailSegId } = computeSegmentUniverseFromPackage({});
  return universe.size === 0 && tailSegId === null;
});

// ─────────────────────────────────────────────────────────────────────────
// 2. runSegmentCoverageL1Check · 硬门判定
// ─────────────────────────────────────────────────────────────────────────

check('L1 覆盖：62/62 → pass, ratio=1.0', () => {
  const pkg = makeNormalizedPackage(62);
  const all = Array.from({ length: 62 }, (_, i) => `SEG_${String(i + 1).padStart(3, '0')}`);
  const parsed = makeParsedWithCoverage(all);
  const r = runSegmentCoverageL1Check(parsed, pkg);
  return r.status === 'pass' && r.ratio === 1 && r.covered === 62 && r.total === 62 && r.missingIds.length === 0;
});

check('L1 覆盖：26/62（leji-v6e_pass2 现状）→ fail, ratio≈0.419', () => {
  const pkg = makeNormalizedPackage(62);
  const first26 = Array.from({ length: 26 }, (_, i) => `SEG_${String(i + 1).padStart(3, '0')}`);
  const parsed = makeParsedWithCoverage(first26);
  const r = runSegmentCoverageL1Check(parsed, pkg);
  return (
    r.status === 'fail' &&
    Math.abs(r.ratio - 26 / 62) < 1e-6 &&
    r.covered === 26 &&
    r.total === 62 &&
    r.missingIds.length === 36 &&
    r.missingIds[0] === 'SEG_027'
  );
});

check('L1 覆盖：59/62 → pass（ratio=0.951 ≥ 0.95）', () => {
  const pkg = makeNormalizedPackage(62);
  const first59 = Array.from({ length: 59 }, (_, i) => `SEG_${String(i + 1).padStart(3, '0')}`);
  const parsed = makeParsedWithCoverage(first59);
  const r = runSegmentCoverageL1Check(parsed, pkg);
  return r.status === 'pass' && r.ratio >= 0.95;
});

check('L1 覆盖：58/62 → fail（ratio=0.935 < 0.95）', () => {
  const pkg = makeNormalizedPackage(62);
  const first58 = Array.from({ length: 58 }, (_, i) => `SEG_${String(i + 1).padStart(3, '0')}`);
  const parsed = makeParsedWithCoverage(first58);
  const r = runSegmentCoverageL1Check(parsed, pkg);
  return r.status === 'fail' && r.ratio < 0.95;
});

check('L1 覆盖：Stage 0 缺失 → skip', () => {
  const parsed = makeParsedWithCoverage([]);
  const r = runSegmentCoverageL1Check(parsed, null);
  return r.status === 'skip' && r.total === 0;
});

check('L1 覆盖：universe 外的 seg_id 不被计入（过滤伪造 ID）', () => {
  const pkg = makeNormalizedPackage(10);
  const mixed = ['SEG_001', 'SEG_002', 'SEG_999', 'SEG_888'];
  const parsed = makeParsedWithCoverage(mixed);
  const r = runSegmentCoverageL1Check(parsed, pkg);
  return r.covered === 2 && r.total === 10;
});

// ─────────────────────────────────────────────────────────────────────────
// 3. runLastSegCoveredCheck · tail_seg 硬门
// ─────────────────────────────────────────────────────────────────────────

check('tail_seg：SEG_062 进入 block.covered_segment_ids → pass', () => {
  const pkg = makeNormalizedPackage(62);
  const parsed = makeParsedWithCoverage(['SEG_001', 'SEG_062']);
  const r = runLastSegCoveredCheck(parsed, pkg);
  return r.status === 'pass' && r.tailSegId === 'SEG_062';
});

check('tail_seg：SEG_062 不在任何 block → fail（leji-v6e_pass2 B10 场景）', () => {
  const pkg = makeNormalizedPackage(62);
  const first26 = Array.from({ length: 26 }, (_, i) => `SEG_${String(i + 1).padStart(3, '0')}`);
  const parsed = makeParsedWithCoverage(first26);
  const r = runLastSegCoveredCheck(parsed, pkg);
  return r.status === 'fail' && r.tailSegId === 'SEG_062' && r.reason.includes('SEG_062');
});

check('tail_seg：Stage 0 缺失 → skip', () => {
  const parsed = makeParsedWithCoverage([]);
  const r = runLastSegCoveredCheck(parsed, null);
  return r.status === 'skip' && r.tailSegId === null;
});

// ─────────────────────────────────────────────────────────────────────────
// 3.5. runStyleInferenceShapeCheck · v7 genre_bias.primary canonical
// ─────────────────────────────────────────────────────────────────────────

check('style_inference：v7 canonical genre_bias.primary 缺 value 也通过', () => {
  const parsed = {
    meta: {
      style_inference: {
        rendering_style: { value: '3D写实动画' },
        tone_bias: { value: 'high_contrast' },
        genre_bias: { primary: 'short_drama_contrast_hook' },
      },
    },
  };
  const r = runStyleInferenceShapeCheck(parsed);
  return r.status === 'pass' && r.missing.length === 0;
});

// ─────────────────────────────────────────────────────────────────────────
// 4. backfillDiagnosisAuthoritativeMetrics · 覆盖 LLM 幻觉
// ─────────────────────────────────────────────────────────────────────────

check('回填：LLM 自报 0.97 被 pipeline 0.419 覆盖，原值留底', () => {
  /** @type {Record<string, unknown>} */
  const parsed = {
    appendix: {
      diagnosis: {
        segment_coverage_ratio_estimated: 0.97,
        segment_coverage_check: true,
      },
    },
  };
  const segCheck = {
    ratio: 26 / 62,
    covered: 26,
    total: 62,
    status: 'fail',
    missingIds: ['SEG_027'],
  };
  const tailCheck = { status: 'fail', tailSegId: 'SEG_062', reason: 'not_covered' };
  backfillDiagnosisAuthoritativeMetrics(parsed, segCheck, tailCheck);
  const d = parsed.appendix.diagnosis;
  return (
    d.segment_coverage_ratio_estimated === 0.419 &&
    d.segment_coverage_check === false &&
    d.last_seg_covered_check === false &&
    d.segment_coverage_ratio_llm_self_reported === 0.97 &&
    d.segment_coverage_check_llm_self_reported === true &&
    d.pipeline_authoritative === true
  );
});

check('回填：appendix 不存在时 no-op（不抛错）', () => {
  /** @type {Record<string, unknown>} */
  const parsed = {};
  backfillDiagnosisAuthoritativeMetrics(
    parsed,
    { ratio: 1, covered: 10, total: 10, status: 'pass', missingIds: [] },
    { status: 'pass', tailSegId: 'SEG_010', reason: '' },
  );
  return !('appendix' in parsed) || parsed.appendix === undefined;
});

// ─────────────────────────────────────────────────────────────────────────
// 5. composeDynamicHardFloorBrief · HOTFIX F 公式
// ─────────────────────────────────────────────────────────────────────────

check('F 公式：segsCount=62 → shot≥62, block≥16（ceil(62/4)=16）', () => {
  const text = composeDynamicHardFloorBrief(62, 'SEG_062', 120);
  // shot floor = max(50, 62) = 62；block floor = max(15, 16) = 16
  return (
    text.includes('shots.length ≥ 62') &&
    text.includes('blocks.length ≥ 16') &&
    text.includes('SEG_062') &&
    text.includes('120 秒')
  );
});

check('F 公式：segsCount=30 → shot≥50（下限兜底），block≥15（下限兜底）', () => {
  const text = composeDynamicHardFloorBrief(30, 'SEG_030', 120);
  return (
    text.includes('shots.length ≥ 50') &&
    text.includes('blocks.length ≥ 15')
  );
});

check('F 公式：segsCount=200 → shot≥200, block≥50（ceil(200/4)=50）', () => {
  const text = composeDynamicHardFloorBrief(200, 'SEG_200', 240);
  return (
    text.includes('shots.length ≥ 200') &&
    text.includes('blocks.length ≥ 50') &&
    text.includes('240 秒')
  );
});

check('F 公式：tailSegId=null → 不输出 tail 子句（不构成错误）', () => {
  const text = composeDynamicHardFloorBrief(0, null, 120);
  // 不应包含 tail 约束
  return !text.includes('最后一个 seg') && text.includes('shots.length ≥ 50');
});

// ─────────────────────────────────────────────────────────────────────────
// 6. appendHardFloorToDirectorBrief · 拼接正确性
// ─────────────────────────────────────────────────────────────────────────

check('appendHardFloor：已有 directorBrief → 追加在末尾', () => {
  const base = { directorBrief: '原 brief：120s 甜蜜场景', episodeDuration: 120 };
  const patched = /** @type {{ directorBrief: string }} */ (
    appendHardFloorToDirectorBrief(base, '追加段')
  );
  return patched.directorBrief.startsWith('原 brief：120s 甜蜜场景') && patched.directorBrief.endsWith('追加段');
});

check('appendHardFloor：无 directorBrief → 直接写入', () => {
  const base = { episodeDuration: 120 };
  const patched = /** @type {{ directorBrief: string }} */ (
    appendHardFloorToDirectorBrief(base, '追加段')
  );
  return patched.directorBrief === '追加段';
});

check('appendHardFloor：非对象 → 返回原值（防御）', () => {
  const r1 = appendHardFloorToDirectorBrief(null, '追加段');
  const r2 = appendHardFloorToDirectorBrief([1, 2, 3], '追加段');
  return r1 === null && Array.isArray(r2);
});

// ─────────────────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────────────────
console.log('');
if (failed === 0) {
  console.log(`[test_editmap_hardgate_v6_hotfix_d] 全部 ${passed} 条用例通过`);
  process.exit(0);
} else {
  console.log(`[test_editmap_hardgate_v6_hotfix_d] ${failed}/${passed + failed} 条用例失败`);
  process.exit(1);
}
