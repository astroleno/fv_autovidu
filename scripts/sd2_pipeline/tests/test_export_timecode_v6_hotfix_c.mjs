/**
 * SD2 v6.1 · 导出器时间轴推导 · 回归脚本（HOTFIX C）
 *
 * 背景：leji-v6e_pass2 汇总报告中 B05/B09 时间轴显示 `0s–12s`，与 prompt 内真实
 *       时段（B05=48–60s，B09=96–108s）脱节。根因有二：
 *       1) 原正则 `(\d{2})` 拒绝 "00:108" 这种 3 位秒数 → 整段解析失败；
 *       2) timecode 全缺失时从 0 累加 duration_sec，没有回退 EditMap block.time。
 *
 * HOTFIX C 两条：
 *   A) 正则放宽为 `\d{1,4}`，"00:96" 当 96 秒解（与 01:36 等价）；
 *   B) 增加 fallback 链：shots timecode → edit_map_block.time → 累加 duration。
 *
 * 运行：
 *   node scripts/sd2_pipeline/tests/test_export_timecode_v6_hotfix_c.mjs
 * 非零退出表示有用例失败。
 */

import { extractTimeFromShots } from '../export_sd2_final_report.mjs';

/**
 * @typedef {Object} Case
 * @property {string} name          用例名
 * @property {unknown[]} shots      传入的 shots[]
 * @property {{ start_sec?: number, end_sec?: number, duration?: number } | null} emTime
 *   EditMap block.time 兜底；null 表示不传
 * @property {{ start_sec: number, end_sec: number, duration: number }} expect
 *   期望输出
 */

/** @type {Case[]} */
const cases = [
  {
    name: '正常格式：00:00–00:04 / 00:04–00:08 → 0–8s',
    shots: [
      { timecode: '00:00–00:04', duration_sec: 4 },
      { timecode: '00:04–00:08', duration_sec: 4 },
    ],
    emTime: null,
    expect: { start_sec: 0, end_sec: 8, duration: 8 },
  },
  {
    name: 'HOTFIX C-A：00:96–00:108（3 位秒）正则放宽 → 96–108s',
    shots: [{ timecode: '00:96–00:108', duration_sec: 12 }],
    emTime: null,
    expect: { start_sec: 96, end_sec: 108, duration: 12 },
  },
  {
    name: '等价写法：01:36–01:48 → 同样是 96–108s',
    shots: [{ timecode: '01:36–01:48', duration_sec: 12 }],
    emTime: null,
    expect: { start_sec: 96, end_sec: 108, duration: 12 },
  },
  {
    name: 'HOTFIX C-B：timecode 全 null + 有 EditMap block.time → 用 EditMap（leji-v6e_pass2 B05 场景）',
    shots: [
      { timecode: null, duration_sec: 4 },
      { timecode: null, duration_sec: 4 },
      { timecode: null, duration_sec: 4 },
    ],
    emTime: { start_sec: 48, end_sec: 60, duration: 12 },
    expect: { start_sec: 48, end_sec: 60, duration: 12 },
  },
  {
    name: 'timecode 解析失败 + 无 EditMap 兜底 → 从 0 累加 duration（历史兜底）',
    shots: [
      { timecode: 'garbage', duration_sec: 4 },
      { timecode: 'more-garbage', duration_sec: 4 },
    ],
    emTime: null,
    expect: { start_sec: 0, end_sec: 8, duration: 8 },
  },
  {
    name: 'timecode 成功解析时忽略 EditMap 兜底（fallback 优先级正确）',
    shots: [{ timecode: '00:00–00:04', duration_sec: 4 }],
    emTime: { start_sec: 1000, end_sec: 2000, duration: 1000 },
    expect: { start_sec: 0, end_sec: 4, duration: 4 },
  },
  {
    name: '支持中划线（-）与长破折号（—）',
    shots: [
      { timecode: '00:10-00:15', duration_sec: 5 },
      { timecode: '00:15—00:20', duration_sec: 5 },
    ],
    emTime: null,
    expect: { start_sec: 10, end_sec: 20, duration: 10 },
  },
  {
    name: '空 shots + EditMap 兜底',
    shots: [],
    emTime: { start_sec: 100, end_sec: 112, duration: 12 },
    expect: { start_sec: 100, end_sec: 112, duration: 12 },
  },
];

let failed = 0;
for (const c of cases) {
  const got = extractTimeFromShots(c.shots, c.emTime);
  const ok =
    got.start_sec === c.expect.start_sec &&
    got.end_sec === c.expect.end_sec &&
    got.duration === c.expect.duration;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${c.name}`);
  if (!ok) {
    failed += 1;
    console.log(`       期望: ${JSON.stringify(c.expect)}`);
    console.log(`       实际: ${JSON.stringify(got)}`);
  }
}

console.log('');
if (failed === 0) {
  console.log(`[test_export_timecode_v6_hotfix_c] 全部 ${cases.length} 条用例通过`);
  process.exit(0);
} else {
  console.log(`[test_export_timecode_v6_hotfix_c] ${failed}/${cases.length} 条用例失败`);
  process.exit(1);
}
