/**
 * SD2 v6.2 · HOTFIX N · character_token_integrity_check 回归脚本
 *
 * 复现自 leji-v6g B08：
 *   sd2_prompt.FRAME 写成 "赵凯与徐莉相拥" —— 但 assetManifest 只登记了
 *   许倩（秦若岚的丈夫的助手/实习麻醉师）。"徐莉" 纯属 LLM 幻觉。
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_character_whitelist_v6_hotfix_n.mjs
 */

import {
  buildCharacterWhitelist,
  checkCharacterWhitelistForBlock,
  checkCharacterWhitelistForShot,
  extractCharacterCandidates,
} from '../lib/sd2_character_whitelist_v6.mjs';

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

/** leji-v6g 样品：6 人名白名单 */
const editMapInput = {
  assetManifest: {
    characters: [
      { assetName: '医生/护士' },
      { assetName: '许倩' },
      { assetName: '李院长' },
      { assetName: '赵凯母亲' },
      { assetName: '秦若岚' },
      { assetName: '赵凯' },
    ],
  },
};

const scriptChunk = {
  segments: [
    { speaker: null },
    { speaker: '秦若岚' },
    { speaker: '赵凯' },
    { speaker: null },
    { speaker: 'VO' },
  ],
};

console.log('── buildCharacterWhitelist ──');
{
  const wl = buildCharacterWhitelist({ editMapInput, scriptChunk });
  assert('包含 assetManifest 整条 "医生/护士"', wl.has('医生/护士'));
  assert('拆分后包含 "医生"', wl.has('医生'));
  assert('拆分后包含 "护士"', wl.has('护士'));
  assert('包含 "许倩"', wl.has('许倩'));
  assert('包含 "秦若岚"', wl.has('秦若岚'));
  assert('包含 "赵凯"', wl.has('赵凯'));
  assert('不包含 "徐莉" (幻觉名)', !wl.has('徐莉'));
  assert('speaker=VO 被剔除', !wl.has('VO'));
}

console.log('\n── extractCharacterCandidates ──');
{
  const bug = '[FRAME] 分屏：左半屏秦若岚站在办公室门口，右半屏赵凯与徐莉相拥，画面定格。';
  const cands = extractCharacterCandidates(bug);
  assert('提取到 "赵凯"', cands.includes('赵凯'), cands);
  assert('提取到 "徐莉"', cands.includes('徐莉'), cands);

  const bracket = '[FRAME] 赵凯（秦若岚丈夫 医院副院长）坐在办公椅。';
  const cands2 = extractCharacterCandidates(bracket);
  assert('NAME（身份）模式命中 "赵凯"', cands2.includes('赵凯'));

  const dialog = '[FRAME] x\n[DIALOG] 许倩（故作羞涩）：「诶呀」 赵凯：「她知道又怎样」';
  const cands3 = extractCharacterCandidates(dialog);
  assert('DIALOG 段命中 "许倩"', cands3.includes('许倩'), cands3);
  assert('DIALOG 段命中 "赵凯"', cands3.includes('赵凯'), cands3);
}

console.log('\n── checkCharacterWhitelistForShot ──');
{
  const wl = buildCharacterWhitelist({ editMapInput, scriptChunk });
  const good =
    '[FRAME] 中景，秦若岚站立，光线稳定。\n[DIALOG] 秦若岚：「老公，对不起」\n[SFX] 室内低混响';
  const r1 = checkCharacterWhitelistForShot(good, wl);
  assert('全部白名单内 → pass', r1.status === 'pass', r1);

  const bug =
    '[FRAME] 分屏：左半屏秦若岚站在门口，右半屏赵凯与徐莉相拥，画面定格。\n[DIALOG] <silent>\n[SFX] 心跳';
  const r2 = checkCharacterWhitelistForShot(bug, wl);
  assert('含 "徐莉" → fail', r2.status === 'fail', r2);
  assert('unknown_tokens 包含 "徐莉"', r2.unknown_tokens.includes('徐莉'), r2);
}

console.log('\n── checkCharacterWhitelistForBlock 聚合 ──');
{
  const wl = buildCharacterWhitelist({ editMapInput, scriptChunk });
  const okPr = {
    shots: [
      { shot_idx: 0, sd2_prompt: '[FRAME] 秦若岚站立\n[DIALOG] 秦若岚：「好」\n[SFX] x' },
      { shot_idx: 1, sd2_prompt: '[FRAME] 赵凯与许倩相拥\n[DIALOG] <silent>\n[SFX] x' },
    ],
  };
  const ro = checkCharacterWhitelistForBlock(okPr, wl);
  assert('正常 block → pass', ro.status === 'pass', ro);

  const badPr = {
    shots: [
      { shot_idx: 0, sd2_prompt: '[FRAME] 秦若岚站立\n[DIALOG] <silent>\n[SFX] x' },
      { shot_idx: 1, sd2_prompt: '[FRAME] 赵凯与徐莉相拥\n[DIALOG] <silent>\n[SFX] x' },
    ],
  };
  const rb = checkCharacterWhitelistForBlock(badPr, wl);
  assert('B08 复现 → fail', rb.status === 'fail', rb);
  assert('聚合 unknown 含 "徐莉"', rb.unknown_tokens.includes('徐莉'));
  assert('per_shot 有 1 条', rb.per_shot.length === 1, rb);

  const rSkipNoShots = checkCharacterWhitelistForBlock(null, wl);
  assert('prParsed 空 → skip', rSkipNoShots.status === 'skip');

  const rSkipEmptyWl = checkCharacterWhitelistForBlock(badPr, new Set());
  assert('空白名单 → skip', rSkipEmptyWl.status === 'skip', rSkipEmptyWl);
}

console.log('\n── 停用词：医生 / 护士 / 老婆 等不算幻觉 ──');
{
  const wl = buildCharacterWhitelist({ editMapInput, scriptChunk });
  const t =
    '[FRAME] 中景：秦若岚与医生相对而立；近景：护士转身走向走廊。\n[DIALOG] 秦若岚：「老公辛苦了」\n[SFX] 走廊回声';
  const r = checkCharacterWhitelistForShot(t, wl);
  assert('"医生 / 护士 / 老公" 走停用词/白名单 → pass', r.status === 'pass', r);
}

console.log('\n── connector 误伤抑制：物体并列不应被当成人名 ──');
{
  const wl = buildCharacterWhitelist({ editMapInput, scriptChunk });
  const t1 =
    '[FRAME] 近景，几名医生护士愣在原地，手中的病历单、笔掉落在地面。\n[DIALOG] <silent>\n[SFX] 物品掉落声';
  const r1 = checkCharacterWhitelistForShot(t1, wl);
  assert('"病历单、笔掉落" 不应触发未知人名', r1.status === 'pass', r1);

  const t2 =
    '[FRAME] 中景，背景可见办公桌与文件柜，画面保持稳定。\n[DIALOG] <silent>\n[SFX] 室内低混响';
  const r2 = checkCharacterWhitelistForShot(t2, wl);
  assert('"办公桌与文件柜" 不应触发未知人名', r2.status === 'pass', r2);

  const t3 =
    '[FRAME] 近景，目光柔和，表情柔软。\n[DIALOG] 秦若岚：「我知道了」\n[SFX] 呼吸声';
  const r3 = checkCharacterWhitelistForShot(t3, wl);
  assert('"目光柔和 / 表情柔软" 不应触发未知人名', r3.status === 'pass', r3);

  const t4 =
    '[FRAME] 近景，走廊墙面贴的科室指示牌文字模糊（后期叠加字幕），光线稳定。\n[DIALOG] <silent>\n[SFX] 门内模糊说话声，低混响。';
  const r4 = checkCharacterWhitelistForShot(t4, wl);
  assert('"文字模糊（后期叠加字幕）" 不应被 NAME（身份）规则误判成人名', r4.status === 'pass', r4);

  const t5 =
    '[FRAME] 中景，秦若岚戴无框眼镜，抬手和路过的医生点头示意。\n[DIALOG] <silent>\n[SFX] 走廊轻微人声。';
  const r5 = checkCharacterWhitelistForShot(t5, wl);
  assert('"路过的医生" 不应把 "路过" 误判成人名', r5.status === 'pass', r5);
}

console.log(`\n总计：passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
