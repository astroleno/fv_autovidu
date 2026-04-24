/**
 * SD2 v6/v7 · 质量门默认不阻塞回归脚本
 *
 * 真实 leji v7 跑法里，Director 的 segment coverage 低于阈值时仍按硬门
 * exit 8，导致无法完整落盘。默认策略应该是“生成完整结果 + 审计 warning”；
 * 只有显式 --strict-quality-hard 才恢复阻塞。
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_quality_gate_defaults_v6.mjs
 */

import { resolveV6HardgateOptions } from '../lib/sd2_hardgate_options_v6.mjs';

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

console.log('── default: quality gates warn, not block ──');
{
  const opts = resolveV6HardgateOptions({});
  assert('默认 strictQualityHard=false', opts.strictQualityHard === false, opts);
  assert('默认 segment coverage 不阻塞', opts.skipSegHard === true, opts);
  assert('默认 KVA 不阻塞', opts.skipKvaHard === true, opts);
  assert('默认 info density 不阻塞', opts.skipInfoHard === true, opts);
  assert('默认 dialogue fidelity 不阻塞', opts.skipDialogueHard === true, opts);
  assert('默认 dialogue-per-shot 不阻塞', opts.skipDialoguePerShotHard === true, opts);
  assert('默认 character whitelist 不阻塞', opts.skipCharacterWhitelistHard === true, opts);
  assert('默认 prompter selfcheck 不阻塞', opts.skipPrompterSelfHard === true, opts);
  assert('默认 min shots 不阻塞', opts.skipMinShotsHard === true, opts);
}

console.log('\n── strict: explicit flag restores blocking ──');
{
  const opts = resolveV6HardgateOptions({ 'strict-quality-hard': true });
  assert('strictQualityHard=true', opts.strictQualityHard === true, opts);
  assert('strict 下 segment coverage 阻塞', opts.skipSegHard === false, opts);
  assert('strict 下 KVA 阻塞', opts.skipKvaHard === false, opts);
  assert('strict 下 info density 阻塞', opts.skipInfoHard === false, opts);
  assert('strict 下 dialogue fidelity 阻塞', opts.skipDialogueHard === false, opts);
  assert('strict 下 dialogue-per-shot 阻塞', opts.skipDialoguePerShotHard === false, opts);
  assert('strict 下 character whitelist 阻塞', opts.skipCharacterWhitelistHard === false, opts);
  assert('strict 下 prompter selfcheck 阻塞', opts.skipPrompterSelfHard === false, opts);
  assert('strict 下 min shots 阻塞', opts.skipMinShotsHard === false, opts);
}

console.log('\n── allow-v6-soft overrides strict ──');
{
  const opts = resolveV6HardgateOptions({
    'strict-quality-hard': true,
    'allow-v6-soft': true,
  });
  assert('allow-v6-soft 使 segment coverage 降级', opts.skipSegHard === true, opts);
  assert('allow-v6-soft 使 KVA 降级', opts.skipKvaHard === true, opts);
  assert('allow-v6-soft 使 prompter selfcheck 降级', opts.skipPrompterSelfHard === true, opts);
}

console.log(`\n总计：passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
