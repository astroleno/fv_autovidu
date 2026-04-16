#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_KB_DIR = path.join(__dirname, '..', 'prompt', '1_SD2Workflow', '3_FewShotKnowledgeBase');

const TAG_HINTS = {
  single_subject: ['single_subject', '单主体', '单人', '独角戏'],
  two_person_confrontation: ['two_person_confrontation', '双人', '对峙', '正反打', '施压'],
  group_dialogue: ['group_dialogue', '多人', '群体', '会议'],
  listener_reaction: ['listener_reaction', '听者反应', '反应镜头'],
  table_barrier: ['table_barrier', '桌', '台', '柜', '隔挡'],
  axis_sensitive: ['axis_sensitive', '轴线', '正反打'],
  awakening: ['awakening', '觉醒', '惊醒', '苏醒'],
  recognition: ['recognition', '认出', '确认'],
  truth_drop: ['truth_drop', '真相', '揭示'],
  power_reversal: ['power_reversal', '权力翻转', '强弱翻转'],
  beat_escalation: ['beat_escalation', '递进', '升级'],
  chase: ['chase', '追逐', '追赶', '奔跑'],
  duel: ['duel', '决斗', '交锋'],
  skill_release: ['skill_release', '技能释放', '爆发'],
  impact_hit: ['impact_hit', '碰撞', '打击'],
  entry_exit: ['entry_exit', '进场', '离场'],
  establishing: ['establishing', '建立环境', '全景'],
  bridge_beat: ['bridge_beat', '桥接', '过渡', '呼吸'],
  approach: ['approach', '靠近'],
  spatial_reset: ['spatial_reset', '空间重置'],
  gaze_hold: ['gaze_hold', '凝视', '视线锁定'],
  material_anchor: ['material_anchor', '物件锚点', '手部', '道具细节'],
  interior_pressure: ['interior_pressure', '压迫感', '封闭空间', '室内压迫'],
  flashback: ['flashback', '闪回', '回忆'],
  memory_fragment: ['memory_fragment', '记忆碎片', '碎片'],
  past_overlay: ['past_overlay', '过去覆盖', '旧时'],
  recall_trigger: ['recall_trigger', '触发记忆'],
  low_key_interior: ['low_key_interior', '低调', '幽暗', '室内'],
  high_key_exterior: ['high_key_exterior', '高调', '室外'],
  cool_tone: ['cool_tone', '冷调', '冷蓝', '冷青'],
  warm_tone: ['warm_tone', '暖调', '暖黄'],
  high_contrast: ['high_contrast', '高反差'],
  silhouette: ['silhouette', '剪影'],
  neon_cyber: ['neon_cyber', '赛博', '霓虹'],
  natural_daylight: ['natural_daylight', '自然日光', '日光'],
  candlelight: ['candlelight', '烛光', '火光'],
  dreamlike: ['dreamlike', '梦境'],
  non_physical_space: ['non_physical_space', '非物理空间', '抽象空间', '虚空'],
  flashback_texture: ['flashback_texture', '闪回质感', '柔焦', '颗粒'],
  ui_overlay: ['ui_overlay', '界面', '全息', 'overlay'],
  high_motion: ['high_motion', '高动态', '高速'],
  slow_contemplative: ['slow_contemplative', '缓慢', '沉思'],
  grain_texture: ['grain_texture', '颗粒', '胶片'],
  desaturated: ['desaturated', '低饱和'],
  micro_expression: ['micro_expression', '微表情'],
  material_interaction: ['material_interaction', '材质交互', '衣料', '褶皱'],
  axis_stability: ['axis_stability', '轴线稳定'],
  action_readability: ['action_readability', '动作可读性'],
  reveal_escalation: ['reveal_escalation', '揭示递进', '认知变化'],
  memory_transition: ['memory_transition', '记忆过渡'],
  spatial_clarity: ['spatial_clarity', '空间清晰'],
  slow_push: ['slow_push', '缓推'],
  impact_clarity: ['impact_clarity', '冲击清晰'],
  speed_boundary: ['speed_boundary', '速度边界', '运动模糊'],
  breathing_detail: ['breathing_detail', '呼吸'],
  eye_focus_shift: ['eye_focus_shift', '视线', '焦点变化'],
  restraint: ['restraint', '克制'],
  direction_readability: ['direction_readability', '方向可读性'],
  space_continuity: ['space_continuity', '空间连续性'],
  hierarchy_flip: ['hierarchy_flip', '层级翻转'],
  reaction_contrast: ['reaction_contrast', '反应对比'],
  timing_punch: ['timing_punch', '节奏打点'],
  recognition_shift: ['recognition_shift', '认知变化'],
  face_change: ['face_change', '表情断裂'],
  status_reset: ['status_reset', '关系重置'],
  transition_boundary: ['transition_boundary', '过渡边界'],
  memory_texture: ['memory_texture', '记忆质感'],
  return_path: ['return_path', '返回现实'],
  fact_delivery: ['fact_delivery', '信息揭示', '信息可读'],
  timeline_separation: ['timeline_separation', '时间线区分'],
  emotional_echo: ['emotional_echo', '情感回响'],
  atmosphere: ['atmosphere', '氛围'],
  entry_hint: ['entry_hint', '进入暗示'],
  exit_direction: ['exit_direction', '离场方向'],
  bridge_state: ['bridge_state', '桥接状态'],
  handoff: ['handoff', '交接'],
};

const KB_CACHE = new Map();

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function parseInlineJson(raw, fallback = []) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function extractTaggedItems(section) {
  return [...section.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function extractSection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match ? match[1].trim() : '';
}

function parseBucketFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const bucketMatch = content.match(/^# Bucket:\s*([a-z_]+)/m);
  const bucket = bucketMatch ? bucketMatch[1] : path.basename(filePath).replace(/^\d+_/, '').replace(/-v\d+\.md$/i, '').toLowerCase();

  const commonTags = [
    ...extractTaggedItems(extractSection(content, '常见结构标签')),
    ...extractTaggedItems(extractSection(content, '常见视觉标签')),
    ...extractTaggedItems(extractSection(content, '常见补强目标')),
  ];

  const examples = [];
  const headingRegex = /^### `([^`]+)`\s*$/gm;
  const headings = [...content.matchAll(headingRegex)];

  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const next = headings[index + 1];
    const section = content.slice(current.index, next ? next.index : content.length);
    const exampleId = current[1];
    const patternSummary = (section.match(/- `pattern_summary`:\s*(.+)/) || [null, ''])[1].trim();
    const cameraBias = parseInlineJson((section.match(/- `camera_bias`:\s*`([^`]+)`/) || [null, ''])[1]);
    const mustCover = parseInlineJson((section.match(/- `must_cover`:\s*`([^`]+)`/) || [null, ''])[1]);
    const examplePrompt = ((section.match(/<summary>example_prompt（完整三段式正例）<\/summary>\s*[\r\n]+```[\r\n]([\s\S]*?)```/) || [null, ''])[1] || '').trim();

    examples.push({
      bucket,
      example_id: exampleId,
      pattern_summary: patternSummary,
      camera_bias: cameraBias,
      must_cover: mustCover,
      example_prompt: examplePrompt,
      source_file: filePath,
    });
  }

  return {
    bucket,
    common_tags: [...new Set(commonTags)],
    examples,
    file_path: filePath,
  };
}

/**
 * 同一逻辑桶可能同时存在 `1_Dialogue-v1.md` 与 `1_Dialogue-v2.md`；取 **-v 版本号最高** 的文件，
 * 避免 `byBucket` 被后解析文件覆盖或出现重复桶键。无 `-vN` 后缀的文件按 stem 唯一参与比较（ver=0）。
 * @param {string} resolvedDir
 * @returns {string[]}
 */
function listKbBucketMarkdownFiles(resolvedDir) {
  const all = fs
    .readdirSync(resolvedDir)
    .filter((name) => /^\d+_.+\.md$/i.test(name) && !name.startsWith('0_'));
  /** @type {Map<string, { name: string, ver: number }>} */
  const best = new Map();
  for (const name of all) {
    const mv = name.match(/^(.+)-v(\d+)\.md$/i);
    let stem;
    let ver = 0;
    if (mv) {
      stem = mv[1];
      ver = parseInt(mv[2], 10);
    } else {
      stem = name.replace(/\.md$/i, '');
    }
    const cur = best.get(stem);
    if (!cur || ver > cur.ver) {
      best.set(stem, { name, ver });
    }
  }
  return [...best.values()].map((x) => x.name).sort((a, b) => a.localeCompare(b));
}

function loadKnowledgeBase(kbDir = DEFAULT_KB_DIR) {
  const resolvedDir = path.resolve(kbDir);
  if (KB_CACHE.has(resolvedDir)) {
    return KB_CACHE.get(resolvedDir);
  }

  const bucketFiles = listKbBucketMarkdownFiles(resolvedDir);

  const buckets = bucketFiles.map((fileName) => parseBucketFile(path.join(resolvedDir, fileName)));
  const byBucket = new Map(buckets.map((bucket) => [bucket.bucket, bucket]));
  const kb = { buckets, byBucket, kb_dir: resolvedDir };
  KB_CACHE.set(resolvedDir, kb);
  return kb;
}

function makeExampleSearchText(bucket, example) {
  return [
    bucket.bucket,
    bucket.common_tags.join(' '),
    example.example_id,
    example.pattern_summary,
    example.camera_bias.join(' '),
    example.must_cover.join(' '),
    example.example_prompt,
  ].join(' ').toLowerCase();
}

function countTagMatches(text, tags) {
  let score = 0;

  for (const tag of tags || []) {
    const hints = TAG_HINTS[tag] || [tag];
    if (hints.some((hint) => text.includes(String(hint).toLowerCase()))) {
      score += 1;
    }
  }

  return score;
}

function scoreExample(bucket, example, retrieval) {
  const text = makeExampleSearchText(bucket, example);
  const mustCover = new Set(example.must_cover || []);
  const injectionGoals = retrieval.injection_goals || [];
  const structuralTags = retrieval.structural_tags || [];
  const visualTags = retrieval.visual_tags || [];

  let score = 0;

  if (retrieval.scene_bucket && retrieval.scene_bucket !== 'mixed' && bucket.bucket === retrieval.scene_bucket) {
    score += 40;
  }

  for (const goal of injectionGoals) {
    if (mustCover.has(goal)) {
      score += 12;
    }
  }

  score += countTagMatches(text, structuralTags) * 4;
  score += countTagMatches(text, visualTags) * 3;
  score += countTagMatches(text, injectionGoals) * 2;

  if (bucket.common_tags.some((tag) => structuralTags.includes(tag) || visualTags.includes(tag))) {
    score += 3;
  }

  return score;
}

function pickExamplesForBucket(bucket, retrieval, maxExamples) {
  const ranked = bucket.examples
    .map((example) => ({
      ...example,
      _score: scoreExample(bucket, example, retrieval),
    }))
    .sort((left, right) => right._score - left._score || left.example_id.localeCompare(right.example_id));

  return ranked.slice(0, maxExamples);
}

function selectFewShotContext({ kbDir = DEFAULT_KB_DIR, retrieval, maxExamples = 2 } = {}) {
  if (!retrieval || !retrieval.scene_bucket) {
    return null;
  }

  const kb = loadKnowledgeBase(kbDir);
  const selected = [];

  if (retrieval.scene_bucket === 'mixed') {
    const rankedBuckets = kb.buckets
      .map((bucket) => ({
        bucket,
        examples: pickExamplesForBucket(bucket, retrieval, 1),
      }))
      .filter((entry) => entry.examples.length > 0 && entry.examples[0]._score > 0)
      .sort((left, right) => right.examples[0]._score - left.examples[0]._score);

    for (const entry of rankedBuckets.slice(0, Math.max(2, maxExamples))) {
      selected.push(...entry.examples);
      if (selected.length >= maxExamples) {
        break;
      }
    }
  } else {
    const bucket = kb.byBucket.get(retrieval.scene_bucket);
    if (bucket) {
      selected.push(...pickExamplesForBucket(bucket, retrieval, maxExamples));
    }

    if (selected.length === 0) {
      const fallback = kb.buckets
        .flatMap((bucketEntry) => pickExamplesForBucket(bucketEntry, retrieval, 1))
        .sort((left, right) => right._score - left._score);
      selected.push(...fallback.slice(0, maxExamples));
    }
  }

  const selectedExamples = selected
    .filter((example) => example._score > 0)
    .slice(0, maxExamples)
    .map((example) => ({
      example_id: example.example_id,
      pattern_summary: example.pattern_summary,
      camera_bias: example.camera_bias,
      must_cover: example.must_cover,
      example_prompt: example.example_prompt,
      source_bucket: example.bucket,
    }));

  return {
    scene_bucket: retrieval.scene_bucket,
    selected_examples: selectedExamples,
    injection_rules: [
      'few-shot 只迁移模式，不迁移具体人物、场景、道具',
      '若与 editMapBlock 冲突，以 editMapBlock 为准',
      'example_prompt 仅作为模式参考，不得直接复制其中事实内容',
    ],
  };
}

function buildPrevBlockContext(blocks, blockIndex) {
  if (blockIndex <= 0) {
    return null;
  }

  const previous = blocks[blockIndex - 1];
  const continuity = previous && previous.continuity_hints ? previous.continuity_hints : {};

  return {
    continuity_state: {
      lighting_state: continuity.lighting_state || null,
      axis_state: continuity.axis_state || null,
      focal_area_dominant: continuity.focal_area_dominant || null,
      last_action_state: continuity.last_action_state || null,
    },
  };
}

function findBlock(editMap, blockId) {
  const blocks = Array.isArray(editMap.blocks) ? editMap.blocks : [];
  const blockIndex = blockId
    ? blocks.findIndex((block) => block.id === blockId)
    : 0;

  if (blockIndex < 0 || !blocks[blockIndex]) {
    throw new Error(`未找到 Block: ${blockId}`);
  }

  return { blocks, block: blocks[blockIndex], blockIndex };
}

/**
 * 读取 call_sd2_director 输出的 sd2_director_all.json，得到 block_id → Director JSON。
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function loadDirectorBlocksMapFromFile(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const raw = loadJson(resolved);
  const map = Object.create(null);
  const rows = Array.isArray(raw.blocks) ? raw.blocks : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const id = row.block_id;
    const result = row.result;
    if (id && result && typeof result === 'object') {
      map[id] = result;
    }
  }
  return map;
}

/**
 * SD2Director 单 Block 输入（与 prompt/2_SD2Director/2_SD2Director-v1.md 对齐，不含 art_style）。
 */
function buildDirectorPayload({
  editMap,
  blockId,
  kbDir = DEFAULT_KB_DIR,
  renderingStyle,
  aspectRatio = '16:9',
  maxExamples = 2,
} = {}) {
  const { blocks, block, blockIndex } = findBlock(editMap, blockId);
  const fewShotContext = selectFewShotContext({
    kbDir,
    retrieval: block.few_shot_retrieval,
    maxExamples,
  });

  return {
    edit_map_block: block,
    asset_tag_mapping: editMap.meta?.asset_tag_mapping || [],
    prev_block_context: buildPrevBlockContext(blocks, blockIndex),
    few_shot_context: fewShotContext,
    rendering_style: renderingStyle || editMap.meta?.rendering_style || '3D写实动画',
    aspect_ratio: aspectRatio,
  };
}

/**
 * 全 Block 的 Director 输入包装（供 call_sd2_director 批量调用）。
 */
function buildAllDirectorPayloads({
  editMap,
  kbDir = DEFAULT_KB_DIR,
  renderingStyle,
  aspectRatio = '16:9',
  maxExamples = 2,
} = {}) {
  return {
    meta: {
      source_title: editMap.meta?.title || null,
      block_count: Array.isArray(editMap.blocks) ? editMap.blocks.length : 0,
      generated_at: new Date().toISOString(),
      kb_dir: path.resolve(kbDir),
      kind: 'sd2_director_payloads',
    },
    payloads: (editMap.blocks || []).map((block) => ({
      block_id: block.id,
      payload: buildDirectorPayload({
        editMap,
        blockId: block.id,
        kbDir,
        renderingStyle,
        aspectRatio,
        maxExamples,
      }),
    })),
  };
}

function buildPrompterPayload({
  editMap,
  blockId,
  kbDir = DEFAULT_KB_DIR,
  renderingStyle,
  artStyle,
  maxExamples = 2,
  aspectRatio = '16:9',
  directorByBlockId = null,
} = {}) {
  const { blocks, block, blockIndex } = findBlock(editMap, blockId);
  const fewShotContext = selectFewShotContext({
    kbDir,
    retrieval: block.few_shot_retrieval,
    maxExamples,
  });

  /** @type {Record<string, unknown>} */
  const out = {
    edit_map_block: block,
    asset_tag_mapping: editMap.meta?.asset_tag_mapping || [],
    prev_block_context: buildPrevBlockContext(blocks, blockIndex),
    few_shot_context: fewShotContext,
    rendering_style: renderingStyle || editMap.meta?.rendering_style || '3D写实动画',
    art_style: artStyle !== undefined ? artStyle : (editMap.meta?.art_style || null),
    aspect_ratio: aspectRatio,
  };
  if (directorByBlockId && typeof directorByBlockId === 'object' && directorByBlockId[block.id]) {
    out.sd2_director = directorByBlockId[block.id];
  }
  return out;
}

function buildAllPrompterPayloads({
  editMap,
  kbDir = DEFAULT_KB_DIR,
  renderingStyle,
  artStyle,
  maxExamples = 2,
  aspectRatio = '16:9',
  directorByBlockId = null,
} = {}) {
  return {
    meta: {
      source_title: editMap.meta?.title || null,
      block_count: Array.isArray(editMap.blocks) ? editMap.blocks.length : 0,
      generated_at: new Date().toISOString(),
      kb_dir: path.resolve(kbDir),
    },
    payloads: (editMap.blocks || []).map((block) => ({
      block_id: block.id,
      payload: buildPrompterPayload({
        editMap,
        blockId: block.id,
        kbDir,
        renderingStyle,
        artStyle,
        maxExamples,
        aspectRatio,
        directorByBlockId,
      }),
    })),
  };
}

function parseArgs(argv) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) {
      args._.push(current);
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function printUsage() {
  console.log(`
用法:
  node scripts/build_sd2_prompter_payload.js <edit_map_json> [--block B01] [--output out.json]
    [--rendering-style "3D写实动画"] [--art-style "冷调偏青"]
    [--kb-dir prompt/1_SD2Workflow/3_FewShotKnowledgeBase] [--max-examples 2]
    [--aspect-ratio 16:9]
    [--director-json path/to/sd2_director_all.json]
    [--director-payloads-only]

说明:
  - 默认输出所有 Block 的 SD2Prompter 输入 payload
  - 传入 --block 时仅输出单个 Block payload
  - --director-payloads-only：只生成 SD2Director 阶段输入（全量或单 block），不写 sd2_director
  - --director-json：合并 Director LLM 输出后，再生成 SD2Prompter 输入（字段 sd2_director）
  - 胶水代码会自动:
    1. 从上一 Block 投影 prev_block_context
    2. 基于 few_shot_retrieval 从 3_FewShotKnowledgeBase 选择 few-shot
    3. 把 example_prompt 一并注入 few_shot_context
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args._[0];

  if (!inputPath || args.help) {
    printUsage();
    process.exit(inputPath ? 0 : 2);
  }

  const resolvedInput = path.resolve(process.cwd(), inputPath);
  const editMap = loadJson(resolvedInput);
  const kbDir = args['kb-dir'] ? path.resolve(process.cwd(), args['kb-dir']) : DEFAULT_KB_DIR;
  const maxExamples = Number(args['max-examples'] || 2);
  const aspectRatio = typeof args['aspect-ratio'] === 'string' ? args['aspect-ratio'] : '16:9';

  if (args['director-payloads-only']) {
    const data = args.block
      ? buildDirectorPayload({
          editMap,
          blockId: args.block,
          kbDir,
          renderingStyle: args['rendering-style'],
          aspectRatio,
          maxExamples,
        })
      : buildAllDirectorPayloads({
          editMap,
          kbDir,
          renderingStyle: args['rendering-style'],
          aspectRatio,
          maxExamples,
        });
    if (args.output) {
      const outputPath = path.resolve(process.cwd(), args.output);
      saveJson(outputPath, data);
      console.log(`[sd2-payload] Director 输入已保存: ${outputPath}`);
      return;
    }
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  let directorByBlockId = null;
  if (args['director-json']) {
    directorByBlockId = loadDirectorBlocksMapFromFile(args['director-json']);
  }

  const data = args.block
    ? buildPrompterPayload({
        editMap,
        blockId: args.block,
        kbDir,
        renderingStyle: args['rendering-style'],
        artStyle: Object.prototype.hasOwnProperty.call(args, 'art-style') ? args['art-style'] : undefined,
        maxExamples,
        aspectRatio,
        directorByBlockId,
      })
    : buildAllPrompterPayloads({
        editMap,
        kbDir,
        renderingStyle: args['rendering-style'],
        artStyle: Object.prototype.hasOwnProperty.call(args, 'art-style') ? args['art-style'] : undefined,
        maxExamples,
        aspectRatio,
        directorByBlockId,
      });

  if (args.output) {
    const outputPath = path.resolve(process.cwd(), args.output);
    saveJson(outputPath, data);
    console.log(`[sd2-payload] 已保存: ${outputPath}`);
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[sd2-payload] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_KB_DIR,
  buildAllDirectorPayloads,
  buildAllPrompterPayloads,
  buildDirectorPayload,
  buildPrompterPayload,
  findBlock,
  loadDirectorBlocksMapFromFile,
  loadKnowledgeBase,
  parseBucketFile,
  scoreExample,
  selectFewShotContext,
};
