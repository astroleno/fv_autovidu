/**
 * HOTFIX L · max_dialogue_per_shot 硬门
 * HOTFIX M · 块局部 min_shots_per_block 硬门
 *
 * 背景：leji-v6g B16 把尾部 14 个 segment、8 条对白硬塞进 14s 的 2 个镜头里
 *  （含一个 7s 镜头塞 7 条对白），虽然 segment_coverage / dialogue_fidelity 都
 *   是绿的，但实际完全无法被 T2V 渲染出来——Goodhart's Law：指标通过但现实失败。
 *
 * 纯函数检测：
 *   L. 每个 shot 的 [DIALOG] 段独立对白行 ≤ 2（<silent>/<sfx>/<bgm> 不计）
 *   M. 对 segment 数较多的 block，shots.length ≥ max(2, ceil(segs/4))
 *
 * 不含 IO / LLM，完全可测。
 */

/**
 * 统计单个 shot 内 [DIALOG] 段的"独立对白行数"。
 *
 * 规则：
 *   · 只扫描 [DIALOG] 与下一个 [SFX] / [BGM] 之间的正文
 *   · `<silent>` / `<static>` / `<no_dialog>` / 空字符串 → 0 条
 *   · 对白以"NAME：「...」"或"NAME：「...」"形式出现；也兼容"NAME（...）：「...」"
 *   · 使用宽松计数：出现 `：「` 或 `:「` 的次数作为独立对白行数
 *
 * @param {string} sd2Prompt
 * @returns {number}
 */
export function countDialogueLinesInShot(sd2Prompt) {
  if (!sd2Prompt || typeof sd2Prompt !== 'string') return 0;
  const dialogStartIdx = sd2Prompt.indexOf('[DIALOG]');
  if (dialogStartIdx < 0) return 0;
  let dialogEndIdx = sd2Prompt.length;
  for (const marker of ['[SFX]', '[BGM]']) {
    const idx = sd2Prompt.indexOf(marker, dialogStartIdx + 8);
    if (idx >= 0 && idx < dialogEndIdx) dialogEndIdx = idx;
  }
  const body = sd2Prompt.slice(dialogStartIdx + '[DIALOG]'.length, dialogEndIdx).trim();
  if (!body) return 0;
  if (/^<(?:silent|static|no_dialog|mute|none)>\s*$/i.test(body)) return 0;

  const quoteMatches = body.match(/[：:]\s*[「"]/g);
  if (quoteMatches && quoteMatches.length > 0) return quoteMatches.length;

  const lines = body
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^<[^>]+>$/.test(s));
  return lines.length;
}

/**
 * HOTFIX L · 对整个 Prompter 产物做 max_dialogue_per_shot 检查。
 *
 * @param {{ shots?: Array<{ shot_idx?: number, sd2_prompt?: string }> } | null | undefined} prParsed
 * @param {number} [maxPerShot]
 * @returns {{
 *   status: 'pass' | 'fail' | 'skip',
 *   reason: string,
 *   max_per_shot: number,
 *   offenders: Array<{ shot_idx: number, dialogue_count: number }>,
 * }}
 */
export function checkMaxDialoguePerShot(prParsed, maxPerShot = 2) {
  if (!prParsed || typeof prParsed !== 'object' || !Array.isArray(prParsed.shots) || prParsed.shots.length === 0) {
    return { status: 'skip', reason: 'no_shots', max_per_shot: maxPerShot, offenders: [] };
  }
  /** @type {Array<{ shot_idx: number, dialogue_count: number }>} */
  const offenders = [];
  for (let i = 0; i < prParsed.shots.length; i += 1) {
    const shot = prParsed.shots[i];
    if (!shot || typeof shot !== 'object') continue;
    const sp = typeof shot.sd2_prompt === 'string' ? shot.sd2_prompt : '';
    const count = countDialogueLinesInShot(sp);
    if (count > maxPerShot) {
      offenders.push({
        shot_idx: typeof shot.shot_idx === 'number' ? shot.shot_idx : i,
        dialogue_count: count,
      });
    }
  }
  if (offenders.length === 0) {
    return { status: 'pass', reason: `all shots ≤ ${maxPerShot} dialogues`, max_per_shot: maxPerShot, offenders: [] };
  }
  const worst = offenders.slice().sort((a, b) => b.dialogue_count - a.dialogue_count)[0];
  return {
    status: 'fail',
    reason: `shot ${worst.shot_idx} has ${worst.dialogue_count} dialogue lines (> ${maxPerShot})`,
    max_per_shot: maxPerShot,
    offenders,
  };
}

/**
 * HOTFIX M · block 局部 min_shots 硬下限。
 *
 * 策略：shots.length ≥ max(minShotsFloor, ceil(seg_count / segsPerShotCeil))
 * 例：seg_count=14 / segsPerShotCeil=4 → ceil(14/4)=4，即至少 4 个 shot
 *
 * @param {{ shots?: unknown[] } | null | undefined} prParsed
 * @param {number} segmentCount
 * @param {{ minShotsFloor?: number, segsPerShotCeil?: number }} [opts]
 * @returns {{
 *   status: 'pass' | 'fail' | 'skip',
 *   reason: string,
 *   required: number,
 *   actual: number,
 *   seg_count: number,
 * }}
 */
export function checkMinShotsPerBlock(prParsed, segmentCount, opts = {}) {
  const minShotsFloor = typeof opts.minShotsFloor === 'number' && opts.minShotsFloor > 0 ? opts.minShotsFloor : 2;
  const segsPerShotCeil = typeof opts.segsPerShotCeil === 'number' && opts.segsPerShotCeil > 0 ? opts.segsPerShotCeil : 4;
  if (!prParsed || typeof prParsed !== 'object' || !Array.isArray(prParsed.shots)) {
    return { status: 'skip', reason: 'no_shots', required: minShotsFloor, actual: 0, seg_count: segmentCount || 0 };
  }
  const segCount = Number.isFinite(segmentCount) && segmentCount > 0 ? Math.floor(segmentCount) : 0;
  if (segCount <= 0) {
    return { status: 'skip', reason: 'no_seg_count', required: minShotsFloor, actual: prParsed.shots.length, seg_count: 0 };
  }
  const required = Math.max(minShotsFloor, Math.ceil(segCount / segsPerShotCeil));
  const actual = prParsed.shots.length;
  if (actual >= required) {
    return { status: 'pass', reason: `shots=${actual} ≥ required=${required}`, required, actual, seg_count: segCount };
  }
  return {
    status: 'fail',
    reason: `shots=${actual} < required=${required} (seg=${segCount}, ceil(seg/${segsPerShotCeil}))`,
    required,
    actual,
    seg_count: segCount,
  };
}
