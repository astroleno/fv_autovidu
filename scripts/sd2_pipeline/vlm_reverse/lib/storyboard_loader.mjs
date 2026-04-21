/**
 * 客户分镜 storyboard.json 加载器。
 *
 * 职责：
 *   1) 读取 storyboard.json（由 convert_storyboard.mjs 生成）；
 *   2) 按 [seg_start_s, seg_end_s] 时间窗口，找出与该 seg 有时间交集的客户分镜镜号；
 *   3) 组装一段"客户分镜参考"文本块，注入到 VLM prompt 里作为叙事基调提示。
 *
 * 注：本模块**不做任何结构性改写**。客户分镜仅作参考：
 *   - 若客户分镜与实际视频画面冲突，以实际视频为准；
 *   - 但人物情绪、台词/OSD 文本、场景叙事意图等 VLM 单看画面容易误读的
 *     维度，可借此做基调锚定。
 */

import fs from 'fs';
import path from 'path';

/**
 * @typedef {object} StoryboardShot
 * @property {number} shot_no
 * @property {string} scene_group_key
 * @property {string} 景别
 * @property {string} 机位
 * @property {string} 运镜
 * @property {string} 场景
 * @property {string} 画面描述
 * @property {string} 台词
 * @property {number} 建议时长_s
 * @property {number} cum_start_s
 * @property {number} cum_end_s
 */

/**
 * @typedef {object} StoryboardSceneGroup
 * @property {string} key
 * @property {string} scene
 * @property {string} time
 * @property {string} characters
 * @property {[number, number]} shot_no_range
 */

/**
 * @typedef {object} Storyboard
 * @property {string} source
 * @property {string} title
 * @property {string} generated_at
 * @property {number} total_shots
 * @property {number} total_duration_s
 * @property {StoryboardSceneGroup[]} scene_groups
 * @property {StoryboardShot[]} shots
 */

/**
 * 查找 repoRoot 下默认的 storyboard.json 路径。
 * 优先级：
 *   1) env.VLM_STORYBOARD_JSON（绝对或相对 repoRoot）
 *   2) <repoRoot>/output/sd2/甲方脚本/storyboard.json
 *
 * @param {string} repoRoot
 * @returns {string | null}
 */
export function resolveStoryboardJsonPath(repoRoot) {
  const env = process.env.VLM_STORYBOARD_JSON?.trim();
  if (env) {
    const abs = path.isAbsolute(env) ? env : path.resolve(repoRoot, env);
    return fs.existsSync(abs) ? abs : null;
  }
  const fallback = path.join(repoRoot, 'output/sd2/甲方脚本/storyboard.json');
  return fs.existsSync(fallback) ? fallback : null;
}

/**
 * 加载 storyboard.json。
 *
 * @param {string} jsonPath
 * @returns {Storyboard}
 */
export function loadStoryboard(jsonPath) {
  const text = fs.readFileSync(jsonPath, 'utf8');
  /** @type {Storyboard} */
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.shots)) {
    throw new Error(`storyboard.json 格式异常：${jsonPath}`);
  }
  return data;
}

/**
 * 按时间窗找出与 [startS, endS] 有交集的客户分镜。
 * 判定标准：两段时间段区间相交（!(a.end <= b.start || a.start >= b.end)）。
 * 返回时按 shot_no 升序。
 *
 * @param {Storyboard} sb
 * @param {number} startS
 * @param {number} endS
 * @returns {StoryboardShot[]}
 */
export function findOverlappingShots(sb, startS, endS) {
  /** @type {StoryboardShot[]} */
  const out = [];
  for (const s of sb.shots) {
    if (s.cum_end_s <= startS) continue;
    if (s.cum_start_s >= endS) continue;
    out.push(s);
  }
  return out.sort((a, b) => a.shot_no - b.shot_no);
}

/**
 * 从一批命中的分镜中收集唯一的场景组（用于展示"当前 seg 属于 1-1 走廊 还是 1-2 办公室"）。
 *
 * @param {Storyboard} sb
 * @param {StoryboardShot[]} shots
 * @returns {StoryboardSceneGroup[]}
 */
export function collectSceneGroupsForShots(sb, shots) {
  const keys = new Set(shots.map((s) => s.scene_group_key));
  return sb.scene_groups.filter((g) => keys.has(g.key));
}

/**
 * 把命中的客户分镜组装成一段文本，供 VLM prompt 引用。
 * 约束：
 *   - 必须显式标注"参考仅作叙事基调，最终以实际视频画面为准"；
 *   - 每镜只摘要必要字段（镜号、景别、运镜、画面描述、台词）；
 *   - 若零命中，返回空字符串（调用方不注入此块）。
 *
 * @param {object} ctx
 * @param {number} ctx.segId
 * @param {number} ctx.startS
 * @param {number} ctx.endS
 * @param {StoryboardShot[]} ctx.shots
 * @param {StoryboardSceneGroup[]} [ctx.sceneGroups]
 * @returns {string}
 */
export function formatStoryboardBlockForPrompt({
  segId,
  startS,
  endS,
  shots,
  sceneGroups,
}) {
  if (!shots || shots.length === 0) return '';
  const lines = [];
  lines.push('# 客户分镜参考（仅作叙事基调 / OSD 预期 / 情绪锚定；画面最终以实际视频为准）');
  lines.push(
    `当前片段 seg_${String(segId).padStart(2, '0')} 大致覆盖视频时间轴 ${startS.toFixed(2)}s ~ ${endS.toFixed(2)}s，` +
      `与客户分镜的以下镜号有时间交集：`,
  );
  if (sceneGroups && sceneGroups.length > 0) {
    for (const g of sceneGroups) {
      const chars = g.characters ? ` · 人物：${g.characters}` : '';
      lines.push(`  · 场景组 ${g.key}：${g.scene}${g.time ? `（${g.time}）` : ''}${chars}`);
    }
  }
  for (const s of shots) {
    const dialog = s.台词 && s.台词 !== '无' ? `；台词：${s.台词}` : '';
    lines.push(
      `- 客户镜 ${s.shot_no}（${s.cum_start_s.toFixed(1)}s~${s.cum_end_s.toFixed(1)}s，景别：${s.景别} 运镜：${s.运镜}）：${s.画面描述}${dialog}`,
    );
  }
  lines.push('');
  lines.push(
    '使用规则：',
  );
  lines.push(
    '  1) 以上"客户分镜参考"仅作为**叙事基调/情绪/OSD 文本**的锚定，若与实际视频画面冲突，**一律以视频为准**；',
  );
  lines.push(
    '  2) 若本 seg 只覆盖了上述镜号中的一部分（例如只命中前 1 镜），请**以画面上最接近的那一镜为主**描述，并在 review_reasons 中注明 "seg 可能只对应客户镜 X"；',
  );
  lines.push(
    '  3) 若本 seg 尾部画面跳变、疑似串入"客户镜 Y 以后"的硬切帧，请忽略末端跳变帧，**只按前 70%–80% 的主体镜头判读**，并在 review_reasons 中追加 "尾部疑似带下一镜硬切帧"；',
  );
  lines.push(
    '  4) 若画面内 OSD/人名条/字幕与客户分镜"画面描述"或"台词"里的文字高度对应，**请优先照抄客户原文**（防止漏字/错字），并写入 screen_text 数组。',
  );
  return lines.join('\n');
}
