import {
  buildSegmentOwnershipPlan,
  validateEditMapV7Canonical,
} from '../lib/edit_map_v7_contract.mjs';
import { buildDirectorPayloadV6 } from '../lib/sd2_v6_payloads.mjs';

let passed = 0;
let failed = 0;

function assert(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}`, extra ?? '');
  }
}

const nsp = {
  beat_ledger: [
    {
      beat_id: 'BT_001',
      segments: [
        { seg_id: 'SEG_001', segment_type: 'dialogue', speaker: '甲', text: '第一句' },
        { seg_id: 'SEG_002', segment_type: 'dialogue', speaker: '乙', text: '交接句' },
        { seg_id: 'SEG_003', segment_type: 'descriptive', text: '转场动作' },
      ],
      key_visual_actions: [],
      structure_hints: [],
    },
  ],
};

const editMap = {
  blocks: [{ id: 'B01' }, { id: 'B02' }],
  meta: { rhythm_timeline: {} },
  appendix: {
    block_index: [
      {
        block_id: 'B01',
        covered_segment_ids: ['SEG_001', 'SEG_002'],
        must_cover_segment_ids: ['SEG_001'],
        script_chunk_hint: { lead_seg_id: 'SEG_001', tail_seg_id: 'SEG_002' },
      },
      {
        block_id: 'B02',
        covered_segment_ids: ['SEG_002', 'SEG_003'],
        must_cover_segment_ids: ['SEG_002'],
        script_chunk_hint: { lead_seg_id: 'SEG_002', tail_seg_id: 'SEG_003' },
      },
    ],
  },
};

console.log('-- buildSegmentOwnershipPlan');
{
  const result = buildSegmentOwnershipPlan(editMap, nsp);
  assert('ownership plan has no duplicate owner conflict', result.ok === true, result.errors);
  const b01Seg2 = result.plan.find((x) => x.block_id === 'B01' && x.seg_id === 'SEG_002');
  const b02Seg2 = result.plan.find((x) => x.block_id === 'B02' && x.seg_id === 'SEG_002');
  assert('overlap tail in non-owner block is context', b01Seg2?.consumption_role === 'context', b01Seg2);
  assert('must segment in owner block is owned', b02Seg2?.consumption_role === 'owned', b02Seg2);
  assert('owned dialogue can be output', b02Seg2?.allow_dialogue_output === true, b02Seg2);
  assert('context dialogue cannot be output', b01Seg2?.allow_dialogue_output === false, b01Seg2);
}

console.log('-- duplicate owner fails');
{
  const broken = structuredClone(editMap);
  broken.appendix.block_index[0].must_cover_segment_ids.push('SEG_002');
  const result = validateEditMapV7Canonical(broken, nsp, { strict: true });
  assert('same seg_id owned by two blocks fails strict validation', result.ok === false, result.errors);
  assert('error names duplicate owner', result.errors.some((e) => e.includes('duplicate segment owner')), result.errors);
}

console.log('-- payload scriptChunk ownership fields');
{
  const payload = buildDirectorPayloadV6({
    editMap,
    blockId: 'B01',
    normalizedScriptPackage: nsp,
  });
  const seg2 = payload.scriptChunk.segments.find((s) => s.seg_id === 'SEG_002');
  assert('scriptChunk injects consumption_role', seg2?.consumption_role === 'context', seg2);
  assert('scriptChunk injects owner_block_id', seg2?.owner_block_id === 'B02', seg2);
  assert('context segment is not dialogue-output eligible', seg2?.allow_dialogue_output === false, seg2);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
