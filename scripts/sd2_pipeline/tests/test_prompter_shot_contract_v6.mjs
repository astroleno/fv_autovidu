/**
 * SD2 v6 · Prompter shot slot contract regression
 *
 * Director already receives deterministic shotSlots. Prompter must receive the
 * same contract and retry if it compresses several Director slots into fewer
 * final shots.
 *
 * Run:
 *   node scripts/sd2_pipeline/tests/test_prompter_shot_contract_v6.mjs
 */

import {
  buildPrompterPayloadV6,
  extractDirectorMarkdownSectionForBlock,
} from '../lib/sd2_v6_payloads.mjs';
import { shouldRetryPrompter } from '../lib/sd2_prompter_anomaly_v6.mjs';

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

console.log('── Prompter payload inherits shotSlots ──');
{
  const editMap = {
    blocks: [{ id: 'B01', block_id: 'B01', _v3_edit_map_markdown: '### B01' }],
    appendix: {
      block_index: [
        {
          block_id: 'B01',
          start_sec: 0,
          end_sec: 12,
          duration: 12,
          rhythm_tier: 4,
          present_asset_ids: [],
        },
      ],
    },
    meta: {
      video: { aspect_ratio: '16:9', scene_bucket_default: 'dialogue', genre_hint: 'revenge' },
      target_shot_count: { target: 60, tolerance: [51, 69], avg_shot_duration_sec: 2 },
    },
  };
  const payload = buildPrompterPayloadV6({
    editMap,
    blockId: 'B01',
    normalizedScriptPackage: null,
    directorMarkdownSection: '----（2s）[B3] 切镜----画面',
  });
  assert('shotSlots present on Prompter v5Meta', Array.isArray(payload.v5Meta?.shotSlots), payload.v5Meta);
  assert('12s block derives 6 Prompter slots', payload.v5Meta?.shotSlots?.length === 6, payload.v5Meta);
  assert('shotSlotsMeta present', payload.v5Meta?.shotSlotsMeta?.count === 6, payload.v5Meta);
}

console.log('\n── Director markdown extraction accepts heading variants ──');
{
  const md = [
    '### B01 0-12s Hook·黄金开场',
    '----（2s）[B3] 切镜----秦若岚入场',
    '',
    '# B02 分镜稿（12s-21s）',
    '----（2s）[A2] 切镜----医护议论',
    '',
    '> 【B03 | 21s-34s | 副院长办公室】',
    '> ----（1s）[B3] 切镜----门缝窥视',
  ].join('\n');
  const b01 = extractDirectorMarkdownSectionForBlock(md, 'B01');
  const b02 = extractDirectorMarkdownSectionForBlock(md, 'B02');
  const b03 = extractDirectorMarkdownSectionForBlock(md, 'B03');
  assert('extracts ### B01 heading', b01.includes('秦若岚入场') && !b01.includes('医护议论'), b01);
  assert('extracts # B02 heading', b02.includes('医护议论') && !b02.includes('门缝窥视'), b02);
  assert('extracts blockquote B03 heading', b03.includes('门缝窥视'), b03);
}

console.log('\n── Prompter output under shot contract retries ──');
{
  const parsed = {
    shots: [
      { sd2_prompt: '[FRAME] [00:00–00:03] A' },
      { sd2_prompt: '[FRAME] [00:03–00:06] B' },
      { sd2_prompt: '[FRAME] [00:06–00:09] C' },
      { sd2_prompt: '[FRAME] [00:09–00:12] D' },
    ],
    dialogue_fidelity_check: { pass: true },
  };
  const verdict = shouldRetryPrompter(parsed, 6);
  assert('underrun triggers retry', verdict.shouldRetry === true, verdict);
  assert('reason names shot contract underrun', verdict.reasons.includes('shot_contract_underrun(4<6)'), verdict);
}

console.log(`\n总计：passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
