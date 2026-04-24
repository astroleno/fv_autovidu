/**
 * SD2 v6 · prompt 资产标签本地修复回归脚本
 *
 * 真实 leji v7 输出中，Prompter 给了 assetTagMapping，但 sd2_prompt 正文仍写
 * 裸角色名 / 场景名，导致 final report 的 assets_used_tags 为空。v5/v6 契约要求
 * prompt 正文直接使用 @图N（资产名）。
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_prompt_asset_repair_v6.mjs
 */

import {
  repairAssetTagReferences,
  sanitizeTextOverlayNegations,
  normalizeShotTimecodes,
  polishShortDramaRhythmLanguage,
} from '../lib/sd2_prompt_repair_v6.mjs';

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

console.log('── repairAssetTagReferences ──');
{
  const mapping = [
    { tag: '@图1', asset_id: '秦若岚', description: '秦若岚' },
    { tag: '@图2', asset_id: '医生/护士', description: '医生/护士' },
    { tag: '@图3', asset_id: '医院走廊', description: '医院走廊' },
  ];
  const src = [
    '真人电影，冷调偏青',
    '',
    '[FRAME] 中景，秦若岚戴无框眼镜，站在医院走廊，抬手和路过的医生点头示意。',
    '[DIALOG] 秦若岚：「谢谢你」',
    '[SFX] 走廊低混响',
    '[BGM] tension',
  ].join('\n');
  const r = repairAssetTagReferences(src, mapping);
  assert('正文补入秦若岚标签', r.sd2Prompt.includes('@图1（秦若岚）戴无框眼镜'), r);
  assert('正文补入医生/护士标签', r.sd2Prompt.includes('@图2（医生/护士）点头示意'), r);
  assert('正文补入医院走廊标签', r.sd2Prompt.includes('@图3（医院走廊）'), r);
  assert('补入全局资产声明段', r.sd2Prompt.includes('资产参考：@图1（秦若岚），@图2（医生/护士），@图3（医院走廊）'), r.sd2Prompt);
  assert('返回 declaration 供 global_prefix 使用', r.declaration === '资产参考：@图1（秦若岚），@图2（医生/护士），@图3（医院走廊）', r);
  assert('返回 inserted_tags', r.inserted_tags.length === 3, r);
}

console.log('\n── location aliases keep readable Chinese context ──');
{
  const mapping = [{ tag: '@图3', asset_id: '医院大楼', description: '医院大楼' }];
  const src = '[FRAME] 大全景，东南亚私立医院大楼外观，玻璃幕墙反射天光。';
  const r = repairAssetTagReferences(src, mapping);
  assert('不会生成“私立@图”式断句', !r.sd2Prompt.includes('私立@图3'), r.sd2Prompt);
  assert('地点资产以参考方式补 tag', r.sd2Prompt.includes('私立医院大楼（参考@图3（医院大楼））外观'), r.sd2Prompt);
}

console.log('\n── declaration can be handled by caller ──');
{
  const mapping = [{ tag: '@图1', asset_id: '秦若岚', description: '秦若岚' }];
  const src = '[FRAME] 秦若岚站在门口。\n[DIALOG] <silent>';
  const r = repairAssetTagReferences(src, mapping, { injectDeclaration: false });
  assert('正文仍补标签', r.sd2Prompt.includes('@图1（秦若岚）站在门口'), r);
  assert('正文不插入资产声明', !/^资产参考：/m.test(r.sd2Prompt), r.sd2Prompt);
  assert('declaration 单独返回', r.declaration === '资产参考：@图1（秦若岚）', r);
}

console.log('\n── no double tagging ──');
{
  const mapping = [{ tag: '@图1', asset_id: '赵凯', description: '赵凯' }];
  const src = '[FRAME] 近景，@图1（赵凯）站在门口。\n[DIALOG] @图1（赵凯）：「她知道又怎样」';
  const r = repairAssetTagReferences(src, mapping);
  assert('不会重复 @图1（赵凯）', !r.sd2Prompt.includes('@图1（@图1（赵凯））'), r.sd2Prompt);
}

console.log('\n── sanitizeTextOverlayNegations ──');
{
  const src = [
    '[FRAME] 中景，人物清晰。',
    '[DIALOG] <silent>',
    '[SFX] 室内低混响',
    '[BGM] suspense',
    '',
    '无多余可读文字，画面清晰，电影级质感',
  ].join('\n');
  const r = sanitizeTextOverlayNegations(src);
  assert('去掉可读文字负向描述', !/可读文字/.test(r.sd2Prompt), r);
  assert('保留画质正向描述', /画面清晰，电影级质感/.test(r.sd2Prompt), r);
}

console.log('\n── normalizeShotTimecodes ──');
{
  const shots = [
    { sd2_prompt: '[FRAME] [00:68-00:70] 中景，平视，固定镜头——赵凯看向门口。' },
    { sd2_prompt: '[FRAME] [00:70-00:73] 近景，平视，固定镜头——秦若岚沉默。' },
    { sd2_prompt: '[FRAME] [00:73-00:76] 特写，平视，固定镜头——手指收紧。' },
  ];
  const r = normalizeShotTimecodes(shots, { start_sec: 68, end_sec: 77, duration: 9 });
  assert('修正非法 00:68 时间码', shots[0].sd2_prompt.includes('[01:08–01:11]'), shots);
  assert('按 block 时长连续分配', shots[2].sd2_prompt.includes('[01:14–01:17]'), shots);
  assert('返回 changed 计数', r.changed === 3, r);
}

console.log('\n── polishShortDramaRhythmLanguage ──');
{
  const src = [
    '[FRAME] [00:00–00:03] 中景，平视，固定镜头——赵凯看向门口。',
    '[DIALOG] <silent>',
    '[SFX] x',
    '[BGM] tension',
    '',
    '[FRAME] [00:03–00:06] 近景，平视，固定镜头——秦若岚沉默。',
    '',
    '[FRAME] [00:06–00:09] 中近景，平视，固定，冷高反差光——她站在门外。',
  ].join('\n');
  const r = polishShortDramaRhythmLanguage(src);
  assert('减少平视固定镜头模板', !r.sd2Prompt.includes('中景，平视，固定镜头'), r.sd2Prompt);
  assert('加入短剧压迫/推进镜头语法', /推近|压迫|反打|窥视/.test(r.sd2Prompt), r.sd2Prompt);
  assert('返回 replacements', r.replacements >= 2, r);
}

console.log(`\n总计：passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
