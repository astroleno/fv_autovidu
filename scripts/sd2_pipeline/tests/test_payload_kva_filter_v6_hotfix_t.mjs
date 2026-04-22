/**
 * SD2 v6.2 · payload scriptChunk KVA 过滤（HOTFIX T）· 回归脚本
 *
 * 背景：leji-v6-apimart-sa-doubao 实跑暴露一条 P0 级假阳性硬门链：
 *
 *   - Normalizer 的 beat_ledger[i].key_visual_actions[] 是"整 beat 的 KVA
 *     视图"，而一个 beat 在短剧里常跨 5–12 个 block（例如 BT_002 同时覆盖
 *     B04…B16，KVA 分散在 SEG_036 / SEG_053 / SEG_055 / SEG_061 四个段落）；
 *   - buildScriptChunkForBlock 按 beatIdsHit 聚合 KVA 时，没有二次过滤
 *     `source_seg_id ∈ covered_segment_ids`，结果给 B07（covered=SEG_020-024）
 *     的 scriptChunk 里塞了 KVA_002/003/004/005 这 4 条（它们分别属于
 *     B10/B13/B14/B16）；
 *   - Director LLM 看到本 block 有 4 条 P0 KVA 不得不填 kva_consumption_report，
 *     全写 `consumed_at_shot=null, deferred_to_block=...`；
 *   - 硬门 checkDirectorKvaCoverageV6 发现 hasP0=true、consumed=0 → 假 fail。
 *
 *   实测（leji-v6-apimart-sa-doubao · 2026-04-22）：
 *     director_kva_coverage @ B07/B09/B12 三块全部因此误报，占本轮 7 项硬
 *     失败中的 3 项。
 *
 * 修复原则：
 *   - scriptChunk 只讲"本 block 分内事"。一条 KVA 归 B07 当且仅当它的
 *     source_seg_id 落在 B07 的 covered_segment_ids 中；
 *   - 有 beatIdsHit 但 source_seg_id 不在本 block 的 KVA 一律丢弃（它们会
 *     在自己的 block 里被正确消费）；
 *   - structure_hints 的归属字段多样（有时是 location_seg_id、有时是
 *     target_beat_id），本 hotfix 先不动；Director 对 structure_hints 的
 *     硬门仅看 `split_screen / freeze_frame` 的消费，与"硬门误报"无关。
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_payload_kva_filter_v6_hotfix_t.mjs
 * 非零退出表示有用例失败。
 */

import { buildDirectorPayloadV6, buildPrompterPayloadV6 } from '../lib/sd2_v6_payloads.mjs';

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
// Fixture · 最小可复现 beat 跨 block 场景
//   - BT_002 覆盖 SEG_020…SEG_055（分散在 B07 / B10 / B14）；
//   - 只有 B14 应该拿到 KVA_004（source=SEG_055）；B07 / B10 都不应拿到任何 KVA。
// ──────────────────────────────────────────────────────────────────
const editMap = {
  blocks: [
    { id: 'B07', _v3_edit_map_markdown: '' },
    { id: 'B10', _v3_edit_map_markdown: '' },
    { id: 'B14', _v3_edit_map_markdown: '' },
  ],
  meta: {
    video: { aspect_ratio: '16:9' },
    rendering_style: '真人电影',
  },
  appendix: {
    block_index: [
      {
        block_id: 'B07',
        covered_segment_ids: ['SEG_020', 'SEG_021', 'SEG_022', 'SEG_023'],
        script_chunk_hint: {
          lead_seg_id: 'SEG_020',
          tail_seg_id: 'SEG_023',
          overflow_policy: 'push_to_next_block',
        },
        must_cover_segment_ids: ['SEG_020'],
      },
      {
        block_id: 'B10',
        covered_segment_ids: ['SEG_035', 'SEG_036'],
        script_chunk_hint: { lead_seg_id: 'SEG_035', tail_seg_id: 'SEG_036' },
      },
      {
        block_id: 'B14',
        covered_segment_ids: ['SEG_054', 'SEG_055'],
        script_chunk_hint: { lead_seg_id: 'SEG_054', tail_seg_id: 'SEG_055' },
      },
    ],
  },
};

const normalizedPackage = {
  beat_ledger: [
    {
      beat_id: 'BT_002',
      segments: [
        { seg_id: 'SEG_020', segment_type: 'descriptive', text: '走廊脚步声起' },
        { seg_id: 'SEG_021', segment_type: 'dialogue', speaker: '护士A', text: '这人谁啊' },
        { seg_id: 'SEG_022', segment_type: 'descriptive', text: '秦若岚回头' },
        { seg_id: 'SEG_023', segment_type: 'dialogue', speaker: '秦若岚', text: '走吧' },
        { seg_id: 'SEG_035', segment_type: 'descriptive', text: '办公室门口' },
        { seg_id: 'SEG_036', segment_type: 'descriptive', text: '秦若岚推门进入' },
        { seg_id: 'SEG_054', segment_type: 'dialogue', speaker: '许倩', text: '凯哥~' },
        { seg_id: 'SEG_055', segment_type: 'dialogue', speaker: '赵凯', text: '你才是我的宝贝' },
      ],
      key_visual_actions: [
        {
          kva_id: 'KVA_002',
          source_seg_id: 'SEG_036',
          priority: 'P0',
          action_type: 'discovery_reveal',
          summary: '秦若岚推门进入办公室',
        },
        {
          kva_id: 'KVA_004',
          source_seg_id: 'SEG_055',
          priority: 'P0',
          action_type: 'betrayal_reveal',
          summary: '赵凯抚摸许倩肚子',
        },
      ],
      structure_hints: [],
    },
  ],
};

console.log('── HOTFIX T · buildDirectorPayloadV6: scriptChunk.key_visual_actions 只含本 block ──');
{
  const b07 = buildDirectorPayloadV6({
    editMap,
    blockId: 'B07',
    normalizedScriptPackage: normalizedPackage,
  });
  const kvas07 = (b07.scriptChunk && b07.scriptChunk.key_visual_actions) || [];
  assert('B07 scriptChunk.key_visual_actions 为空（无 KVA source 落入）', kvas07.length === 0, {
    got: kvas07.map((k) => k.kva_id),
  });

  const b10 = buildDirectorPayloadV6({
    editMap,
    blockId: 'B10',
    normalizedScriptPackage: normalizedPackage,
  });
  const kvas10 = (b10.scriptChunk && b10.scriptChunk.key_visual_actions) || [];
  assert(
    'B10 scriptChunk.key_visual_actions 仅含 KVA_002',
    kvas10.length === 1 && kvas10[0].kva_id === 'KVA_002',
    { got: kvas10.map((k) => k.kva_id) },
  );

  const b14 = buildDirectorPayloadV6({
    editMap,
    blockId: 'B14',
    normalizedScriptPackage: normalizedPackage,
  });
  const kvas14 = (b14.scriptChunk && b14.scriptChunk.key_visual_actions) || [];
  assert(
    'B14 scriptChunk.key_visual_actions 仅含 KVA_004',
    kvas14.length === 1 && kvas14[0].kva_id === 'KVA_004',
    { got: kvas14.map((k) => k.kva_id) },
  );
}

console.log('── HOTFIX T · buildPrompterPayloadV6: 同等过滤口径 ──');
{
  const b07 = buildPrompterPayloadV6({
    editMap,
    blockId: 'B07',
    normalizedScriptPackage: normalizedPackage,
  });
  const kvas07 = (b07.scriptChunk && b07.scriptChunk.key_visual_actions) || [];
  assert('Prompter B07 scriptChunk.key_visual_actions 为空', kvas07.length === 0, {
    got: kvas07.map((k) => k.kva_id),
  });

  const b14 = buildPrompterPayloadV6({
    editMap,
    blockId: 'B14',
    normalizedScriptPackage: normalizedPackage,
  });
  const kvas14 = (b14.scriptChunk && b14.scriptChunk.key_visual_actions) || [];
  assert(
    'Prompter B14 scriptChunk.key_visual_actions 仅含 KVA_004',
    kvas14.length === 1 && kvas14[0].kva_id === 'KVA_004',
    { got: kvas14.map((k) => k.kva_id) },
  );
}

console.log('── HOTFIX T · 兜底：KVA 缺 source_seg_id 时保留（保守策略，避免漏塞真 KVA）──');
{
  const em = JSON.parse(JSON.stringify(editMap));
  const nsp = JSON.parse(JSON.stringify(normalizedPackage));
  nsp.beat_ledger[0].key_visual_actions.push({
    kva_id: 'KVA_999',
    // 注意：无 source_seg_id（老版 Normalizer 产物，或 LLM 填空）
    priority: 'P0',
    action_type: 'unknown',
    summary: '古早版 KVA 没填 source',
  });

  // 只要一个 block 捡到这条即可（当前实现：beat 命中该 block → 保留），
  // 这里断言 B07 / B10 / B14 三者之一能拿到，避免真 KVA 被吞掉。
  const b07 = buildDirectorPayloadV6({ editMap: em, blockId: 'B07', normalizedScriptPackage: nsp });
  const b10 = buildDirectorPayloadV6({ editMap: em, blockId: 'B10', normalizedScriptPackage: nsp });
  const b14 = buildDirectorPayloadV6({ editMap: em, blockId: 'B14', normalizedScriptPackage: nsp });
  const ids07 = (b07.scriptChunk.key_visual_actions || []).map((k) => k.kva_id);
  const ids10 = (b10.scriptChunk.key_visual_actions || []).map((k) => k.kva_id);
  const ids14 = (b14.scriptChunk.key_visual_actions || []).map((k) => k.kva_id);
  const all = [...ids07, ...ids10, ...ids14];
  const kept = all.filter((id) => id === 'KVA_999').length;
  assert(
    '无 source_seg_id 的 KVA_999 至少在一个 block 中保留（不因 hotfix 被误删）',
    kept >= 1,
    { b07: ids07, b10: ids10, b14: ids14 },
  );
}

console.log(`\n总计 PASS=${passed} FAIL=${failed}`);
process.exit(failed === 0 ? 0 : 1);
