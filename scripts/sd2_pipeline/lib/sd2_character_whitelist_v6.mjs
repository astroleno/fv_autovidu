/**
 * HOTFIX N · 角色名白名单硬门（character_token_integrity_check）
 *
 * 背景：leji-v6g B08 曾产出 "赵凯与徐莉相拥"，但 "徐莉" 不在 assetManifest。
 * 这类幻觉会直接污染成片角色一致性（角色形象/声线都会跟着换）。
 *
 * 设计要点：
 *   1. 白名单 = assetManifest.characters[].assetName ∪ scriptChunk.segments[].speaker
 *      （assetName 含 "/" 时按斜杠拆分并各自入表）。
 *   2. 停用词 = 医生 / 护士 / 老公 / VO / ... 等职能/亲属/旁白词。
 *   3. 候选只走三个"高可信"信号点：
 *        · `NAME（身份）` 括注
 *        · `X与Y` / `X和Y` / `X、Y` 连接词左右侧
 *        · `[DIALOG]` 段内 `NAME：` / `NAME（...）：` 说话头
 *   4. 每个信号点输出"choices"数组：同一位置的 2 字版与 3 字版
 *      （剧本里 2 字名、3 字名混用；regex 若一刀切会漏抓）。
 *      检查时：choices 中**任一**在白名单/停用词/白名单前后缀内即视为过。
 *      全部落空才判 fail。这样能同时抓住：
 *        - "赵凯与徐莉相拥"（right-run="徐莉相" → 2 字 "徐莉" 不在白名单 → fail）
 *        - "秦若岚与许倩相对"（left-run="秦若岚" → 3 字在白名单 → pass；
 *                             "许倩相" 的 2 字 "许倩" 在白名单 → pass）
 *        - "秦若" 单独出现（作为 "秦若岚" 的前缀，算白名单前缀匹配 → pass）
 *
 * 本文件只做纯函数，不读文件、不调 LLM，便于单测。
 */

/** @typedef {{ assetName?: string }} AssetManifestItem */
/** @typedef {{ assetManifest?: { characters?: AssetManifestItem[] } }} EditMapInputLike */
/** @typedef {{ speaker?: string | null }} ScriptChunkSegmentLike */
/** @typedef {{ segments?: ScriptChunkSegmentLike[] }} ScriptChunkLike */

const ROLE_WORDS_STOPLIST = new Set([
  '医生', '护士', '院长', '副院长', '主任', '助手', '麻醉师', '麻醉', '实习', '主治',
  '母亲', '父亲', '妈妈', '爸爸', '妻子', '丈夫', '老婆', '老公', '宝贝', '孩子',
  '孕妇', '病人', '家人', '朋友', '同事', '客户', '患者', '同学', '路人', '观众',
  '空镜', '画面', '镜头', '背景', '前景', '特写', '近景', '中景', '远景', '分屏',
  '字幕', '人名', '片头', '片尾', '回忆', '闪回', '梦境',
  '医院', '大楼', '走廊', '病房', '办公室', '手术室', '门外', '门内', '拐角', '桌面',
  '诊断书', '特效', '蓝光', '冷光',
  '路过',
  'VO', 'Vo', 'vo', 'OS', 'Os', 'os', 'voiceover', 'VoiceOver',
  '旁白', '独白', '内心', '心声', '心里',
]);

const CONNECTORS = new Set(['与', '和', '、']);
const COMMON_CHINESE_SURNAMES = new Set(
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦许何吕张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费薛雷贺倪汤殷罗毕郝邬安常乐于时傅卞齐康伍余元卜顾孟平黄穆萧尹姚邵汪祁毛禹狄米明臧成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万柯莫房裘缪干解应宗丁宣邓郁单杭洪包左石崔吉龚程邢裴陆荣翁荀惠甄曲家封芮靳焦巴谷车侯班秋仲伊宫宁仇栾甘厉戎祖武符刘景龙叶司黎薄白蒲赖卓屠乔温喻'.split(''),
);
const NON_NAME_SUFFIXES = new Set(
  ['桌', '柜', '单', '笔', '门', '灯', '光', '柔', '声', '影', '件', '书', '报告', '面', '头', '肩', '臂', '手', '腰', '背', '腿', '腹', '角', '口'],
);

/**
 * @param {string} ch
 */
function isCjk(ch) {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code >= 0x4e00 && code <= 0x9fff;
}

/**
 * 从 startIdx 开始沿 direction（+1 右 / -1 左）收集连续 CJK（≤3 字）。
 * direction=-1 时结果已反转为正序。
 *
 * @param {string} text
 * @param {number} startIdx
 * @param {1 | -1} direction
 * @returns {string}
 */
function readNameRun(text, startIdx, direction) {
  /** @type {string[]} */
  const chars = [];
  let i = startIdx;
  while (i >= 0 && i < text.length && isCjk(text[i]) && chars.length < 3) {
    chars.push(text[i]);
    i += direction;
  }
  if (direction === -1) chars.reverse();
  return chars.join('');
}

/**
 * 把一次"名字位置"上的连续 CJK run 转成 choices 数组：
 *   - 若 run 长度 = 2，choices = [run]
 *   - 若 run 长度 = 3，choices = [run.slice(0,2) or run.slice(-2), run]
 *
 * @param {string} run
 * @param {'prefix' | 'suffix'} twoCharSide
 * @returns {string[]}
 */
function runToChoices(run, twoCharSide) {
  if (!run || run.length < 2) return [];
  if (run.length === 2) return [run];
  const two = twoCharSide === 'prefix' ? run.slice(0, 2) : run.slice(-2);
  return [two, run];
}

/**
 * 构造当前 block 的"已知人物名"白名单集合。
 *
 * @param {{ editMapInput?: EditMapInputLike | null, scriptChunk?: ScriptChunkLike | null }} param0
 * @returns {Set<string>}
 */
export function buildCharacterWhitelist({ editMapInput, scriptChunk } = {}) {
  /** @type {Set<string>} */
  const set = new Set();
  const chars =
    editMapInput && editMapInput.assetManifest && Array.isArray(editMapInput.assetManifest.characters)
      ? editMapInput.assetManifest.characters
      : [];
  for (const c of chars) {
    if (c && typeof c.assetName === 'string') {
      const name = c.assetName.trim();
      if (name) {
        set.add(name);
        for (const part of name.split('/')) {
          const p = part.trim();
          if (p && p !== name) set.add(p);
        }
      }
    }
  }
  const segs = scriptChunk && Array.isArray(scriptChunk.segments) ? scriptChunk.segments : [];
  for (const seg of segs) {
    if (seg && typeof seg.speaker === 'string') {
      const sp = seg.speaker.trim();
      if (sp && !/^(vo|os)$/i.test(sp)) set.add(sp);
    }
  }
  return set;
}

/**
 * @typedef {Object} ContextPoint
 * @property {'bracket' | 'connector_left' | 'connector_right' | 'dialog_speaker'} kind
 * @property {string[]} choices  同一位置的 2/3 字候选名
 */

/**
 * 从 Prompter sd2_prompt 文本中提取"候选角色名位置"。
 *
 * @param {string} text
 * @returns {ContextPoint[]}
 */
export function extractContextPoints(text) {
  if (!text || typeof text !== 'string') return [];
  /** @type {ContextPoint[]} */
  const points = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if ((ch === '（' || ch === '(') && i > 0 && isCjk(text[i - 1])) {
      const run = readNameRun(text, i - 1, -1);
      const choices = runToChoices(run, 'suffix');
      if (choices.length > 0) points.push({ kind: 'bracket', choices });
    }
  }

  for (let i = 0; i < text.length; i += 1) {
    if (!CONNECTORS.has(text[i])) continue;
    if (i > 0 && isCjk(text[i - 1])) {
      const leftRun = readNameRun(text, i - 1, -1);
      const leftChoices = runToChoices(leftRun, 'suffix');
      if (leftChoices.length > 0) points.push({ kind: 'connector_left', choices: leftChoices });
    }
    if (i + 1 < text.length && isCjk(text[i + 1])) {
      const rightRun = readNameRun(text, i + 1, 1);
      const rightChoices = runToChoices(rightRun, 'prefix');
      if (rightChoices.length > 0) points.push({ kind: 'connector_right', choices: rightChoices });
    }
  }

  const dialogStart = text.indexOf('[DIALOG]');
  if (dialogStart >= 0) {
    let dialogEnd = text.length;
    for (const mk of ['[SFX]', '[BGM]']) {
      const idx = text.indexOf(mk, dialogStart + 8);
      if (idx >= 0 && idx < dialogEnd) dialogEnd = idx;
    }
    const body = text.slice(dialogStart + '[DIALOG]'.length, dialogEnd);
    const re = /(?:^|\s|、|，|。|；|！|？|」|】|]|"|'|\])([\u4e00-\u9fff]{2,3})(?:[（(][^）)：]*[）)])?\s*[：:]/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const run = m[1];
      const choices = runToChoices(run, 'prefix');
      if (choices.length > 0) points.push({ kind: 'dialog_speaker', choices });
    }
  }

  return points;
}

/**
 * 向后兼容导出：候选名扁平列表（测试用）。
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractCharacterCandidates(text) {
  const pts = extractContextPoints(text);
  const set = new Set();
  for (const p of pts) for (const c of p.choices) set.add(c);
  return [...set];
}

/**
 * 2 字候选 `c` 是否是白名单里某 3 字名的前缀/后缀（如 "秦若" ⊂ "秦若岚"）。
 *
 * @param {string} c
 * @param {Set<string>} whitelist
 * @returns {boolean}
 */
function isPrefixSuffixOfWhitelist(c, whitelist) {
  if (!c || c.length !== 2) return false;
  for (const w of whitelist) {
    if (w.length >= 3 && (w.startsWith(c) || w.endsWith(c))) return true;
  }
  return false;
}

/**
 * @param {string} c
 * @param {Set<string>} whitelist
 */
function isKnown(c, whitelist) {
  return whitelist.has(c) || ROLE_WORDS_STOPLIST.has(c) || isPrefixSuffixOfWhitelist(c, whitelist);
}

/**
 * 仅用于 connector 场景的保守姓名启发式，避免把"病历单、笔掉落"之类物体列表误判成人名。
 *
 * @param {string} c
 * @returns {boolean}
 */
function looksPersonLikeName(c) {
  if (!c || c.length < 2 || c.length > 3) return false;
  if (ROLE_WORDS_STOPLIST.has(c)) return false;
  if (!COMMON_CHINESE_SURNAMES.has(c[0])) return false;
  return !NON_NAME_SUFFIXES.has(c[c.length - 1]);
}

/**
 * 单个 shot 的白名单核对。
 *
 * @param {string} sd2Prompt
 * @param {Set<string>} whitelist
 * @returns {{ candidates: string[], unknown_tokens: string[], status: 'pass' | 'fail' }}
 */
export function checkCharacterWhitelistForShot(sd2Prompt, whitelist) {
  const points = extractContextPoints(sd2Prompt || '');
  /** @type {Set<string>} */
  const allCands = new Set();
  /** @type {Set<string>} */
  const unknownSet = new Set();
  for (const pt of points) {
    const shouldJudge =
      pt.kind === 'dialog_speaker'
        ? true
        : pt.kind === 'bracket' ||
            pt.kind === 'connector_left' ||
            pt.kind === 'connector_right'
          ? pt.choices.some((c) => isKnown(c, whitelist) || looksPersonLikeName(c))
          : true;
    if (!shouldJudge) continue;
    for (const c of pt.choices) allCands.add(c);
    const ok = pt.choices.some((c) => isKnown(c, whitelist));
    if (!ok) {
      const shortest = [...pt.choices].sort((a, b) => a.length - b.length)[0];
      if (shortest) unknownSet.add(shortest);
    }
  }
  return {
    candidates: [...allCands],
    unknown_tokens: [...unknownSet],
    status: unknownSet.size === 0 ? 'pass' : 'fail',
  };
}

/**
 * 整个 Prompter 输出（shots[]）聚合核对。
 *
 * @param {{ shots?: Array<{ shot_idx?: number, sd2_prompt?: string }> } | null | undefined} prParsed
 * @param {Set<string>} whitelist
 * @returns {{
 *   status: 'pass' | 'fail' | 'skip',
 *   reason: string,
 *   unknown_tokens: string[],
 *   per_shot: Array<{ shot_idx: number, unknown_tokens: string[] }>,
 *   whitelist_size: number
 * }}
 */
export function checkCharacterWhitelistForBlock(prParsed, whitelist) {
  if (!prParsed || typeof prParsed !== 'object' || !Array.isArray(prParsed.shots)) {
    return {
      status: 'skip',
      reason: 'no_shots',
      unknown_tokens: [],
      per_shot: [],
      whitelist_size: whitelist ? whitelist.size : 0,
    };
  }
  if (!whitelist || whitelist.size === 0) {
    return {
      status: 'skip',
      reason: 'empty_whitelist',
      unknown_tokens: [],
      per_shot: [],
      whitelist_size: 0,
    };
  }
  /** @type {Set<string>} */
  const allUnknown = new Set();
  /** @type {Array<{ shot_idx: number, unknown_tokens: string[] }>} */
  const perShot = [];
  for (let i = 0; i < prParsed.shots.length; i += 1) {
    const shot = prParsed.shots[i];
    const sp = shot && typeof shot === 'object' && typeof shot.sd2_prompt === 'string' ? shot.sd2_prompt : '';
    const r = checkCharacterWhitelistForShot(sp, whitelist);
    if (r.unknown_tokens.length > 0) {
      perShot.push({
        shot_idx: typeof shot.shot_idx === 'number' ? shot.shot_idx : i,
        unknown_tokens: r.unknown_tokens,
      });
      for (const t of r.unknown_tokens) allUnknown.add(t);
    }
  }
  if (allUnknown.size === 0) {
    return {
      status: 'pass',
      reason: `ok (whitelist=${whitelist.size})`,
      unknown_tokens: [],
      per_shot: [],
      whitelist_size: whitelist.size,
    };
  }
  return {
    status: 'fail',
    reason: `unknown_tokens=${[...allUnknown].slice(0, 8).join(',')}`,
    unknown_tokens: [...allUnknown],
    per_shot: perShot,
    whitelist_size: whitelist.size,
  };
}

export const __TEST_ONLY__ = { ROLE_WORDS_STOPLIST };
