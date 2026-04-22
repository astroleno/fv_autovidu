/**
 * Stage 1.5 · Scene Architect v1 · 回归脚本
 *
 * 覆盖契约（见 prompt/1_SD2Workflow/1_5_SceneArchitect/1_5_SceneArchitect-v1.md）：
 *   1. buildSceneArchitectPayload
 *      · 从 EditMap + normalized_script_package 正确铺平 KVA / block_index / segments
 *   2. validateSceneArchitectOutput
 *      · at_sec 超 ±3s 容差 → 回退 draft
 *      · at_sec 越块边界 → 回退 draft
 *      · mini_climaxes 条目数不一致 → 整段回退 draft
 *      · kva_arrangements 跨 beat 建议 → 回退到 source_seg 所在块
 *      · 非法 suggested_shot_role → 置 null
 *      · LLM 返回非对象 → 产出安全降级版本
 *   3. applySceneArchitectToEditMap
 *      · meta.rhythm_timeline_original 保留 draft
 *      · meta.rhythm_timeline 更新为 sanitized
 *      · meta.rhythm_adjustments 追加不覆盖
 *      · appendix.block_index[].kva_suggestions 按块正确分组
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_scene_architect_v1.mjs
 * 非零退出表示有用例失败。
 */
import {
  buildSceneArchitectPayload,
  validateSceneArchitectOutput,
  applySceneArchitectToEditMap,
} from '../lib/sd2_scene_architect_payload.mjs';

let passed = 0;
let failed = 0;

/** @param {string} name @param {boolean} cond @param {unknown} [extra] */
function assert(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}`);
    if (extra !== undefined) console.log('    extra:', extra);
  }
}

/**
 * 最小 EditMap fixture：B01..B03 三块，带 rhythm_timeline 含一条 mini + major。
 *
 * @returns {Record<string, unknown>}
 */
function makeEditMapFixture() {
  return {
    meta: {
      video: { aspect_ratio: '9:16' },
      style_inference: {
        rendering_style: 'photoreal',
        tone_bias: 'suspense',
        genre_bias: 'short_drama_contrast_hook',
      },
      rhythm_timeline: {
        derived_from: { duration_sec: 30 },
        golden_open_3s: {
          block_id: 'B01',
          must_show: ['开场硬钩'],
          covered_segment_ids: ['SEG_001'],
        },
        mini_climaxes: [
          {
            seq: 1,
            at_sec_derived: 14,
            at_sec_final: 14,
            duration_sec: 6,
            block_id: 'B02',
            motif: 'info_gap_control',
            trigger_source_seg_id: 'SEG_005',
            five_stage: {
              trigger: { shot_idx_hint: 1, desc: '线索出现' },
              amplify: { shot_idx_hint: 2, desc: '放大' },
              pivot: { shot_idx_hint: 3, desc: '翻转' },
              payoff: { shot_idx_hint: 4, desc: '兑现' },
              residue: { shot_idx_hint: 5, desc: '余韵' },
            },
          },
        ],
        major_climax: {
          seq: 1,
          at_sec_derived: 24,
          at_sec_final: 24,
          duration_sec: 5,
          block_id: 'B03',
          motif: 'reveal',
          trigger_source_seg_id: 'SEG_010',
          five_stage: {
            trigger: { shot_idx_hint: 1, desc: '揭露前夜' },
            amplify: { shot_idx_hint: 2, desc: '推进' },
            pivot: { shot_idx_hint: 3, desc: '决定' },
            payoff: { shot_idx_hint: 4, desc: '爆发' },
            residue: { shot_idx_hint: 5, desc: '收束' },
          },
        },
        closing_hook: { block_id: 'B03', must_show: ['勾子'] },
      },
    },
    appendix: {
      block_index: [
        {
          block_id: 'B01',
          start_sec: 0,
          end_sec: 5,
          duration: 5,
          scene_name: '街角',
          covered_segment_ids: ['SEG_001', 'SEG_002'],
          shot_budget_hint: { target: 2, tolerance: [2, 3] },
        },
        {
          block_id: 'B02',
          start_sec: 5,
          end_sec: 20,
          duration: 15,
          scene_name: '办公室',
          covered_segment_ids: ['SEG_003', 'SEG_004', 'SEG_005'],
          shot_budget_hint: { target: 5, tolerance: [4, 6] },
        },
        {
          block_id: 'B03',
          start_sec: 20,
          end_sec: 30,
          duration: 10,
          scene_name: '走廊',
          covered_segment_ids: ['SEG_006', 'SEG_007', 'SEG_010'],
          shot_budget_hint: { target: 4, tolerance: [3, 5] },
        },
      ],
    },
  };
}

/**
 * 最小 normalized_script_package fixture：两个 beat，三条 KVA。
 *
 * @returns {Record<string, unknown>}
 */
function makeNspFixture() {
  return {
    beat_ledger: [
      {
        beat_id: 'BT_001',
        segments: [
          { seg_id: 'SEG_001', segment_type: 'descriptive', speaker: null, text: '开场' },
          { seg_id: 'SEG_002', segment_type: 'dialogue', speaker: '甲', text: '你是谁' },
        ],
        key_visual_actions: [
          {
            kva_id: 'KVA_001',
            source_seg_id: 'SEG_001',
            action_type: 'signature_entrance',
            summary: '入场亮相',
            required_shot_count_min: 1,
            required_structure_hints: ['low_angle'],
            priority: 'P0',
          },
        ],
      },
      {
        beat_id: 'BT_002',
        segments: [
          { seg_id: 'SEG_005', segment_type: 'dialogue', speaker: '乙', text: '秘密会议' },
          { seg_id: 'SEG_010', segment_type: 'descriptive', speaker: null, text: '揭露' },
        ],
        key_visual_actions: [
          {
            kva_id: 'KVA_002',
            source_seg_id: 'SEG_005',
            action_type: 'discovery_reveal',
            summary: '门口偷听',
            required_shot_count_min: 1,
            required_structure_hints: ['cross_cut'],
            priority: 'P0',
          },
          {
            kva_id: 'KVA_003',
            source_seg_id: 'SEG_010',
            action_type: 'reaction_turn',
            summary: '回头',
            required_shot_count_min: 1,
            required_structure_hints: ['pan_to_face'],
            priority: 'P1',
          },
        ],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildSceneArchitectPayload
// ─────────────────────────────────────────────────────────────────────────────
console.log('-- buildSceneArchitectPayload');
{
  const em = makeEditMapFixture();
  const nsp = makeNspFixture();
  const p = buildSceneArchitectPayload(em, nsp, { duration_sec: 30, episode_id: 'ep01' });

  assert('block_index_compact 有 3 块', Array.isArray(p.block_index_compact) && p.block_index_compact.length === 3);
  assert('KVA 条目全部铺平（3 条）', Array.isArray(p.key_visual_actions) && p.key_visual_actions.length === 3);
  assert('segments_compact 覆盖全部 4 条', Array.isArray(p.segments_compact) && p.segments_compact.length === 4);
  assert(
    'KVA 带 beat_id（审计字段）',
    Array.isArray(p.key_visual_actions) && /** @type {Record<string, unknown>} */ (p.key_visual_actions[0]).beat_id === 'BT_001',
  );
  assert('rhythm_timeline_draft 直接引用自 meta', p.rhythm_timeline_draft === em.meta.rhythm_timeline);
}

// ─────────────────────────────────────────────────────────────────────────────
// validateSceneArchitectOutput · rhythm at_sec 的 ±3s 容差
// ─────────────────────────────────────────────────────────────────────────────
console.log('-- validateSceneArchitectOutput · rhythm');
{
  const em = makeEditMapFixture();
  const nsp = makeNspFixture();
  const payload = buildSceneArchitectPayload(em, nsp, { duration_sec: 30, episode_id: 'ep01' });

  /**
   * 情形 1：LLM 将 mini[0].at_sec 从 14 改到 12（delta=-2，仍在 B02 [5,20]），应采纳。
   * 情形 2：major at_sec 从 24 改到 30（delta=+6 超 ±3），应回退 24。
   */
  const raw = {
    rhythm_timeline: {
      golden_open_3s: em.meta.rhythm_timeline.golden_open_3s,
      closing_hook: em.meta.rhythm_timeline.closing_hook,
      mini_climaxes: [
        {
          seq: 1,
          at_sec: 12,
          block_id: 'B02',
          motif: 'info_gap_control',
          trigger_source_seg_id: 'SEG_005',
          five_stage: {
            trigger: { shot_idx_hint: 1, desc: 'LLM 的触发描述' },
            amplify: { shot_idx_hint: 2, desc: '放大' },
            pivot: { shot_idx_hint: 3, desc: '翻转' },
            payoff: { shot_idx_hint: 4, desc: '兑现' },
            residue: { shot_idx_hint: 5, desc: '余韵' },
          },
        },
      ],
      major_climax: {
        seq: 1,
        at_sec: 30,
        block_id: 'B03',
        motif: 'reveal',
        trigger_source_seg_id: 'SEG_010',
        five_stage: em.meta.rhythm_timeline.major_climax.five_stage,
      },
    },
    rhythm_adjustments: [
      { target: 'mini[0].at_sec', before_sec: 14, after_sec: 12, delta_sec: -2, reason: 'align seg_005' },
    ],
    kva_arrangements: [],
  };

  const { sanitized, issues } = validateSceneArchitectOutput(raw, payload);
  const mini0 = /** @type {Record<string, unknown>} */ (sanitized.rhythm_timeline.mini_climaxes[0]);
  const major = /** @type {Record<string, unknown>} */ (sanitized.rhythm_timeline.major_climax);

  assert('mini[0].at_sec=12（容差内被采纳）', mini0.at_sec === 12);
  assert('mini[0].at_sec_draft=14 审计留存', mini0.at_sec_draft === 14);
  assert('mini[0].five_stage.trigger.desc 采用 LLM 更新', /** @type {Record<string, unknown>} */ (mini0.five_stage).trigger.desc === 'LLM 的触发描述');
  assert('major.at_sec 回退 24（超 ±3s）', major.at_sec === 24);
  assert('issues 含 major 超容差说明', issues.some((x) => x.includes('major.at_sec')));
}

// ─────────────────────────────────────────────────────────────────────────────
// validateSceneArchitectOutput · mini 条目数不一致 → 整段回退
// ─────────────────────────────────────────────────────────────────────────────
console.log('-- validateSceneArchitectOutput · length mismatch fallback');
{
  const em = makeEditMapFixture();
  const nsp = makeNspFixture();
  const payload = buildSceneArchitectPayload(em, nsp, { duration_sec: 30, episode_id: 'ep01' });

  const raw = {
    rhythm_timeline: {
      mini_climaxes: [],
      major_climax: em.meta.rhythm_timeline.major_climax,
    },
    rhythm_adjustments: [],
    kva_arrangements: [],
  };
  const { sanitized, issues } = validateSceneArchitectOutput(raw, payload);
  assert(
    'length mismatch 时 mini_climaxes 回退到 draft',
    Array.isArray(sanitized.rhythm_timeline.mini_climaxes) &&
      sanitized.rhythm_timeline.mini_climaxes.length === 1,
  );
  assert('issues 记录 length mismatch', issues.some((x) => x.includes('length mismatch')));
}

// ─────────────────────────────────────────────────────────────────────────────
// validateSceneArchitectOutput · KVA 跨 beat 自动纠偏
// ─────────────────────────────────────────────────────────────────────────────
console.log('-- validateSceneArchitectOutput · kva_arrangements');
{
  const em = makeEditMapFixture();
  const nsp = makeNspFixture();
  const payload = buildSceneArchitectPayload(em, nsp, { duration_sec: 30, episode_id: 'ep01' });

  const raw = {
    rhythm_timeline: em.meta.rhythm_timeline,
    rhythm_adjustments: [],
    kva_arrangements: [
      { kva_id: 'KVA_001', suggested_block_id: 'B01', suggested_shot_role: 'opening_beat', rationale: 'ok' },
      { kva_id: 'KVA_002', suggested_block_id: 'B03', suggested_shot_role: 'reveal_shot', rationale: 'wrong' },
      { kva_id: 'KVA_003', suggested_block_id: 'B03', suggested_shot_role: 'not_a_role', rationale: 'bad role' },
    ],
  };
  const { sanitized, issues } = validateSceneArchitectOutput(raw, payload);
  const arr = /** @type {Array<Record<string, unknown>>} */ (sanitized.kva_arrangements);
  assert('kva_arrangements 与输入等长', arr.length === 3);
  assert('KVA_001 合法 block 保留', arr[0].suggested_block_id === 'B01');
  assert('KVA_002 跨 beat 被回退为真值 B02', arr[1].suggested_block_id === 'B02');
  assert('KVA_003 非法 role 被置 null', arr[2].suggested_shot_role === null);
  assert('issues 记录 cross-beat 告警', issues.some((x) => x.includes('KVA_002') || x.includes('source_seg=SEG_005')));
}

// ─────────────────────────────────────────────────────────────────────────────
// validateSceneArchitectOutput · LLM 返回非对象
// ─────────────────────────────────────────────────────────────────────────────
console.log('-- validateSceneArchitectOutput · null guard');
{
  const em = makeEditMapFixture();
  const nsp = makeNspFixture();
  const payload = buildSceneArchitectPayload(em, nsp, { duration_sec: 30, episode_id: 'ep01' });

  const { sanitized, issues } = validateSceneArchitectOutput(null, payload);
  assert('null 输入降级到草案 rhythm_timeline', sanitized.rhythm_timeline === em.meta.rhythm_timeline);
  assert('null 输入仍生成 3 条 kva_arrangements', sanitized.kva_arrangements.length === 3);
  assert('issues 含 not a JSON object', issues.some((x) => x.includes('not a JSON object')));
}

// ─────────────────────────────────────────────────────────────────────────────
// applySceneArchitectToEditMap · 并列回灌
// ─────────────────────────────────────────────────────────────────────────────
console.log('-- applySceneArchitectToEditMap');
{
  const em = makeEditMapFixture();
  const nsp = makeNspFixture();
  const payload = buildSceneArchitectPayload(em, nsp, { duration_sec: 30, episode_id: 'ep01' });

  const raw = {
    rhythm_timeline: {
      golden_open_3s: em.meta.rhythm_timeline.golden_open_3s,
      closing_hook: em.meta.rhythm_timeline.closing_hook,
      mini_climaxes: [
        {
          seq: 1,
          at_sec: 13,
          block_id: 'B02',
          motif: 'info_gap_control',
          trigger_source_seg_id: 'SEG_005',
          five_stage: em.meta.rhythm_timeline.mini_climaxes[0].five_stage,
        },
      ],
      major_climax: {
        seq: 1,
        at_sec: 25,
        block_id: 'B03',
        motif: 'reveal',
        trigger_source_seg_id: 'SEG_010',
        five_stage: em.meta.rhythm_timeline.major_climax.five_stage,
      },
    },
    rhythm_adjustments: [
      { target: 'mini[0].at_sec', before_sec: 14, after_sec: 13, delta_sec: -1, reason: 'align' },
      { target: 'major.at_sec', before_sec: 24, after_sec: 25, delta_sec: 1, reason: 'climax pull later' },
    ],
    kva_arrangements: [
      { kva_id: 'KVA_001', suggested_block_id: 'B01', suggested_shot_role: 'opening_beat', rationale: 'x' },
      { kva_id: 'KVA_002', suggested_block_id: 'B02', suggested_shot_role: 'reveal_shot', rationale: 'x' },
      { kva_id: 'KVA_003', suggested_block_id: 'B03', suggested_shot_role: 'reaction_shot', rationale: 'x' },
    ],
  };
  const { sanitized } = validateSceneArchitectOutput(raw, payload);

  const originalRhythm = em.meta.rhythm_timeline;
  applySceneArchitectToEditMap(em, sanitized);

  assert('rhythm_timeline_original 保留 draft', em.meta.rhythm_timeline_original === originalRhythm);
  assert('rhythm_timeline 已更新', em.meta.rhythm_timeline !== originalRhythm);
  assert('mini[0].at_sec=13 写入', em.meta.rhythm_timeline.mini_climaxes[0].at_sec === 13);
  assert('rhythm_adjustments 追加 2 条', Array.isArray(em.meta.rhythm_adjustments) && em.meta.rhythm_adjustments.length === 2);

  const bi = /** @type {Array<Record<string, unknown>>} */ (em.appendix.block_index);
  const b01 = bi.find((b) => b.block_id === 'B01');
  const b02 = bi.find((b) => b.block_id === 'B02');
  const b03 = bi.find((b) => b.block_id === 'B03');
  assert('B01.kva_suggestions 有 KVA_001', Array.isArray(b01.kva_suggestions) && b01.kva_suggestions.length === 1);
  assert('B02.kva_suggestions 有 KVA_002', Array.isArray(b02.kva_suggestions) && b02.kva_suggestions.length === 1);
  assert('B03.kva_suggestions 有 KVA_003', Array.isArray(b03.kva_suggestions) && b03.kva_suggestions.length === 1);

  // 幂等二次应用（scanner 场景下不应炸掉草案）
  const oldOriginal = em.meta.rhythm_timeline_original;
  const { sanitized: sanitized2 } = validateSceneArchitectOutput(raw, payload);
  applySceneArchitectToEditMap(em, sanitized2);
  assert('rhythm_timeline_original 保持首次草案（不被覆盖）', em.meta.rhythm_timeline_original === oldOriginal);
  assert(
    'rhythm_adjustments 再次追加（2+2=4）',
    Array.isArray(em.meta.rhythm_adjustments) && em.meta.rhythm_adjustments.length === 4,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
