'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  parseBucketFile,
  selectFewShotContext,
  buildPrompterPayload,
} = require('./build_sd2_prompter_payload');

const kbDir = path.join(__dirname, '..', 'prompt', '1_SD2Workflow', '3_FewShotKnowledgeBase');

test('parseBucketFile extracts example prompts from bucket markdown', () => {
  const filePath = path.join(kbDir, '1_Dialogue-v1.md');
  const bucket = parseBucketFile(filePath);

  assert.equal(bucket.bucket, 'dialogue');
  assert.equal(bucket.examples.length, 2);
  assert.equal(bucket.examples[0].example_id, 'dialogue_two_person_lowkey_v1');
  assert.match(bucket.examples[0].example_prompt, /@图1（沈渡）/);
});

test('selectFewShotContext ranks emotion example from retrieval keys', () => {
  const retrieval = {
    scene_bucket: 'emotion',
    structural_tags: ['single_subject', 'awakening', 'interior_pressure'],
    visual_tags: ['low_key_interior', 'cool_tone'],
    injection_goals: ['micro_expression', 'material_interaction', 'slow_push'],
  };

  const context = selectFewShotContext({
    kbDir,
    retrieval,
    maxExamples: 2,
  });

  assert.equal(context.scene_bucket, 'emotion');
  /** 知识库同时存在 v1/v2 时编排层优先选用 v2 桶文件 */
  assert.equal(context.selected_examples[0].example_id, 'emotion_awakening_lowkey_v2');
  assert.match(context.selected_examples[0].example_prompt, /秦狩/);
});

test('buildPrompterPayload projects previous continuity and injects few-shot examples', () => {
  const editMap = {
    meta: {
      asset_tag_mapping: [
        { tag: '@图1', asset_type: 'character', asset_id: '秦狩', asset_description: '年轻皇子，剑眉星目' },
        { tag: '@图2', asset_type: 'scene', asset_id: '寝宫', asset_description: '皇家寝宫' },
      ],
    },
    blocks: [
      {
        id: 'B01',
        location: { is_location_change: true },
        continuity_hints: {
          lighting_state: '低调',
          axis_state: '不适用',
          focal_area_dominant: '居中',
          last_action_state: '秦狩惊醒',
        },
      },
      {
        id: 'B02',
        time: { start_sec: 15, end_sec: 30, duration: 15 },
        location: { is_location_change: false },
        narrative: { phase: 'Setup', hook_type: null, summary: '秦狩观察环境' },
        sd2_scene_type: '文戏',
        block_script_content: '秦狩坐起后观察环境。',
        dialogues: [],
        dialogue_time_budget: {
          total_sec: 0,
          per_line: [],
          remaining_sec: 15,
          non_dialogue_floor: 3,
        },
        scene_synopsis: '秦狩在寝宫内观察四周。',
        visuals: {
          lighting_state: '低调',
          lighting_direction: '左侧主光',
          atmosphere: '幽暗压抑',
          depth_layers: { foreground: '帷幔', midground: '秦狩', background: '屏风' },
          focal_area: { dominant: '居中', rationale: '单主体' },
          visual_keywords: [],
        },
        assets_required: {
          characters: [{ id: '秦狩', attire_state: '睡袍造型' }],
          props: [],
          scenes: [{ id: '寝宫', variant: '夜间灯火' }],
          vfx: [],
        },
        transition_out: { type: 'Cut', duration_frames: 0, narrative_reason: null },
        audio_cue: { sfx: null, intensity: null, sync_point: null },
        continuity_hints: {
          lighting_state: '低调',
          axis_state: '不适用',
          focal_area_dominant: '居中',
          last_action_state: '秦狩起身观察',
        },
        few_shot_retrieval: {
          scene_bucket: 'emotion',
          structural_tags: ['single_subject', 'gaze_hold'],
          visual_tags: ['low_key_interior'],
          injection_goals: ['micro_expression', 'slow_push'],
        },
      },
    ],
  };

  const payload = buildPrompterPayload({
    editMap,
    blockId: 'B02',
    kbDir,
    renderingStyle: '3D写实动画',
    artStyle: '冷调偏青',
  });

  assert.equal(payload.edit_map_block.id, 'B02');
  assert.equal(payload.prev_block_context.continuity_state.last_action_state, '秦狩惊醒');
  assert.equal(payload.few_shot_context.scene_bucket, 'emotion');
  assert.match(payload.few_shot_context.selected_examples[0].example_prompt, /@图1/);
});

test('buildPrompterPayload falls back to editMap meta art_style when CLI override is absent', () => {
  const editMap = {
    meta: {
      asset_tag_mapping: [],
      art_style: '冷调偏青',
    },
    blocks: [
      {
        id: 'B01',
        time: { start_sec: 0, end_sec: 15, duration: 15 },
        location: { is_location_change: true },
        narrative: { phase: 'Hook', hook_type: null, summary: '单人情绪建立' },
        sd2_scene_type: '文戏',
        block_script_content: '秦狩缓缓抬头。',
        dialogues: [],
        dialogue_time_budget: {
          total_sec: 0,
          per_line: [],
          remaining_sec: 15,
          non_dialogue_floor: 3,
        },
        scene_synopsis: '秦狩在寝宫中缓缓抬头。',
        visuals: {
          lighting_state: '低调',
          lighting_direction: '左侧主光',
          atmosphere: '幽暗压抑',
          depth_layers: { foreground: '帷幔', midground: '秦狩', background: '屏风' },
          focal_area: { dominant: '居中', rationale: '单主体' },
          visual_keywords: [],
        },
        assets_required: { characters: [], props: [], scenes: [], vfx: [] },
        transition_out: { type: 'Cut', duration_frames: 0, narrative_reason: null },
        audio_cue: { sfx: null, intensity: null, sync_point: null },
        continuity_hints: {
          lighting_state: '低调',
          axis_state: '不适用',
          focal_area_dominant: '居中',
          last_action_state: '秦狩缓缓抬头',
        },
        few_shot_retrieval: {
          scene_bucket: 'emotion',
          structural_tags: ['single_subject'],
          visual_tags: ['low_key_interior'],
          injection_goals: ['micro_expression'],
        },
      },
    ],
  };

  const payload = buildPrompterPayload({
    editMap,
    blockId: 'B01',
    kbDir,
    renderingStyle: '3D写实动画',
  });

  assert.equal(payload.art_style, '冷调偏青');
});

test('buildPrompterPayload injects sd2_director when directorByBlockId matches', () => {
  const editMap = {
    meta: {
      asset_tag_mapping: [],
    },
    blocks: [
      {
        id: 'B01',
        time: { start_sec: 0, end_sec: 15, duration: 15 },
        location: { is_location_change: true },
        narrative: { phase: 'Hook', hook_type: null, summary: '测' },
        sd2_scene_type: '文戏',
        block_script_content: '测',
        dialogues: [],
        dialogue_time_budget: {
          total_sec: 0,
          per_line: [],
          remaining_sec: 15,
          non_dialogue_floor: 3,
        },
        scene_synopsis: '测',
        visuals: {
          lighting_state: '低调',
          lighting_direction: '左侧主光',
          atmosphere: '幽暗压抑',
          depth_layers: { foreground: '帷幔', midground: '秦狩', background: '屏风' },
          focal_area: { dominant: '居中', rationale: '单主体' },
          visual_keywords: [],
        },
        assets_required: { characters: [], props: [], scenes: [], vfx: [] },
        transition_out: { type: 'Cut', duration_frames: 0, narrative_reason: null },
        audio_cue: { sfx: null, intensity: null, sync_point: null },
        continuity_hints: {
          lighting_state: '低调',
          axis_state: '不适用',
          focal_area_dominant: '居中',
          last_action_state: '测',
        },
        few_shot_retrieval: {
          scene_bucket: 'emotion',
          structural_tags: ['single_subject'],
          visual_tags: ['low_key_interior'],
          injection_goals: ['micro_expression'],
        },
      },
    ],
  };

  const directorStub = { block_id: 'B01', time_slices: [], director_notes: 'stub' };
  const payload = buildPrompterPayload({
    editMap,
    blockId: 'B01',
    kbDir,
    renderingStyle: '3D写实动画',
    directorByBlockId: { B01: directorStub },
  });

  assert.deepEqual(payload.sd2_director, directorStub);
  assert.equal(payload.aspect_ratio, '16:9');
});
