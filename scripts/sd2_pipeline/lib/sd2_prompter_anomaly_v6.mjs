/**
 * SD2 v6.2 · Prompter 产物异常检测（HOTFIX I）
 *
 * ## 背景
 *
 * leji-v6f 豆包/qwen 实验里观察到两类**单次调用偶发崩溃**，会让某一个 block
 * 的 `prompts/Bxx.json` 实质不可用：
 *
 *   1. **repetition collapse**：LLM 在生成 `global_prefix` 里的"禁词表"时陷入
 *      循环，把同一串"偶像剧、家庭剧、伦理剧…"重复成千上万字符，耗光
 *      max_tokens，导致剩余所有自检字段（`dialogue_fidelity_check`、
 *      `segment_coverage_overall` 等）被截断；
 *   2. **tail field missing**：top-level JSON 语法正确，但 LLM 只写了
 *      `shots` + `global_prefix` 就结束，未输出必备自检字段，pipeline 解析
 *      时 `dialogue_fidelity_check` 等字段全部 `undefined`，下游硬门只能 `skip`。
 *
 * 这两种都是 **单次采样的偶发失败**，最稳健的处置是：
 *
 *   - 在调用链里检测到 → **自动重试 1 次**（新温度，降低陷入同一循环的概率）；
 *   - 若仍失败，则把信号记录到 `hardgateOutcomes`，让 pipeline 按 fail 路径处理。
 *
 * ## 检测规则（保守）
 *
 * - `missingRequiredFields`：`dialogue_fidelity_check` / `segment_coverage_overall` /
 *   `forbidden_words_self_check` 必须至少有 **1 个**存在，否则判 incomplete；
 * - `repetitionCollapse`：`global_prefix.length > 4000` 且存在一个 ≥ 3 字短语在
 *   其内出现 ≥ 20 次——典型数值远超正常产物（正常 prefix 数十~数百字符）；
 * - `shotContractUnderrun`：payload 带 `v5Meta.shotSlots` 时，Prompter 输出的
 *   `shots.length` 不得少于 slot 数；少了说明它合并/吞掉了 Director 分镜。
 * - 其他情况视为正常。
 *
 * ## 为什么不做严格字段白名单
 *
 * Prompter v6 输出结构还在演进，过严的字段清单会出假阳性；保守的"三选一 + prefix
 * 重复炸裂"双检测能覆盖 v6e/v6f 两例真实坏样本，而不会误伤合法产物。
 */

/**
 * 检测 `global_prefix` 是否发生 repetition collapse。
 *
 * 算法：滑动窗口，对 3/4/5/6 字窗口分别统计频次，若任意一个窗口出现 ≥ 20 次
 * 且 `global_prefix.length > 4000`，判定为 collapse。
 *
 * @param {string} globalPrefix
 * @returns {{ detected: boolean, phrase: string, count: number, prefixLength: number }}
 */
export function detectPrefixRepetitionCollapse(globalPrefix) {
  const prefix = typeof globalPrefix === 'string' ? globalPrefix : '';
  const result = {
    detected: false,
    phrase: '',
    count: 0,
    prefixLength: prefix.length,
  };
  if (prefix.length <= 4000) return result;

  // 为效率起见只扫前 20000 字符；实际只关心**纯中文**短语（避免英文/模板字符误伤）
  const scan = prefix.slice(0, 20000);
  for (const winSize of [6, 5, 4, 3]) {
    /** @type {Map<string, number>} */
    const freq = new Map();
    for (let i = 0; i + winSize <= scan.length; i += 1) {
      const win = scan.slice(i, i + winSize);
      // 只统计纯中文短语，且不是"同一字重复"（如 '啊啊啊' 并非真实崩溃模式）
      if (!/^[\u4e00-\u9fff]+$/.test(win)) continue;
      if (new Set(win).size <= 1) continue;
      freq.set(win, (freq.get(win) || 0) + 1);
    }
    for (const [phrase, count] of freq) {
      if (count >= 20) {
        result.detected = true;
        result.phrase = phrase;
        result.count = count;
        return result;
      }
    }
  }
  return result;
}

/**
 * 检测 Prompter 产物是否缺关键自检字段（tail field missing）。
 *
 * 判定：`dialogue_fidelity_check` / `segment_coverage_overall` /
 * `forbidden_words_self_check` 必须至少存在 **1 个**，否则判 incomplete。
 *
 * 不要求三个都在，因为 v6 schema 还在调；保守阈值能兼容后续小改版。
 *
 * @param {unknown} prParsed
 * @returns {{ missing: boolean, presentFields: string[] }}
 */
export function detectTailFieldsMissing(prParsed) {
  const checkFields = [
    'dialogue_fidelity_check',
    'segment_coverage_overall',
    'forbidden_words_self_check',
  ];
  if (!prParsed || typeof prParsed !== 'object' || Array.isArray(prParsed)) {
    return { missing: true, presentFields: [] };
  }
  const p = /** @type {Record<string, unknown>} */ (prParsed);
  const present = checkFields.filter((f) => p[f] !== undefined && p[f] !== null);
  return {
    missing: present.length === 0,
    presentFields: present,
  };
}

/**
 * 检测 Prompter 是否把 Director 的 shotSlots 压缩成了更少的 final shots。
 *
 * @param {unknown} prParsed
 * @param {number | null | undefined} expectedShotCount
 * @returns {{ detected: boolean, actual: number | null, expected: number | null }}
 */
export function detectShotContractUnderrun(prParsed, expectedShotCount) {
  const expected = Number(expectedShotCount);
  const result = {
    detected: false,
    actual: /** @type {number | null} */ (null),
    expected: Number.isFinite(expected) && expected > 0 ? Math.round(expected) : null,
  };
  if (!result.expected) return result;
  if (!prParsed || typeof prParsed !== 'object' || Array.isArray(prParsed)) return result;

  const p = /** @type {Record<string, unknown>} */ (prParsed);
  if (Array.isArray(p.shots)) {
    result.actual = p.shots.length;
  } else if (typeof p.sd2_prompt === 'string') {
    result.actual = (p.sd2_prompt.match(/\[FRAME\]/g) || []).length;
  }

  result.detected = result.actual !== null && result.actual < result.expected;
  return result;
}

/**
 * 综合判定：Prompter 产物是否应该触发"自动重试 1 次"。
 *
 * @param {unknown} prParsed
 * @param {number | null | undefined} [expectedShotCount]
 * @returns {{
 *   shouldRetry: boolean,
 *   reasons: string[],
 *   collapse: ReturnType<typeof detectPrefixRepetitionCollapse>,
 *   tail: ReturnType<typeof detectTailFieldsMissing>,
 *   shotContract: ReturnType<typeof detectShotContractUnderrun>,
 * }}
 */
export function shouldRetryPrompter(prParsed, expectedShotCount = null) {
  const reasons = [];
  const tail = detectTailFieldsMissing(prParsed);
  if (tail.missing) reasons.push('tail_fields_missing');

  const prefix =
    prParsed && typeof prParsed === 'object' && !Array.isArray(prParsed) &&
    typeof /** @type {Record<string, unknown>} */ (prParsed).global_prefix === 'string'
      ? /** @type {string} */ (/** @type {Record<string, unknown>} */ (prParsed).global_prefix)
      : '';
  const collapse = detectPrefixRepetitionCollapse(prefix);
  if (collapse.detected) {
    reasons.push(`prefix_repetition_collapse(${collapse.phrase}×${collapse.count})`);
  }
  const shotContract = detectShotContractUnderrun(prParsed, expectedShotCount);
  if (shotContract.detected) {
    reasons.push(`shot_contract_underrun(${shotContract.actual}<${shotContract.expected})`);
  }

  return {
    shouldRetry: reasons.length > 0,
    reasons,
    collapse,
    tail,
    shotContract,
  };
}
