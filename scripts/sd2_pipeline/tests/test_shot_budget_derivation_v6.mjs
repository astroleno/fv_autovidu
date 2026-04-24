/**
 * SD2 v6 · missing shot_budget_hint derivation
 *
 * v7 EditMap may omit block-level shot_budget_hint. In that case the block
 * chain still needs deterministic shotSlots, otherwise the model drifts to
 * coarse 3-4s shots. Derive a budget from block duration and avg shot seconds.
 *
 * Run:
 *   node scripts/sd2_pipeline/tests/test_shot_budget_derivation_v6.mjs
 */

import { planShotSlotsFromBlockIndex } from '../lib/shot_slot_planner.mjs';

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

console.log('── derive missing shot_budget_hint ──');
{
  const r = planShotSlotsFromBlockIndex(
    { block_id: 'B01', duration: 12, rhythm_tier: 4 },
    false,
    { minShotSec: 1, avgShotSec: 2 },
  );
  assert('missing hint still returns slots', Boolean(r), r);
  assert('12s at avg 2s derives 6 shots', r?.slots.length === 6, r);
  assert('duration sums to block duration', r?.slots.reduce((a, s) => a + s.duration_sec, 0) === 12, r);
}

console.log('\n── explicit shot_budget_hint still wins ──');
{
  const r = planShotSlotsFromBlockIndex(
    { block_id: 'B02', duration: 12, rhythm_tier: 3, shot_budget_hint: { target: 4, tolerance: [3, 5] } },
    false,
    { minShotSec: 1, avgShotSec: 2 },
  );
  assert('explicit target is preserved', r?.slots.length === 4, r);
}

console.log(`\n总计：passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
