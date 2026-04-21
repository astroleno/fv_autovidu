/**
 * 客户分镜常用运镜词 → SD2 官方白名单单值的映射表。
 *
 * 用途：
 *   1) 作为 hint 注入 VLM prompt，让模型在"客户分镜参考"块中识别到客户词时，
 *      主动把 eight_elements.运镜 / shot_classification.运镜方式 写成白名单单值；
 *   2) normalize 输出附加"客户写法 → SD2 白名单"速查行，方便人审对照；
 *   3) 下游分析客户 xlsx 时做词表规整。
 *
 * 规则：左边是客户分镜常见中文，右边必须落在
 * CAMERA_SINGLE_WHITELIST（固定机位/向前推/向后拉/横摇/纵摇/跟随/环绕/变焦/轨道/手持）。
 * 若客户词语义模糊（例如"无人机拍摄"），右边选择最接近的 SD2 单值（常用"环绕"或"向前推"）；
 * 对此类模糊映射在注释里标注 "(近似)"，在 normalize 渲染时会带上"近似匹配"提示。
 */

/**
 * @typedef {object} AliasEntry
 * @property {string} sd2   目标 SD2 白名单单值
 * @property {boolean} [approx] 是否为语义近似映射（非严格一一对应）
 * @property {string} [note] 备注（可在报告里展示）
 */

/** @type {Record<string, AliasEntry>} */
export const CAMERA_ALIAS_MAP = {
  // —— 与白名单严格对应 ——
  固定: { sd2: '固定机位' },
  固定机位: { sd2: '固定机位' },
  无: { sd2: '固定机位', note: '客户 "无" 通常指不动，归为固定机位' },
  静态: { sd2: '固定机位' },

  // —— 推/拉（前后） ——
  推进: { sd2: '向前推' },
  推: { sd2: '向前推' },
  缓慢推: { sd2: '向前推' },
  快速推进: { sd2: '向前推' },
  向前推: { sd2: '向前推' },
  推拉: {
    sd2: '向前推',
    approx: true,
    note: '"推拉" 属聚合词，实际通常是单向推进，取向前推',
  },

  拉: { sd2: '向后拉' },
  缓慢拉: { sd2: '向后拉' },
  向后拉: { sd2: '向后拉' },
  拉远: { sd2: '向后拉' },

  // —— 摇（横/纵） ——
  横摇: { sd2: '横摇' },
  左摇: { sd2: '横摇' },
  右摇: { sd2: '横摇' },
  甩镜: {
    sd2: '横摇',
    approx: true,
    note: '"甩镜" 是快速横摇（whip pan），白名单里归为横摇',
  },
  向上横摇: {
    sd2: '纵摇',
    approx: true,
    note: '"向上横摇" 实为 tilt up（纵摇），分镜表常见误用，修正为纵摇',
  },
  向下横摇: { sd2: '纵摇', approx: true, note: '同上，tilt down，修正为纵摇' },
  纵摇: { sd2: '纵摇' },
  上仰: { sd2: '纵摇' },
  下俯: { sd2: '纵摇' },

  // —— 跟/随/环 ——
  跟随: { sd2: '跟随' },
  追踪拍摄: { sd2: '跟随' },
  跟拍: { sd2: '跟随' },
  环绕: { sd2: '环绕' },
  环拍: { sd2: '环绕' },
  无人机拍摄: {
    sd2: '环绕',
    approx: true,
    note: '无人机镜头多为缓慢环绕/平移，近似映射到环绕',
  },
  航拍: { sd2: '环绕', approx: true, note: '同上' },

  // —— 手持 / 轨道 / 变焦 ——
  手持拍摄: { sd2: '手持' },
  手持: { sd2: '手持' },
  轨道: { sd2: '轨道' },
  滑轨: { sd2: '轨道' },
  变焦: { sd2: '变焦' },
  zoom: { sd2: '变焦' },

  // —— 角度类误写兜底（不是运镜，但客户有时填到运镜列） ——
  俯视: {
    sd2: '固定机位',
    approx: true,
    note: '"俯视" 属于角度不是运镜，若无明显位移，按固定机位处理',
  },
  仰视: { sd2: '固定机位', approx: true, note: '同上' },
  平视: { sd2: '固定机位', approx: true, note: '同上' },
};

/** 白名单末端参照，供外部做一致性校验 */
export const CAMERA_SINGLE_WHITELIST = [
  '固定机位',
  '向前推',
  '向后拉',
  '横摇',
  '纵摇',
  '跟随',
  '环绕',
  '变焦',
  '轨道',
  '手持',
];

/**
 * 将任意原始运镜词规整到 SD2 白名单单值。
 *
 * 规则：
 *   1) 先去空白和中文括号中的附加说明；
 *   2) 若在 CAMERA_ALIAS_MAP 中命中，返回对应映射；
 *   3) 否则对白名单直接按子串包含匹配（例如 "缓慢向前推" → 向前推）；
 *   4) 都不命中则返回 null。
 *
 * @param {string | undefined | null} raw
 * @returns {{ sd2: string; approx: boolean; note?: string } | null}
 */
export function mapCameraAlias(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .replace(/[()（）]/g, ' ')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (!cleaned) return null;

  for (const [k, v] of Object.entries(CAMERA_ALIAS_MAP)) {
    if (cleaned === k.toLowerCase()) {
      return { sd2: v.sd2, approx: Boolean(v.approx), note: v.note };
    }
  }
  for (const [k, v] of Object.entries(CAMERA_ALIAS_MAP)) {
    if (cleaned.includes(k.toLowerCase())) {
      return { sd2: v.sd2, approx: Boolean(v.approx), note: v.note };
    }
  }
  for (const w of CAMERA_SINGLE_WHITELIST) {
    if (cleaned.includes(w)) {
      return { sd2: w, approx: false };
    }
  }
  return null;
}

/**
 * 为 VLM prompt 生成一段"客户词 → SD2 白名单"映射提示。
 * 只在 storyboard 参考块启用时注入，避免无意义膨胀 token。
 *
 * @returns {string}
 */
export function formatAliasHintForPrompt() {
  /** @type {Record<string, string[]>} */
  const rev = {};
  for (const [k, v] of Object.entries(CAMERA_ALIAS_MAP)) {
    const key = v.sd2;
    if (!rev[key]) rev[key] = [];
    if (k !== v.sd2) rev[key].push(k + (v.approx ? '(近似)' : ''));
  }
  const lines = ['# 客户分镜常用运镜词 → SD2 白名单（出现在下方分镜参考块时请映射为右侧单值）'];
  for (const w of CAMERA_SINGLE_WHITELIST) {
    const alts = rev[w];
    if (!alts || alts.length === 0) continue;
    lines.push(`- ${alts.join(' / ')} → ${w}`);
  }
  return lines.join('\n');
}
