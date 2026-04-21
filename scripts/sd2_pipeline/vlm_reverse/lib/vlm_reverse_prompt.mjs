/**
 * 构造「从视频反推 SD2 风格提示词」的 user prompt（要求只输出 JSON）。
 *
 * 本文件严格对齐 `reference/.../sd2官方提示词.md` 中的规范：
 *   - 三段式结构（Step 4）
 *   - 八大核心要素（Step 3.1）
 *   - 运镜限制：单切片单运镜（禁止同时推拉摇移）
 *   - 断句防歧义：raw_prompt_draft 中必须使用 `@图N（角色名）` 强指代
 *   - Asset ID 屏蔽：严禁输出 asset-xxx
 *   - 文字生成：画面内 OSD / 字幕 / 门牌 要写入 `screen_text`
 *   - 复杂多人场景：必须带方位约束（左/右/前/后）
 */

/**
 * @param {object} opts
 * @param {string} opts.assetsBlock  资产白名单文本
 * @param {string} opts.specBlock    SD2 规范摘要
 * @param {number} opts.segId
 * @param {string} opts.videoFile
 * @param {number} opts.durationS
 * @param {string} [opts.csvNotes]  cuts_review 行内 notes（可能包含场景线索）
 * @param {string} [opts.storyboardBlock]
 *   客户分镜参考块（由 storyboard_loader 组装），内容仅作叙事基调/OSD 预期/情绪锚定，
 *   画面判读仍以实际视频为准。为空则不注入。
 * @param {string} [opts.aliasHint]
 *   客户运镜词 → SD2 白名单单值的映射提示。通常与 storyboardBlock 一同注入。
 * @returns {string}
 */
export function buildReverseJsonPrompt(opts) {
  const notesLine = opts.csvNotes && opts.csvNotes.trim()
    ? `\n【剪辑表备注】${opts.csvNotes.trim()}`
    : '';

  const storyboardSection = opts.storyboardBlock && opts.storyboardBlock.trim()
    ? `\n${opts.storyboardBlock.trim()}\n`
    : '';
  const aliasSection = opts.aliasHint && opts.aliasHint.trim()
    ? `\n${opts.aliasHint.trim()}\n`
    : '';

  return `CRITICAL: Output ONLY valid JSON. Start with { and end with }. No markdown code fence, no commentary.

${opts.assetsBlock}

# SD2 / Seedance 规范参考（请对齐下列要素，不要原样照抄整篇）
${opts.specBlock}
${storyboardSection}${aliasSection}
# 当前任务
你是专业分镜与提示词反推助手。输入为 **单段短视频**（一个连续切片）。请根据实际画面反推可直接灌入 **Seedance 2.0 / SD2** 工程化提示词的素材。

片段元数据：
- seg_id: ${opts.segId}
- video_file: ${opts.videoFile}
- duration_s: ${opts.durationS}${notesLine}

# 输出 JSON Schema（严格遵守字段名；未识别就给空串/空数组/null，禁止编造）
{
  "seg_id": number,
  "video_file": "string",
  "duration_s": number,
  "detected_assets": {
    "characters": [
      {
        "name": "优先从上方白名单中选择。**严禁使用斜杠命名**如 '医生/护士'、'男/女'；若画面无法定位到白名单具体姓名，统一使用占位称谓：'未命名医生'、'未命名护士'、'未命名男子'、'未命名女子'、'未命名小孩' 等，仍保证单值不含斜杠",
        "confidence": 0.0,
        "position": "画面方位：左|中|右|前|后|左上|右下 等；单人场景可为 null"
      }
    ],
    "props": [ { "name": "string", "confidence": 0.0 } ],
    "scene": "string 或 null，优先从白名单场景中选最接近"
  },
  "screen_text": [
    {
      "content": "画面内可见的中文/英文字样原文，逐字照抄（门牌、字幕、标语、OSD、病历文字等）",
      "position": "画面下方|左上|门牌中心 等；必须具体，不能写'画面里'",
      "timing": "出现时段，形如 '0s-2s' 或 '全程'"
    }
  ],
  "eight_elements": {
    "主体": "string。多人时用'左侧/右侧/前景/后景'显式标方位",
    "动作": "string。文戏微操化：必须写到微表情/小动作颗粒度，例如'右手缓慢伸出并摩挲'、'目光下垂片刻后抬头'；武戏也要写清动作方向与节奏",
    "场景": "string",
    "光影": "string。说明光源方向（侧光/逆光/顶光）+ 色温 + 氛围",
    "运镜": "string。严禁留空。**单一运镜**，必须是以下之一：固定机位|向前推|向后拉|横摇|纵摇|跟随|环绕|变焦|轨道|手持。若画面无镜头动，写 '固定机位'；禁止同时写推/拉/摇/移/跟/环中的两项",
    "风格": "string",
    "画质": "string。至少写'4K 高清'或更高要求",
    "约束": "string。防崩坏兜底，必须包含人物五官稳定/手部不穿模/文字不扭曲 等相关项"
  },
  "shot_classification": {
    "景别": "远景|全景|中全景|中景|中近景|近景|特写|大特写",
    "角度": "平视|仰拍|俯拍|鸟瞰|荷兰角|地面视角",
    "运镜方式": "**必须与 eight_elements.运镜 完全一致（同一白名单单值）**：固定机位|向前推|向后拉|横摇|纵摇|跟随|环绕|变焦|轨道|手持。严禁写 '推拉' / '静态' 这种聚合词（请分别写 '向前推' / '向后拉' / '固定机位'）"
  },
  "raw_prompt_draft": "string（中文，一段完整的 SD2 粗稿，**必须使用 @图N（角色名）强指代**，禁止裸人名；禁止出现 asset-xxx；未识别到角色时允许使用白名单外的通用称谓，如'一位中年男子'）",
  "needs_human_review": boolean,
  "review_reasons": ["string"]
}

# 【极度重要的写作约束】
1. **运镜字段禁空**：即使主体与背景都静止，也必须写 '固定机位'。
2. **动作字段禁空泛**：不要只写 '站着'、'说话'。必须写到 '微表情 + 小动作 + 方向' 的组合，例如 '低头看向左下方，同时右手指尖轻敲桌面'。
3. **@图N 强指代**：在 raw_prompt_draft 正文里，每次引用白名单中命中的角色或道具时，**必须**写成 \`@图N（角色名）\` 形式（例如 \`@图1（李院长）\` 、\`@图3（手机）\`）。编号顺序：characters 先编号，再编号 props；未命中白名单的通用主体可用口语化描述但绝不编 @图。
4. **@图N 断句防歧义**：\`@图N\` 后必须紧跟括号内的角色名或名词，严禁 \`@图1跑向…\`、\`@图2位于…\` 这种直接连动词/方位词的写法。
5. **画面文字优先级最高**：只要画面出现任何可辨认的中文/英文字样（门牌、字幕、标语、病历、诊断书、标识牌、OSD），必须填入 screen_text。没有文字则数组为空 []，禁止漏检。
6. **多人正面动态场景**：eight_elements.主体 与 raw_prompt_draft 中必须显式标方位（左/右/前/后 或 画面左侧/画面右侧），用于防穿模/跳脸。
7. **Asset ID 屏蔽**：禁止在任何字段中写 \`asset-xxx\` 裸 ID。
8. 若白名单中没有合适角色映射，characters 可为空数组，并把 needs_human_review 设为 true，review_reasons 写清原因。
9. **角色命名禁止斜杠**：\`detected_assets.characters[].name\` 严禁出现 \`医生/护士\`、\`男/女\` 之类斜杠并列命名，无法定位到白名单具体姓名时请统一用 \`未命名医生\`、\`未命名护士\`、\`未命名男子\`、\`未命名女子\` 等单值占位。
10. **运镜两字段必须一致**：\`eight_elements.运镜\` 与 \`shot_classification.运镜方式\` 必须写成**同一个白名单单值**（例如两处都写 "固定机位" 或两处都写 "向前推"），不得一个写 "向前推" 另一个写 "推拉"。
11. **硬切尾巴防抖**：ffmpeg 按阈值切片时，片段末尾 0.2–0.3 秒可能带入下一镜头的硬切帧（画面突变、人物消失、场景跳变）。**请以前 70%–80% 时长的画面为准判读主体、动作、运镜**；末尾一瞬的跳变请忽略，不要把它当成当前片段的运镜或动作。若确实观察到明显的尾部硬切残影，请在 review_reasons 中注明 "尾部疑似带下一镜硬切帧"。

# 示例（仅示意，不要照抄到你的输出里）
raw_prompt_draft 合格写法：
  "在宽敞明亮的院长办公室内，@图1（李院长）身穿深色西装，右手拿着 @图3（手机）通话，左手缓慢伸出按在画面右侧坐着的 @图2（秦若岚）的大腿上并轻轻摩挲；@图2（秦若岚）双手交叠放于腿间，目光略微下垂。镜头采用中近景俯视、**固定机位**拍摄。4K 高清写实风格，要求人物五官稳定不变形，手部与大腿接触面自然不穿模。"
`;
}
