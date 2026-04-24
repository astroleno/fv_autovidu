import {
  resolveRhythmAnchorsForPayloads,
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

const editMap = {
  blocks: [{ id: 'B01' }, { id: 'B02' }, { id: 'B03' }],
  meta: {
    rhythm_timeline: {
      golden_open_3s: {
        anchor_id: 'RT_OPEN_001',
        role: 'golden_open',
        block_id: 'B01',
        required: true,
      },
      mini_climaxes: [
        {
          anchor_id: 'RT_MINI_001',
          role: 'mini_climax',
          seq: 1,
          anchor_block_id: 'B02',
          trigger_source_seg_id: 'SEG_010',
          required: true,
        },
      ],
      major_climax: {
        anchor_id: 'RT_MAJOR_001',
        role: 'major_climax',
        block_id: 'B03',
        trigger_source_seg_id: 'SEG_020',
        required: true,
      },
      closing_hook: {
        anchor_id: 'RT_CLOSE_001',
        role: 'closing_hook',
        block_id: 'B03',
        required: true,
      },
    },
  },
  appendix: {
    block_index: [
      { block_id: 'B01', covered_segment_ids: ['SEG_001'], must_cover_segment_ids: ['SEG_001'] },
      { block_id: 'B02', covered_segment_ids: ['SEG_010'], must_cover_segment_ids: ['SEG_010'] },
      { block_id: 'B03', covered_segment_ids: ['SEG_020'], must_cover_segment_ids: ['SEG_020'] },
    ],
  },
};

const nsp = {
  beat_ledger: [
    {
      beat_id: 'BT_001',
      segments: [
        { seg_id: 'SEG_001', segment_type: 'descriptive', text: '开场' },
        { seg_id: 'SEG_010', segment_type: 'dialogue', text: '小爆点' },
        { seg_id: 'SEG_020', segment_type: 'dialogue', text: '大爆点' },
      ],
      key_visual_actions: [],
      structure_hints: [],
    },
  ],
};

console.log('-- resolveRhythmAnchorsForPayloads');
{
  const payloads = editMap.appendix.block_index.map((row) => ({
    block_id: row.block_id,
    payload: buildDirectorPayloadV6({
      editMap,
      blockId: row.block_id,
      normalizedScriptPackage: nsp,
    }),
  }));
  const resolutions = resolveRhythmAnchorsForPayloads(editMap, { payloads });
  assert('all four required anchors are resolved', resolutions.every((r) => r.resolution_status === 'resolved'), resolutions);
  assert('mini climax without slots maps to anchor_block_id', payloads[1].payload.rhythmTimelineForBlock.role === 'mini_climax', payloads[1].payload.rhythmTimelineForBlock);
  assert('required mini block is not filler', payloads[1].payload.rhythmTimelineForBlock.role !== 'filler');
  assert('payload carries rhythmAnchorResolution', payloads[1].payload.rhythmAnchorResolution?.anchor_id === 'RT_MINI_001', payloads[1].payload.rhythmAnchorResolution);
}

console.log('-- required anchor fail-fast shape');
{
  const broken = structuredClone(editMap);
  broken.meta.rhythm_timeline.major_climax.block_id = 'B99';
  const resolutions = resolveRhythmAnchorsForPayloads(broken, broken.appendix.block_index);
  const major = resolutions.find((r) => r.anchor_id === 'RT_MAJOR_001');
  assert('missing required declared block is unresolved', major?.resolution_status === 'unresolved', major);
  assert('unresolved required anchor reports block error', major?.errors.some((e) => e.includes('declared_block_id')), major);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
