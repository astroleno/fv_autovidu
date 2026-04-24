import {
  normalizeGenreBiasV7,
  normalizeRhythmTimelineV7,
  recomputeDialogueCharCountsInNormalizedPackage,
  validateEditMapV7Canonical,
} from '../lib/edit_map_v7_contract.mjs';

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

function makeNsp() {
  return {
    beat_ledger: [
      {
        beat_id: 'BT_001',
        segments: [
          { seg_id: 'SEG_001', segment_type: 'descriptive', text: '开场' },
          { seg_id: 'SEG_002', segment_type: 'dialogue', speaker: '甲', text: '你来了' },
          { seg_id: 'SEG_008', segment_type: 'dialogue', speaker: '乙', text: '真相是他藏的' },
        ],
        key_visual_actions: [
          {
            kva_id: 'KVA_001',
            source_seg_id: 'SEG_001',
            action_type: 'signature_entrance',
            priority: 'P0',
          },
        ],
      },
    ],
  };
}

function makeEditMap() {
  return {
    markdown_body: '',
    appendix: {
      meta: {
        style_inference: {
          genre_bias: {
            value: 'short_drama_contrast_hook',
            confidence: 'mid',
            evidence: [{ type: 'segment', seg_id: 'SEG_002', quote: '你来了' }],
          },
          rendering_style: { value: '3D写实动画' },
          tone_bias: { value: 'high_contrast' },
        },
        rhythm_timeline: {
          golden_open_3s: { anchor_id: 'RT_OPEN_001', block: 'B01', required: true },
          mini_climaxes: [
            {
              anchor_id: 'RT_MINI_001',
              seq: 1,
              block: 'B02',
              trigger: 'SEG_008',
              at_sec: 12,
              confidence: 'mid',
              evidence: [{ type: 'segment', seg_id: 'SEG_008', quote: '真相' }],
            },
          ],
          major_climax: {
            anchor_id: 'RT_MAJOR_001',
            block: 'B02',
            required: true,
            trigger_source_seg_id: 'SEG_008',
          },
          closing_hook: { anchor_id: 'RT_CLOSE_001', block: 'B02', required: true },
        },
      },
      block_index: [
        {
          block_id: 'B01',
          covered_segment_ids: ['SEG_001', 'SEG_002'],
          must_cover_segment_ids: ['SEG_001'],
          script_chunk_hint: { lead_seg_id: 'SEG_001', tail_seg_id: 'SEG_002' },
        },
        {
          block_id: 'B02',
          covered_segment_ids: ['SEG_008'],
          must_cover_segment_ids: ['SEG_008'],
          script_chunk_hint: { lead_seg_id: 'SEG_008', tail_seg_id: 'SEG_008' },
        },
      ],
    },
  };
}

console.log('-- normalizeGenreBiasV7');
{
  const result = normalizeGenreBiasV7({
    genre_bias: { value: 'short_drama_contrast_hook', confidence: 'mid', evidence: [] },
  });
  assert('legacy value alias normalizes into primary', result.genre_bias.primary === 'short_drama_contrast_hook');
  assert('canonical genre_bias does not keep value', !('value' in result.genre_bias), result.genre_bias);
  assert('compat adapter records the alias use', result.compat_adapters.some((x) => x.name === 'genre_bias_value_alias'));
}

console.log('-- normalizeRhythmTimelineV7');
{
  const normalized = normalizeRhythmTimelineV7(makeEditMap().appendix.meta.rhythm_timeline, [
    { block_id: 'B01' },
    { block_id: 'B02' },
  ]);
  assert('golden open legacy block becomes block_id', normalized.rhythm_timeline.golden_open_3s.block_id === 'B01');
  assert('mini legacy block becomes anchor_block_id', normalized.rhythm_timeline.mini_climaxes[0].anchor_block_id === 'B02');
  assert('mini legacy trigger becomes trigger_source_seg_id', normalized.rhythm_timeline.mini_climaxes[0].trigger_source_seg_id === 'SEG_008');
  assert('normalization records warnings for legacy fields', normalized.warnings.length >= 2, normalized.warnings);
}

console.log('-- validateEditMapV7Canonical');
{
  const result = validateEditMapV7Canonical(makeEditMap(), makeNsp(), { strict: true });
  assert('valid fixture passes strict contract', result.ok === true, result.errors);
  assert('normalized top-level meta is synchronized from appendix.meta', result.normalized.meta?.style_inference?.genre_bias?.primary === 'short_drama_contrast_hook');
  assert('contract report includes rhythm anchor resolution', Array.isArray(result.report.rhythm_anchor_resolution));
  assert('contract report includes segment ownership plan', Array.isArray(result.report.segment_ownership_plan));
  assert('contract report includes KVA consumption plan', Array.isArray(result.report.kva_consumption_plan));
}

console.log('-- recomputeDialogueCharCountsInNormalizedPackage');
{
  const pkg = {
    beat_ledger: [
      {
        beat_id: 'BT_001',
        segments: [
          {
            seg_id: 'SEG_010',
            segment_type: 'dialogue',
            speaker: '甲',
            text: '走吧！ OK?',
            dialogue_char_count: 99,
          },
          {
            seg_id: 'SEG_011',
            segment_type: 'vo',
            spoken_text: 'A B，去。',
            text: '旁白：A B，去。',
          },
          {
            seg_id: 'SEG_012',
            segment_type: 'descriptive',
            text: '她转身。',
            dialogue_char_count: 8,
          },
        ],
      },
    ],
  };
  const report = recomputeDialogueCharCountsInNormalizedPackage(pkg);
  assert('dialogue count strips whitespace and punctuation', pkg.beat_ledger[0].segments[0].dialogue_char_count === 4, pkg.beat_ledger[0].segments[0]);
  assert('spoken_text has priority over text', pkg.beat_ledger[0].segments[1].dialogue_char_count === 3, pkg.beat_ledger[0].segments[1]);
  assert('non-dialogue segment count is zero', pkg.beat_ledger[0].segments[2].dialogue_char_count === 0, pkg.beat_ledger[0].segments[2]);
  assert('LLM value is retained only in debug', pkg.beat_ledger[0].segments[0].debug.llm_dialogue_char_count === 99, pkg.beat_ledger[0].segments[0]);
  assert('beat_dialogue_char_count is recomputed', pkg.beat_ledger[0].beat_dialogue_char_count === 7, pkg.beat_ledger[0]);
  assert('report records corrected segments', report.corrected_segments.length === 2, report);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
