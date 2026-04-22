/**
 * SD2 v6.2 · HOTFIX L + M · 镜头结构硬门回归脚本
 *
 * L (max_dialogue_per_shot)：每个 shot 内 [DIALOG] 段独立对白行 ≤ maxPerShot
 *   复现自 leji-v6g B16 第二 shot 塞 7 条对白（7 秒 14 秒内）。
 * M (min_shots_per_block)：shots.length ≥ max(minShotsFloor, ceil(seg_count / segsPerShotCeil))
 *   复现自 leji-v6g B16（14 segment / 8 dialogue 被压成 2 shot / 14 秒）。
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_shot_structure_v6_hotfix_lm.mjs
 */

import {
  checkMaxDialoguePerShot,
  checkMinShotsPerBlock,
  countDialogueLinesInShot,
} from '../lib/sd2_shot_structure_v6.mjs';

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

console.log('── HOTFIX L · countDialogueLinesInShot 基础用例 ──');
{
  assert('空字符串 → 0', countDialogueLinesInShot('') === 0);
  assert('无 [DIALOG] 段 → 0', countDialogueLinesInShot('[FRAME] xxx [SFX] yyy') === 0);
  assert(
    '<silent> → 0',
    countDialogueLinesInShot('[FRAME] xxx\n[DIALOG] <silent>\n[SFX] yyy') === 0,
  );

  const single = '[FRAME] 中景\n[DIALOG] 秦若岚：「谢谢你」\n[SFX] 走廊回声\n[BGM] bond';
  assert('单条独立对白 → 1', countDialogueLinesInShot(single) === 1);

  const two = '[FRAME] 中景\n[DIALOG] 赵凯：「好」 许倩（故作羞涩）：「嗯」\n[SFX] 无';
  assert('两条对白（同行内联）→ 2', countDialogueLinesInShot(two) === 2, { two });

  // leji-v6g B16 第二 shot 复现：7 条连续对白
  const b16 =
    '[FRAME] 中景\n[DIALOG] 许倩（羞涩）：「你干嘛」 赵凯：「她知道又怎样」 许倩：「什么时候娶我」 赵凯：「先别急」 许倩：「嗯」 赵凯：「宝贝」 许倩：「好」\n[SFX] 心跳';
  assert('B16 复现 7 条对白', countDialogueLinesInShot(b16) === 7, countDialogueLinesInShot(b16));
}

console.log('\n── HOTFIX L · checkMaxDialoguePerShot 聚合 ──');
{
  const r0 = checkMaxDialoguePerShot(null);
  assert('prParsed 空 → skip', r0.status === 'skip', r0);

  const okPr = {
    shots: [
      { shot_idx: 0, sd2_prompt: '[FRAME] x\n[DIALOG] 秦若岚：「好」\n[SFX] y' },
      { shot_idx: 1, sd2_prompt: '[FRAME] x\n[DIALOG] <silent>\n[SFX] y' },
    ],
  };
  const rOk = checkMaxDialoguePerShot(okPr, 2);
  assert('全部 ≤ 2 → pass', rOk.status === 'pass', rOk);

  const badPr = {
    shots: [
      { shot_idx: 0, sd2_prompt: '[FRAME] x\n[DIALOG] 秦若岚：「a」 赵凯：「b」 许倩：「c」\n[SFX]' },
    ],
  };
  const rBad = checkMaxDialoguePerShot(badPr, 2);
  assert('3 条 / 上限 2 → fail', rBad.status === 'fail', rBad);
  assert('offenders 非空', Array.isArray(rBad.offenders) && rBad.offenders.length === 1);
  assert('offender.dialogue_count=3', rBad.offenders[0].dialogue_count === 3);
}

console.log('\n── HOTFIX M · checkMinShotsPerBlock 基础用例 ──');
{
  const r0 = checkMinShotsPerBlock(null, 10);
  assert('prParsed 空 → skip', r0.status === 'skip');

  const rNoSeg = checkMinShotsPerBlock({ shots: [{}, {}] }, 0);
  assert('seg_count=0 → skip', rNoSeg.status === 'skip', rNoSeg);

  // 2 segment → required = max(2, ceil(2/4)) = 2 → 2 shots 刚好 pass
  const rSmall = checkMinShotsPerBlock({ shots: [{}, {}] }, 2);
  assert('2 seg / 2 shot → pass', rSmall.status === 'pass', rSmall);

  // 14 segment → required = max(2, ceil(14/4)) = 4；只有 2 shot → fail
  const rB16 = checkMinShotsPerBlock({ shots: [{}, {}] }, 14);
  assert('B16 复现 14 seg / 2 shot → fail', rB16.status === 'fail', rB16);
  assert('required = 4', rB16.required === 4, rB16);
  assert('actual = 2', rB16.actual === 2);

  // 14 segment / 4 shot → pass
  const rB16Fixed = checkMinShotsPerBlock({ shots: [{}, {}, {}, {}] }, 14);
  assert('14 seg / 4 shot → pass', rB16Fixed.status === 'pass', rB16Fixed);

  // 自定义 segsPerShotCeil=3 → 14 seg 需要 5 shot
  const rStrict = checkMinShotsPerBlock({ shots: [{}, {}, {}, {}] }, 14, { segsPerShotCeil: 3 });
  assert('segsPerShotCeil=3 / 14 seg / 4 shot → fail', rStrict.status === 'fail', rStrict);
  assert('required = 5', rStrict.required === 5);
}

console.log(`\n总计：passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
