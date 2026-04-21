/**
 * SD2 v6 · Prompter 自检硬门校验器
 *
 * Prompter v6（`2_SD2Prompter-v6.md §B`）在 output JSON 顶层会输出 6 组自检字段：
 *   - `dialogue_fidelity_check.fidelity_ratio`     对白保真比例（== 1.0 硬门）
 *   - `kva_coverage_ratio`                         P0 KVA 覆盖（== 1.0 硬门）
 *   - `rhythm_density_check.pass`                  节奏密度（true 硬门）
 *   - `five_stage_check[].pass`                    五段式自检（全 true 硬门）
 *   - `climax_signature_check.major_climax.pass`   主高潮签名（true / 不适用算通过）
 *   - `climax_signature_check.closing_hook.pass`   收尾钩子签名（true / 不适用算通过）
 *   - `segment_coverage_overall.pass_l2`           段级覆盖 L2（true 硬门）
 *   - `segment_coverage_overall.pass_l3`           对白段覆盖 L3（true 硬门，dialogue == 1.0）
 *
 * 此模块把上述字段读成结构化结果；编排层在 `call_sd2_block_chain_v6.mjs` 里把
 * fail 结果转成 hardgateOutcome 并按 --skip-prompter-selfcheck-hard /
 * --allow-v6-soft 降级。
 *
 * 注意：dialogue_fidelity / kva_coverage 在 Director 侧也各有一条硬门（分别校验
 *   Prompter 产出的 sd2_prompt 文本和 Director 的 shot_meta），这里校验的是
 *   Prompter LLM 自己的 self-check 口径，两者互补：一个防 LLM 说假话（self-check
 *   通过但文本没照做），一个防 LLM 说真话但不自信（文本照做但 self-check 不报过）。
 */

/**
 * @typedef {Object} PrompterSelfCheckGateResult
 * @property {string} code                    硬门代码（对应 hardgateOutcome.code）
 * @property {'pass'|'fail'|'skip'} status    skip 表示 LLM 未输出此字段
 * @property {string} reason                  失败 / 跳过原因
 * @property {Record<string, unknown>} detail 额外细节（失败节点索引、比值等）
 */

/**
 * 校验 dialogue_fidelity_check.fidelity_ratio == 1.0。
 *
 * Prompter 侧的保真自检：与 `checkPrompterDialogueFidelityV6`（字符级比对
 * sd2_prompt）形成对偶。LLM 可能自我否定（fidelity_ratio 填 <1），此时即使
 * 正文能匹配，也应视作 Prompter 对自己不自信，需要复跑。
 *
 * @param {unknown} prompterResult
 * @returns {PrompterSelfCheckGateResult}
 */
export function checkPrompterSelfDialogueFidelity(prompterResult) {
  if (!prompterResult || typeof prompterResult !== 'object') {
    return { code: 'prompter_self_dialogue_fidelity', status: 'skip', reason: 'no_result', detail: {} };
  }
  const r = /** @type {Record<string, unknown>} */ (prompterResult);
  const chk = /** @type {{ fidelity_ratio?: unknown }} */ (r.dialogue_fidelity_check);
  if (!chk || typeof chk.fidelity_ratio !== 'number') {
    return {
      code: 'prompter_self_dialogue_fidelity',
      status: 'skip',
      reason: 'field_missing',
      detail: {},
    };
  }
  const ratio = chk.fidelity_ratio;
  return {
    code: 'prompter_self_dialogue_fidelity',
    status: ratio === 1 ? 'pass' : 'fail',
    reason: ratio === 1 ? 'ok' : `fidelity_ratio=${ratio} (expect 1.0)`,
    detail: { fidelity_ratio: ratio },
  };
}

/**
 * 校验 kva_coverage_ratio == 1.0（仅当 P0 KVA 存在时）。
 *
 * skipIfNoP0=true 时，若 scriptChunk 中无 P0 KVA，则跳过（由 Director 侧已覆盖此场景）。
 *
 * @param {unknown} prompterResult
 * @param {Record<string, unknown> | null} scriptChunk
 * @returns {PrompterSelfCheckGateResult}
 */
export function checkPrompterSelfKvaCoverage(prompterResult, scriptChunk) {
  if (!prompterResult || typeof prompterResult !== 'object') {
    return { code: 'prompter_self_kva_coverage', status: 'skip', reason: 'no_result', detail: {} };
  }
  const kvas = scriptChunk && Array.isArray(scriptChunk.key_visual_actions)
    ? /** @type {unknown[]} */ (scriptChunk.key_visual_actions)
    : [];
  const p0Count = kvas.filter((k) => {
    if (!k || typeof k !== 'object') return false;
    const priority = /** @type {{ priority?: unknown }} */ (k).priority;
    return priority === 'P0';
  }).length;
  if (p0Count === 0) {
    return {
      code: 'prompter_self_kva_coverage',
      status: 'skip',
      reason: 'no_p0_kva',
      detail: { p0_count: 0 },
    };
  }
  const ratio = /** @type {{ kva_coverage_ratio?: unknown }} */ (prompterResult).kva_coverage_ratio;
  if (typeof ratio !== 'number') {
    return {
      code: 'prompter_self_kva_coverage',
      status: 'skip',
      reason: 'field_missing',
      detail: { p0_count: p0Count },
    };
  }
  return {
    code: 'prompter_self_kva_coverage',
    status: ratio === 1 ? 'pass' : 'fail',
    reason: ratio === 1 ? 'ok' : `kva_coverage_ratio=${ratio} (expect 1.0 with P0 present)`,
    detail: { kva_coverage_ratio: ratio, p0_count: p0Count },
  };
}

/**
 * 校验 rhythm_density_check.pass == true。
 *
 * @param {unknown} prompterResult
 * @returns {PrompterSelfCheckGateResult}
 */
export function checkPrompterSelfRhythmDensity(prompterResult) {
  if (!prompterResult || typeof prompterResult !== 'object') {
    return { code: 'prompter_self_rhythm_density', status: 'skip', reason: 'no_result', detail: {} };
  }
  const chk = /** @type {{ pass?: unknown }} */ (
    /** @type {Record<string, unknown>} */ (prompterResult).rhythm_density_check
  );
  if (!chk || typeof chk.pass !== 'boolean') {
    return {
      code: 'prompter_self_rhythm_density',
      status: 'skip',
      reason: 'field_missing',
      detail: {},
    };
  }
  return {
    code: 'prompter_self_rhythm_density',
    status: chk.pass ? 'pass' : 'fail',
    reason: chk.pass ? 'ok' : 'rhythm_density_check.pass=false',
    detail: { pass: chk.pass },
  };
}

/**
 * 校验 five_stage_check[] 全部 pass == true。
 *
 * @param {unknown} prompterResult
 * @returns {PrompterSelfCheckGateResult}
 */
export function checkPrompterSelfFiveStage(prompterResult) {
  if (!prompterResult || typeof prompterResult !== 'object') {
    return { code: 'prompter_self_five_stage', status: 'skip', reason: 'no_result', detail: {} };
  }
  const arr = /** @type {unknown} */ (
    /** @type {Record<string, unknown>} */ (prompterResult).five_stage_check
  );
  if (!Array.isArray(arr)) {
    return {
      code: 'prompter_self_five_stage',
      status: 'skip',
      reason: 'field_missing',
      detail: {},
    };
  }
  /** @type {string[]} */
  const failed = [];
  for (let i = 0; i < arr.length; i += 1) {
    const it = arr[i];
    if (!it || typeof it !== 'object') continue;
    const pass = /** @type {{ pass?: unknown }} */ (it).pass;
    if (pass === false) {
      const stage = /** @type {{ stage?: unknown }} */ (it).stage;
      failed.push(typeof stage === 'string' ? stage : `idx_${i}`);
    }
  }
  return {
    code: 'prompter_self_five_stage',
    status: failed.length === 0 ? 'pass' : 'fail',
    reason: failed.length === 0 ? 'ok' : `failed_stages=${failed.join(',')}`,
    detail: { failed_stages: failed, total: arr.length },
  };
}

/**
 * 校验 climax_signature_check.major_climax.pass（applicable=false 视作通过 / skip）。
 *
 * @param {unknown} prompterResult
 * @returns {PrompterSelfCheckGateResult}
 */
export function checkPrompterSelfMajorClimax(prompterResult) {
  return readClimaxSignaturePass(prompterResult, 'major_climax', 'prompter_self_major_climax');
}

/**
 * 校验 climax_signature_check.closing_hook.pass（applicable=false 视作通过 / skip）。
 *
 * @param {unknown} prompterResult
 * @returns {PrompterSelfCheckGateResult}
 */
export function checkPrompterSelfClosingHook(prompterResult) {
  return readClimaxSignaturePass(prompterResult, 'closing_hook', 'prompter_self_closing_hook');
}

/**
 * major_climax / closing_hook 自检读取器（两者字段形态一致）。
 *
 * @param {unknown} prompterResult
 * @param {'major_climax'|'closing_hook'} slot
 * @param {string} code
 * @returns {PrompterSelfCheckGateResult}
 */
function readClimaxSignaturePass(prompterResult, slot, code) {
  if (!prompterResult || typeof prompterResult !== 'object') {
    return { code, status: 'skip', reason: 'no_result', detail: {} };
  }
  const cs = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (prompterResult).climax_signature_check || {}
  );
  const node = cs[slot];
  if (!node || typeof node !== 'object') {
    return { code, status: 'skip', reason: 'field_missing', detail: {} };
  }
  const n = /** @type {Record<string, unknown>} */ (node);
  if (n.applicable === false) {
    return { code, status: 'skip', reason: 'not_applicable', detail: { applicable: false } };
  }
  if (typeof n.pass !== 'boolean') {
    return { code, status: 'skip', reason: 'pass_missing', detail: {} };
  }
  return {
    code,
    status: n.pass ? 'pass' : 'fail',
    reason: n.pass ? 'ok' : `${slot}.pass=false`,
    detail: {
      applicable: n.applicable,
      pass: n.pass,
      strategy: typeof n.strategy === 'string' ? n.strategy : null,
      shot_idx: typeof n.shot_idx === 'number' ? n.shot_idx : null,
      hit_elements: Array.isArray(n.hit_elements) ? n.hit_elements : null,
    },
  };
}

/**
 * 校验 segment_coverage_overall.pass_l2 和 pass_l3 分别成立。
 *
 * pass_l2：全段覆盖比例 ≥ 阈值（Prompter-v6 规定 v6.0=0.90，v6.1=0.95，LLM 自己算）。
 * pass_l3：dialogue_like_coverage == 1.0。
 *
 * 两者分别作为独立硬门（方便降级）。
 *
 * @param {unknown} prompterResult
 * @returns {{ l2: PrompterSelfCheckGateResult, l3: PrompterSelfCheckGateResult }}
 */
export function checkPrompterSelfSegmentCoverage(prompterResult) {
  /** @type {PrompterSelfCheckGateResult} */
  const fallbackSkip = {
    code: 'prompter_self_segment_l2',
    status: 'skip',
    reason: 'no_result',
    detail: {},
  };
  if (!prompterResult || typeof prompterResult !== 'object') {
    return {
      l2: fallbackSkip,
      l3: { ...fallbackSkip, code: 'prompter_self_segment_l3' },
    };
  }
  const overall = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (prompterResult).segment_coverage_overall || {}
  );
  const ratio = typeof overall.coverage_ratio === 'number' ? overall.coverage_ratio : null;
  const dlgRatio = typeof overall.dialogue_like_coverage === 'number' ? overall.dialogue_like_coverage : null;
  const passL2 = typeof overall.pass_l2 === 'boolean' ? overall.pass_l2 : null;
  const passL3 = typeof overall.pass_l3 === 'boolean' ? overall.pass_l3 : null;

  /** @type {PrompterSelfCheckGateResult} */
  const l2Result = passL2 === null
    ? { code: 'prompter_self_segment_l2', status: 'skip', reason: 'pass_l2_missing', detail: {} }
    : {
        code: 'prompter_self_segment_l2',
        status: passL2 ? 'pass' : 'fail',
        reason: passL2 ? 'ok' : `coverage_ratio=${ratio ?? '?'} pass_l2=false`,
        detail: { coverage_ratio: ratio, pass_l2: passL2, missing_segments: Array.isArray(overall.missing_segments) ? overall.missing_segments : [] },
      };

  /** @type {PrompterSelfCheckGateResult} */
  const l3Result = passL3 === null
    ? { code: 'prompter_self_segment_l3', status: 'skip', reason: 'pass_l3_missing', detail: {} }
    : {
        code: 'prompter_self_segment_l3',
        status: passL3 ? 'pass' : 'fail',
        reason: passL3 ? 'ok' : `dialogue_like_coverage=${dlgRatio ?? '?'} pass_l3=false`,
        detail: { dialogue_like_coverage: dlgRatio, pass_l3: passL3 },
      };

  return { l2: l2Result, l3: l3Result };
}

/**
 * 批量运行全部 Prompter 自检硬门。
 *
 * 返回的数组顺序稳定：dialogue_fidelity / kva_coverage / rhythm_density /
 * five_stage / major_climax / closing_hook / segment_l2 / segment_l3。
 *
 * @param {unknown} prompterResult
 * @param {Record<string, unknown> | null} scriptChunk
 * @returns {PrompterSelfCheckGateResult[]}
 */
export function runAllPrompterSelfChecks(prompterResult, scriptChunk) {
  const seg = checkPrompterSelfSegmentCoverage(prompterResult);
  return [
    checkPrompterSelfDialogueFidelity(prompterResult),
    checkPrompterSelfKvaCoverage(prompterResult, scriptChunk),
    checkPrompterSelfRhythmDensity(prompterResult),
    checkPrompterSelfFiveStage(prompterResult),
    checkPrompterSelfMajorClimax(prompterResult),
    checkPrompterSelfClosingHook(prompterResult),
    seg.l2,
    seg.l3,
  ];
}
