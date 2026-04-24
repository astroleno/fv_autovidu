我按你给的包看了 README、Stage 0/1/1.5/2/3 的 prompt、knowledge slices 和 injection map。结论如下：

这套链路的**大方向是成立的**：
Stage 0 做机械锚点，Stage 1 做叙事切块，L2 做结构化转译，Stage 1.5 做节奏/KVA 微调，Director 做 shot plan，Prompter 做最终 SD2 prompt。职责拆得比“一步大 JSON”稳定很多。

但目前最大风险在于：**文档里分层很清楚，字段传递却有几处隐式依赖和 schema 漂移**。尤其是 L2 Translator、Scene Architect、Director payload builder 之间，存在“上游产了，但下游未必明确消费”的问题。

---

## 1. 总体工作流判断

推荐的数据流应该是：

```text
edit_map_input.json
  + 原始剧本 / episode / brief / assets
        ↓
Stage 0 ScriptNormalizer
  → normalized_script_package.json
        ↓
Stage 1 L1 EditMap pure_md
  → edit_map_sd2.l1_pure_md.md
        ↓
Stage 1 L2 Translator
  → edit_map_sd2.json
        ↓
Stage 1.5 Scene Architect
  → scene_architect_output.json
  → merge back edit_map_sd2.json
        ↓
Director payload builder
  → sd2_director_payloads.json
        ↓
Director per block
  → sd2_director_all.json
        ↓
Prompter per block
  → prompts/Bxx.json
        ↓
final report
```

这条链路的问题不在“层太多”，而在几个层之间的接口还不够硬。

---

# P0：需要优先修的工作流 / 数据传递问题

## P0-1：L2 Translator 的输入不足，容易从“转译器”变成“二次创作者”

README 里写 L2 输入是：

```text
edit_map_sd2.l1_pure_md.md
```

但 `1_EditMap-Translator-v1.md` 里又要求它生成：

* `asset_tag_mapping`
* `normalizedSegmentContext`
* `style_inference`
* `rhythm_timeline`
* `routing`
* `status_curve`
* `emotion_loops`
* `psychology_plan`
* `info_gap_ledger`
* `proof_ladder`
* `paywall_scaffolding`

其中不少字段**单靠 L1 markdown 是推不稳的**，尤其是：

* `asset_tag_mapping` 需要 `assetManifest`
* `SEG / BT` 还原需要 `beat_to_segments / ordered_segment_ids`
* `style_inference` 最好需要 `directorBrief / globalSynopsis / genre_bias_inferred`
* `routing` 需要词表和下游消费约束

### 建议

L2 Translator 的真实输入不要只给 pure_md，应该改成：

```json
{
  "l1_markdown": "...",
  "normalizedSegmentContext": {
    "beat_to_segments": {},
    "ordered_segment_ids": [],
    "beats_with_zero_segments": []
  },
  "assetManifest": [],
  "episode": {},
  "directorBrief": {},
  "globalSynopsis": "",
  "normalizer_meta": {
    "genre_bias_inferred": {}
  }
}
```

同时把 Translator 的定位从“补全一堆 meta”收紧为：

```text
只转译 L1 ledger 中已有事实；
允许补默认值；
高语义字段必须带 source/evidence；
证据不足就 null / [] / notice_msg。
```

否则 L2 是当前最容易引入漂移的点。

---

## P0-2：`rhythm_timeline` 的 schema 没有完全冻结，Stage 1.5 会吃不稳

L1 Rhythm Ledger 用的是：

```text
open: block=B01 | type=signature_entrance | at_sec=0
mini_1: block=B03 | motif=... | at_sec=24 | trigger=SEG_008
major: block=B10 | strategy=evidence_drop | at_sec=104 | trigger=SEG_028
closing: block=B11 | type=split_screen_freeze | at_sec=118 | cliff=true
```

Scene Architect 期待的是：

```json
{
  "golden_open_3s": {},
  "mini_climaxes": [
    {
      "seq": 1,
      "at_sec": 24,
      "block_id": "B05",
      "motif": "...",
      "trigger_source_seg_id": "SEG_015",
      "duration_sec": 7,
      "five_stage": {}
    }
  ],
  "major_climax": {},
  "closing_hook": {}
}
```

Translator 文档只说 `rhythm_timeline` 至少包含这些字段，但没有把 `block → block_id`、`trigger → trigger_source_seg_id`、`open → golden_open_3s` 的转换规则彻底钉死。

### 建议

单独冻结一个 canonical schema，例如：

```json
{
  "derived_from": "editmap_l1_rhythm_ledger",
  "golden_open_3s": {
    "block_id": "B01",
    "type": "signature_entrance",
    "at_sec": 0,
    "required": true
  },
  "mini_climaxes": [
    {
      "seq": 1,
      "block_id": "B03",
      "at_sec": 24,
      "motif": "info_gap_control",
      "trigger_source_seg_id": "SEG_008",
      "five_stage": {
        "trigger": {"shot_idx_hint": null},
        "amplify": {"shot_idx_hint": null},
        "pivot": {"shot_idx_hint": null},
        "payoff": {"shot_idx_hint": null},
        "residue": {"shot_idx_hint": null}
      }
    }
  ],
  "major_climax": {
    "block_id": "B10",
    "at_sec": 104,
    "strategy": "evidence_drop",
    "trigger_source_seg_id": "SEG_028"
  },
  "closing_hook": {
    "block_id": "B11",
    "type": "split_screen_freeze",
    "at_sec": 118,
    "cliff": true
  },
  "info_density_contract": {}
}
```

然后 L2、Scene Architect、Director、Prompter 全部只认这份结构。

---

## P0-3：Scene Architect 的 KVA 编排结果目前缺少明确下游消费者

Scene Architect 会输出：

```json
"kva_arrangements": [
  {
    "kva_id": "KVA_001",
    "suggested_block_id": "B01",
    "suggested_shot_role": "opening_beat",
    "rationale": "..."
  }
]
```

但 README 里列的 Director payload 关键字段是：

* `scriptChunk`
* `styleInference`
* `rhythmTimelineForBlock`
* `infoDensityContract`
* `v5Meta.shotSlots`

没有明确说 `kva_arrangements` 怎么进入 Director。

Director v6 主要读的是：

```json
scriptChunk.key_visual_actions[]
```

它的示例里没有 `suggested_block_id / suggested_shot_role`。这意味着 Stage 1.5 虽然做了 KVA 编排，但下游可能仍按 `source_seg_id` 自己猜 shot role，Scene Architect 的工作会被浪费。

### 建议

在 merge 或 payload builder 阶段，把 Scene Architect 的结果合并进 KVA 本体：

```json
{
  "kva_id": "KVA_001",
  "source_seg_id": "SEG_001",
  "action_type": "signature_entrance",
  "priority": "P0",
  "summary": "...",
  "required_structure_hints": ["low_angle", "pan_up"],

  "scene_architect": {
    "suggested_block_id": "B01",
    "suggested_shot_role": "opening_beat",
    "rationale": "..."
  }
}
```

Director payload 里也应显式列出：

```json
"kvaForBlock": []
```

或者保证 `scriptChunk.key_visual_actions[]` 已经带上 `scene_architect` 子对象。

---

## P0-4：mini climax 的“五段式”与 shot 时长约束存在物理冲突

Director 约束里有两条：

1. 每个 shot 通常 `>= 3s`，冲击帧例外可 `2s`，每组最多 1 个。
2. mini climax block 要 `shot 数 ≥ 5`，五段式 `{trigger, amplify, pivot, payoff, residue}` 全覆盖。

这会导致一个现实约束：

```text
5 shots 最小时长 = 3 + 3 + 3 + 3 + 2 = 14s
```

也就是说，一个 mini climax block 至少要 14 秒才合法。

但 EditMap v7 说单块通常 `4–16s`，Scene Architect 示例里 mini climax 还有 `duration_sec: 7`。如果一个 7 秒 block 命中 mini climax，Director 无论怎么写都会在“5 shots”与“shot 最小时长”之间冲突。

### 建议二选一

方案 A：五段式改成“逻辑阶段”，不是“每阶段必独立 shot”。

```text
允许一个 shot 承担多个 five_stage_role。
例如：
shot 1 = trigger + amplify
shot 2 = pivot
shot 3 = payoff
shot 4 = residue
```

方案 B：payload builder 对 mini climax block 强制扩时 / 合并相邻 block。

```text
若 block 命中 mini_climax，则 duration >= 14s，shotSlots.target >= 5。
```

更推荐方案 A。短剧 60–120 秒里，强制每个 mini climax 都 14 秒以上，会挤压其他 block。

---

## P0-5：`injection_map.yaml` 引用了很多包内不存在的切片路径

`injection_map.yaml` 里有这些路径：

```text
director/satisfaction/status_reversal.md
director/satisfaction/control.md
director/satisfaction/exclusive_favor.md
director/satisfaction/instant_justice.md
director/psychology/hook.md
director/psychology/retention.md
director/psychology/payoff.md
director/psychology/bonding.md
director/psychology/relationship.md
director/psychology/conversion.md
director/shot_codes/A_event.md
director/shot_codes/B_emotion.md
director/shot_codes/C_transition.md
director/shot_codes/D_welfare.md
director/paywall/soft.md
director/paywall/hard.md
director/paywall/final_cliff.md
```

但包里实际没有这些文件。

如果运行器按 map 机械读取，可能出现两种坏结果：

1. 直接文件读取失败；
2. 静默跳过，导致 routing 命中但知识没注入，下游表现漂移。

### 建议

加一个 preflight：

```text
检查 injection_map.yaml 中所有 path 是否存在；
缺失时直接 fail fast；
允许 review bundle 裁剪，但要提供 pruned injection_map.review.yaml。
```

如果这是“只打包实际参与材料”的评审包，那当前 `injection_map.yaml` 就不应该保留完整生产路由表，应该给评审包专用裁剪版。

---

# P1：中优先级的数据契约问题

## P1-1：`scene_bucket` 有两套含义，容易污染 few-shot 和 Prompter

Few-shot Retrieval Contract v2 的 bucket 是：

```text
dialogue / emotion / reveal / action / transition / memory / spectacle
```

但 Director / Prompter slice 里又写：

```text
dialogue / action / ambience / mixed
```

Prompter 的 `avsplit_template.md` 还说 `scene_bucket` 来源是：

```text
block_index[i].routing.scene_bucket
```

而 Translator 文档里 `scene_bucket` 是 `block_index[]` 的字段，不一定在 `routing` 里。

这会导致三个问题：

1. `scene_bucket = spectacle` 时 Prompter 不知道怎么分支；
2. `scene_bucket = ambience` 时 few-shot 检索库没有对应桶；
3. 字段位置在 `block_index.scene_bucket` 还是 `block_index.routing.scene_bucket` 不一致。

### 建议

拆成两个字段：

```json
{
  "scene_bucket_fskb": "spectacle",
  "scene_archetype": "beauty_reveal",
  "render_bucket": "action",
  "av_bucket": "mixed",
  "routing": {
    "structural": [],
    "satisfaction": [],
    "psychology": [],
    "shot_hint": [],
    "paywall_level": "none"
  }
}
```

或者至少定义映射：

```text
emotion/reveal/memory/transition/spectacle → av_bucket: ambience/action/dialogue/mixed
```

不要让同一个 `scene_bucket` 同时服务 few-shot、Director routing 和 Prompter AV 分支。

---

## P1-2：Segment 复用允许了，但“所有权”没有定义

EditMap v7 允许多个 block 复用同一个 `SEG_xxx`，例如前一块 tail、后一块 lead 都指向同一个 segment。

这是合理的，因为切块时经常需要承接。但 Director / Prompter 阶段会遇到问题：

* 如果两个 block 都把同一个 dialogue seg 放进 `scriptChunk.segments[]`，对白可能重复出现；
* 如果一个 seg 是 lead context，只是承接，不应该再次消费；
* `covered / must / lead / tail` 不足以判断“谁负责真正生成这句对白”。

### 建议

在 payload builder 阶段增加 ownership：

```json
{
  "scriptChunk": {
    "segments": [
      {
        "seg_id": "SEG_010",
        "consumption_role": "owned",
        "allow_dialogue_output": true
      },
      {
        "seg_id": "SEG_009",
        "consumption_role": "lead_context",
        "allow_dialogue_output": false
      }
    ],
    "owned_segment_ids": ["SEG_010", "SEG_011"],
    "context_segment_ids": ["SEG_009"]
  }
}
```

Prompter 的 `dialogue_fidelity_check` 应只检查 `allow_dialogue_output=true` 的 dialogue segments。否则 overlap 会导致重复对白或误判漏覆盖。

---

## P1-3：`overflow_policy` / `deferred_to_block` 与并发 Director 有冲突

Director 允许：

```json
"missing_must_cover": [
  {
    "seg_id": "SEG_012",
    "reason": "...",
    "deferred_to_block": "B05"
  }
]
```

但 Director 是 per block 并发生成的。B04 运行时决定 defer 到 B05，B05 可能已经生成完了，无法保证它真的消费这条 seg。

### 建议

动态 defer 不应发生在 Director 阶段。应该前移到 payload builder：

```text
EditMap / payload builder 预先决定每个 SEG 的 owner block；
Director 只能报告无法消费；
不能临时把 must_cover 推给另一个已经并发运行的 block。
```

`overflow_policy` 可以保留为上下文提示，但不应作为并发阶段的真实数据迁移机制。

---

## P1-4：KVA action_type 词表与 rhythm template 使用的 action_type 不一致

Normalizer v2 里 KVA `action_type` 表主要有：

```text
signature_entrance
discovery_reveal
intimate_betrayal
performative_affection
split_screen
freeze_frame
flashback
cross_cut
inner_voice
```

但 `v6_rhythm_templates.md` 的 major climax strategy 映射里用到了：

```text
status_reveal
transformation
ability_visualized
evidence_drop
confrontation_face
```

这些不在 Normalizer KVA 表里。结果是：模板想通过 KVA 判断 major strategy，但 Normalizer 很多时候不会产这些 action_type。

### 建议

扩展 Normalizer KVA 枚举，或者把 rhythm template 改成：

```text
优先读 KVA；
其次读 structure_hints；
再次读 segment text keywords；
不要假设 KVA 一定含 status_reveal/evidence_drop/ability_visualized。
```

更好的做法是把 KVA action_type 统一为一份枚举，Stage 0、Rhythm Template、Director 全部引用同一份。

---

## P1-5：`style_inference.genre_bias.value` 与 `genre_bias.primary` 有版本漂移

README 已经提示：

```text
edit_map_sd2.json 里 meta.style_inference.genre_bias.value 仍缺失
```

但 Translator 文档定义的是：

```json
"genre_bias": {
  "primary": "...",
  "secondary": [],
  "confidence": "...",
  "evidence": [],
  "source": "..."
}
```

Director 也读的是：

```text
genre_bias.primary
```

说明当前可能是旧校验器还在找 `genre_bias.value`。

### 建议

短期兼容：

```json
"genre_bias": {
  "value": "short_drama_contrast_hook",
  "primary": "short_drama_contrast_hook",
  "secondary": [],
  "confidence": "mid",
  "evidence": [],
  "source": "..."
}
```

长期只保留一个字段，建议保留 `primary`，更新 validator。

---

# P2：小但会增加维护成本的问题

## P2-1：版本命名漂移

当前核心链路是 v7，但多个文件仍写：

* EditMap v6
* payload builder v6
* Director v6
* Prompter v6
* Scene Architect 依赖 EditMap v6

这不一定影响运行，但对维护很不友好。建议统一叫：

```text
EditMap L1 v7
EditMap canonical schema v7
Director v6 compatible with EditMap v7
Prompter v6 compatible with EditMap v7
```

或者在 README 里加一张 compatibility matrix。

---

## P2-2：Scene Architect 的 `rhythm_adjustments` 规则自相矛盾

文档一处说：

```text
超 3s 时不调，但在 rhythm_adjustments[] 写 reason
```

另一处又说：

```text
只给实际改过的条目留痕；未改不写
```

建议拆出：

```json
"rhythm_adjustments": [],
"rhythm_adjustment_skips": [
  {
    "target": "mini_climaxes[0].at_sec",
    "before_sec": 32,
    "reason": "exceeds_3s_tolerance"
  }
]
```

这样审计清晰，也不会污染 `delta_sec` 语义。

---

## P2-3：Translator 里说 routing 有“六字段”，但只列了五个

文档写：

```text
routing 必须包含六字段
```

下面列的是：

```text
structural
satisfaction
psychology
shot_hint
paywall_level
```

只有五个。

建议明确第六个到底是：

* `scene_bucket`
* `psychology_group`
* `satisfaction_motif`
* `paywall_level`
* 还是别的字段

否则 injection map 的匹配会继续依赖隐式字段。

---

# 建议的最小修复路径

按收益/成本排序，我建议先做这 6 件事：

1. **冻结 `edit_map_sd2.json` canonical schema**
   尤其是 `appendix.meta.style_inference`、`rhythm_timeline`、`block_index[]`、`routing`、`script_chunk_hint`。

2. **扩充 L2 Translator 输入 payload**
   不要只给 L1 markdown，必须给 `normalizedSegmentContext / assetManifest / episode / brief / normalizer_meta`。

3. **修 Scene Architect → Director 的 KVA 传递**
   把 `kva_arrangements` merge 回 `scriptChunk.key_visual_actions[]`，否则 Stage 1.5 的 KVA 编排可能没有实际消费方。

4. **解决 mini climax 五段式与 shot 时长冲突**
   推荐让一个 shot 可以承载多个 five-stage role，不要强制 5 shots。

5. **拆分 `scene_bucket` 语义**
   至少区分 `scene_bucket_fskb` 和 `av_bucket`，避免 spectacle / memory / reveal 进入 Prompter 后无分支可用。

6. **给 injection map 加文件存在性 preflight**
   缺文件就 fail fast；评审包使用裁剪后的 map。

---

## 最终判断

这套 workflow 的结构是对的，尤其是：

* Stage 0 只做机械锚点；
* L1 用 ledger-first pure_md 降低大 JSON 漂移；
* L2 单独做 canonical JSON；
* Scene Architect 不改叙事，只微调节奏和 KVA；
* Director / Prompter 都有覆盖报告和自检字段。

但目前还不是一个完全“硬接口”的管线。核心问题是：

```text
上游产出的字段太多依赖 prompt 约定；
中间 merge / payload builder 的契约没有完全显式化；
部分字段名、枚举、bucket、timing 约束跨文件不一致。
```

优先把 L2 输入、canonical schema、Scene Architect merge、five-stage timing 这四个点修掉，整条链路会稳很多。
