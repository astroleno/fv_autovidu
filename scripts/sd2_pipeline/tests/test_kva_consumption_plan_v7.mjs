import { applySceneArchitectToEditMap } from '../lib/sd2_scene_architect_payload.mjs';
import { buildKvaConsumptionPlan } from '../lib/edit_map_v7_contract.mjs';
import { buildDirectorPayloadV6 } from '../lib/sd2_v6_payloads.mjs';
import { deriveHasKvaFromScriptChunk } from '../lib/knowledge_slices_v6.mjs';

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

function makeEditMap() {
  return {
    blocks: [{ id: 'B01' }, { id: 'B02' }],
    meta: {},
    appendix: {
      block_index: [
        { block_id: 'B01', covered_segment_ids: ['SEG_001'], must_cover_segment_ids: ['SEG_001'] },
        { block_id: 'B02', covered_segment_ids: ['SEG_004'], must_cover_segment_ids: ['SEG_004'] },
      ],
    },
  };
}

const nsp = {
  beat_ledger: [
    {
      beat_id: 'BT_001',
      segments: [
        { seg_id: 'SEG_001', segment_type: 'descriptive', text: '开场镜头' },
        { seg_id: 'SEG_004', segment_type: 'descriptive', text: '招牌入场动作' },
      ],
      key_visual_actions: [
        {
          kva_id: 'KVA_001',
          source_seg_id: 'SEG_004',
          source_block_id: 'B02',
          action_type: 'signature_entrance',
          priority: 'P0',
          summary: '女主招牌式入场',
        },
      ],
      structure_hints: [],
    },
  ],
};

console.log('-- buildKvaConsumptionPlan fallback');
{
  const result = buildKvaConsumptionPlan(makeEditMap(), nsp);
  assert('fallback assigns KVA to source block', result.plan[0].assigned_block_id === 'B02', result.plan);
  assert('fallback source block is traceable', result.plan[0].source_block_id === 'B02', result.plan);
}

console.log('-- Scene Architect routing feeds payload');
{
  const editMap = makeEditMap();
  applySceneArchitectToEditMap(editMap, {
    rhythm_timeline: {},
    rhythm_adjustments: [],
    kva_arrangements: [
      {
        kva_id: 'KVA_001',
        source_seg_id: 'SEG_004',
        priority: 'P0',
        suggested_block_id: 'B01',
        suggested_shot_role: 'opening_beat',
        rationale: 'signature entrance belongs to golden open',
      },
    ],
  });
  const plan = buildKvaConsumptionPlan(editMap, nsp);
  assert('Scene Architect assignment routes KVA to B01', plan.plan[0].assigned_block_id === 'B01', plan.plan);
  assert('cross-block route has routing reason', typeof plan.plan[0].routing_reason === 'string' && plan.plan[0].routing_reason.length > 0, plan.plan[0]);

  const b01 = buildDirectorPayloadV6({ editMap, blockId: 'B01', normalizedScriptPackage: nsp });
  const b02 = buildDirectorPayloadV6({ editMap, blockId: 'B02', normalizedScriptPackage: nsp });
  assert('assigned block receives routed KVA', b01.scriptChunk.key_visual_actions.some((k) => k.kva_id === 'KVA_001'), b01.scriptChunk.key_visual_actions);
  assert('source block gets trace note instead of KVA denominator', b02.scriptChunk.kva_trace_notes.some((x) => x.kva_id === 'KVA_001' && x.status === 'routed_elsewhere'), b02.scriptChunk.kva_trace_notes);
  assert('has_kva follows assigned block', deriveHasKvaFromScriptChunk(b01.scriptChunk) === true && deriveHasKvaFromScriptChunk(b02.scriptChunk) === false);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
