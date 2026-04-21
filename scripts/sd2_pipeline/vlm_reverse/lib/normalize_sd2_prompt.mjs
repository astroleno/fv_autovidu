/**
 * 将 VLM 输出的 JSON 规范化为 SD2 三段式草稿 Markdown。
 *
 * 本次升级（对齐 `sd2官方提示词.md`）要点：
 *   1. 支持 screen_text 字段：渲染为"画面文字"清单（对齐官方 Step 4.3 文字生成）
 *   2. 运镜字段告警升级：空/含多种运镜 → warning
 *   3. 粗稿不再标"待替换"：VLM 已被要求直接输出 @图N（角色名）强指代
 *   4. 增加 @图N 断句合规校验（`@图N` 后未紧跟括号或名词会给 warning）
 *
 * @typedef {object} DetectedAssetChar
 * @property {string} name
 * @property {number} [confidence]
 * @property {string | null} [position]
 *
 * @typedef {object} DetectedAssetProp
 * @property {string} name
 * @property {number} [confidence]
 *
 * @typedef {object} ScreenTextItem
 * @property {string} content  画面文字原文
 * @property {string} [position]  画面位置
 * @property {string} [timing]   出现时段
 *
 * @typedef {object} VlmSegmentJson
 * @property {number} seg_id
 * @property {string} video_file
 * @property {number} duration_s
 * @property {{ characters?: DetectedAssetChar[]; props?: DetectedAssetProp[]; scene?: string | null }} detected_assets
 * @property {ScreenTextItem[]} [screen_text]
 * @property {Record<string, string>} [eight_elements]
 * @property {{ 景别?: string; 角度?: string; 运镜方式?: string }} [shot_classification]
 * @property {string} [raw_prompt_draft]
 * @property {boolean} [needs_human_review]
 * @property {string[]} [review_reasons]
 */

/**
 * 允许的单运镜白名单（与 vlm_reverse_prompt.mjs 保持一致）。
 * 注意：这些是 eight_elements.运镜 字段的合法写法。
 */
const CAMERA_SINGLE_WHITELIST = [
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
 * 为角色与道具分配 @图1 … @图N（characters 先，props 后）。
 *
 * @param {VlmSegmentJson} vlm
 * @returns {{ lines: string[]; mapping: { slot: string; label: string }[] }}
 */
export function buildFigureMapping(vlm) {
  /** @type {{ slot: string; label: string }[]} */
  const mapping = [];
  let n = 1;
  const chars = vlm.detected_assets?.characters || [];
  for (const c of chars) {
    if (c && typeof c.name === 'string' && c.name.trim()) {
      mapping.push({ slot: `@图${n}`, label: c.name.trim() });
      n += 1;
    }
  }
  const props = vlm.detected_assets?.props || [];
  for (const p of props) {
    if (p && typeof p.name === 'string' && p.name.trim()) {
      mapping.push({ slot: `@图${n}`, label: p.name.trim() });
      n += 1;
    }
  }
  const lines = mapping.map(
    (m) => `${m.slot} 为 ${m.label}（参考图占位，实际提交时绑定资产图）`,
  );
  return { lines, mapping };
}

/**
 * 检测运镜合规性：
 *   - 字段为空 → warn
 *   - 出现互斥组合（推/拉、横摇/纵摇 等）→ warn
 *   - 不在 CAMERA_SINGLE_WHITELIST 中 → 提示
 *
 * @param {string} rawCamera
 * @returns {string[]}
 */
export function detectCameraIssues(rawCamera) {
  const t = (rawCamera || '').trim();
  /** @type {string[]} */
  const out = [];
  if (!t) {
    out.push('eight_elements.运镜 为空（官方规范要求单切片单运镜，静态应写 "固定机位"）');
    return out;
  }

  const has = (a, b) => t.includes(a) && t.includes(b);
  if (has('推', '拉') || has('向前推', '向后拉')) {
    out.push('运镜字段同时包含推/拉，属于运镜冲突，建议拆时间片或保留其一');
  }
  if (has('横摇', '纵摇')) {
    out.push('运镜字段同时包含横摇/纵摇，建议拆时间片或保留其一');
  }
  if (has('推', '摇') || has('推', '移')) {
    out.push('运镜字段同时含推+摇/移，违反"单切片单运镜"原则');
  }

  const hit = CAMERA_SINGLE_WHITELIST.some((k) => t.includes(k));
  if (!hit) {
    out.push(
      `运镜描述未命中官方白名单（${CAMERA_SINGLE_WHITELIST.join('/')}），请人工校对`,
    );
  }
  return out;
}

/**
 * 检测 raw_prompt_draft 中 `@图N` 的断句合规性：
 *   - 出现 `@图N` 但后面未紧跟 `（` 或 `(` → warning
 *   - 出现 asset-xxx 裸 ID → warning
 *
 * @param {string} draft
 * @returns {string[]}
 */
export function detectDraftIssues(draft) {
  const out = [];
  if (!draft) return out;

  const badPattern = /@图\d+(?![（(])/g;
  const bad = draft.match(badPattern);
  if (bad && bad.length > 0) {
    out.push(
      `粗稿中 ${bad.length} 处 @图N 未紧跟括号（断句防歧义不合格）：${bad.slice(0, 3).join('、')}`,
    );
  }

  if (/asset-[\w-]+/i.test(draft)) {
    out.push('粗稿中出现 asset-xxx 裸 ID，违反 Asset ID 屏蔽原则');
  }
  return out;
}

/**
 * 检测 shot_classification.运镜方式 是否：
 *   - 落在 CAMERA_SINGLE_WHITELIST 内
 *   - 与 eight_elements.运镜 一致（同一白名单单值）
 * 两个字段应写成同一单值，避免下游脚本二选一时混淆。
 *
 * @param {string | undefined} eightCamera
 * @param {string | undefined} shotCamera
 * @returns {string[]}
 */
export function detectShotClassIssues(eightCamera, shotCamera) {
  /** @type {string[]} */
  const out = [];
  const ec = (eightCamera || '').trim();
  const sc = (shotCamera || '').trim();
  if (!sc) return out;

  const scHit = CAMERA_SINGLE_WHITELIST.some((k) => sc.includes(k));
  if (!scHit) {
    out.push(
      `shot_classification.运镜方式 "${sc}" 不在白名单（${CAMERA_SINGLE_WHITELIST.join('/')}），建议收敛到同一白名单单值`,
    );
  }
  if (ec && scHit) {
    const ecKey = CAMERA_SINGLE_WHITELIST.find((k) => ec.includes(k));
    const scKey = CAMERA_SINGLE_WHITELIST.find((k) => sc.includes(k));
    if (ecKey && scKey && ecKey !== scKey) {
      out.push(
        `运镜两字段不一致：eight_elements.运镜 = "${ec}"，shot_classification.运镜方式 = "${sc}"，请统一为同一白名单单值`,
      );
    }
  }
  return out;
}

/**
 * 检测 detected_assets.characters[].name 是否出现斜杠并列命名
 * （如 "医生/护士"），违反"单值占位"约束。
 *
 * @param {Array<{ name?: string | null } | undefined | null> | undefined} chars
 * @returns {string[]}
 */
export function detectCharacterNameIssues(chars) {
  /** @type {string[]} */
  const out = [];
  if (!Array.isArray(chars)) return out;
  for (const c of chars) {
    if (c && typeof c.name === 'string' && /[\/／]/.test(c.name)) {
      out.push(
        `角色命名含斜杠 "${c.name}"（建议改为 '未命名医生' / '未命名护士' 等单值占位）`,
      );
    }
  }
  return out;
}

/**
 * 渲染画面文字块（对齐 SD2 Step 4.3 文字生成）。
 *
 * @param {ScreenTextItem[] | undefined} list
 * @returns {string}
 */
function renderScreenTextBlock(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return '- （无画面文字 / OSD / 字幕）';
  }
  return list
    .map((item) => {
      if (!item || typeof item.content !== 'string' || !item.content.trim()) {
        return null;
      }
      const pos = item.position ? `位置：${item.position}` : '位置未标注';
      const timing = item.timing ? `时段：${item.timing}` : '全程';
      return `- "${item.content.trim()}" · ${pos} · ${timing}`;
    })
    .filter((x) => Boolean(x))
    .join('\n') || '- （无画面文字）';
}

/**
 * @param {VlmSegmentJson} vlm
 * @param {string} [modelName]
 * @returns {{ markdown: string; warnings: string[] }}
 */
export function normalizeToSd2Markdown(vlm, modelName) {
  /** @type {string[]} */
  const warnings = [];
  const { lines: mappingLines, mapping } = buildFigureMapping(vlm);
  const scene = vlm.detected_assets?.scene || '（未识别场景，需人工确认）';
  const ee = vlm.eight_elements || {};
  const draft = vlm.raw_prompt_draft || '';
  const dur = Number.isFinite(Number(vlm.duration_s)) ? Number(vlm.duration_s) : 0;

  warnings.push(...detectCameraIssues(ee.运镜 || ''));
  warnings.push(
    ...detectShotClassIssues(ee.运镜 || '', vlm.shot_classification?.运镜方式 || ''),
  );
  warnings.push(...detectCharacterNameIssues(vlm.detected_assets?.characters || []));
  warnings.push(...detectDraftIssues(draft));

  const globalBlock = [
    '### 1. 全局基础设定',
    `- 本段视频文件：\`${vlm.video_file}\`，时长约 ${dur.toFixed(3)}s。`,
    `- 场景锚点：${scene}。`,
    mappingLines.length > 0
      ? mappingLines.join('\n')
      : '- （未检测到可映射资产，请人工从白名单指定 @图N）',
    '',
    '**画面文字（OSD / 字幕 / 门牌 等，对齐 SD2 Step 4.3）**',
    renderScreenTextBlock(vlm.screen_text),
    '',
  ].join('\n');

  const camera = ee.运镜 || '（缺）';
  const shotBadge = `${vlm.shot_classification?.景别 || '景别待定'}，${vlm.shot_classification?.角度 || '角度待定'}`;

  /** @type {string[]} */
  const timeLines = [
    '### 2. 时间片分镜脚本',
    `- 0s – ${dur.toFixed(3)}s：`,
    `  - 主体与动作：${ee.主体 || '（缺）'}；${ee.动作 || ''}`,
    `  - 环境与光影：${ee.场景 || ''}；${ee.光影 || ''}`,
    `  - 镜头：${camera}（${shotBadge}）`,
    `  - 叙事/导演意图摘要：见 raw_prompt_draft。`,
    '',
  ];
  if (mapping.length > 0) {
    timeLines.push(
      `**@图N 映射速查**：${mapping.map((m) => `${m.slot}（${m.label}）`).join('、')}`,
    );
  }
  timeLines.push(
    '**粗稿（已使用 @图N 强指代，可直接提交 SD2）**',
    draft || '（模型未返回 raw_prompt_draft）',
    '',
  );
  const timeBlock = timeLines.join('\n');

  const tailBlock = [
    '### 3. 画质、风格与约束',
    `- 风格：${ee.风格 || 'cinematic 写实'}`,
    `- 画质：${ee.画质 || '4K 高清，细节丰富'}`,
    `- 约束：${ee.约束 || '人物面部稳定不变形、五官清晰、无穿模、无多余肢体'}`,
    modelName ? `\n（模型：${modelName}）` : '',
  ].join('\n');

  const markdown = [globalBlock, timeBlock, tailBlock].join('\n');

  if (vlm.needs_human_review) {
    const reasons =
      Array.isArray(vlm.review_reasons) && vlm.review_reasons.length > 0
        ? `：${vlm.review_reasons.join(' / ')}`
        : '';
    warnings.push(`VLM 标记 needs_human_review${reasons}`);
  }

  return { markdown, warnings };
}
