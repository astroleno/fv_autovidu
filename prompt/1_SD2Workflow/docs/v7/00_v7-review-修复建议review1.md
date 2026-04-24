整体看，这份修复建议**质量较高，可以作为执行计划基础**。它比上一轮 review 更强的一点是：不只讨论 prompt 文案，而是把问题落到了 **schema / adapter / payload builder / validator** 这些真正决定链路稳定性的地方。尤其是 `rhythm_timeline` 导致所有 block 退化成 `filler`、`genre_bias.primary/value` 漂移、Stage 1.5 的 KVA 没进入 Director payload，这几个判断都很关键。

但我建议做几处收紧，否则这份修复计划会从“修契约”滑向“继续堆字段”。

## 结论

**建议采纳，但要调整两点：**

1. **P0 再分层**：现在 P0 太多，执行上会失焦。真正 release-blocker 只有 schema/adapter、full prompt、KVA 消费链路这几类。
2. **canonical schema 不要过重**：尤其 `rhythm_timeline` 示例里把 `five_stage` 和 `slots` 都塞进 L2 canonical，可能和“L2 只 parse/normalize，不做二次叙事设计”的原则冲突。

---

## 最值得保留的部分

### 1. “先修 schema / adapter，再修 prompt 话术”是正确优先级

这点非常对。当前问题不是单纯提示词写得不够细，而是上下游字段契约不一致。比如 `rhythm_timeline` 一边输出 `block`，另一边消费 `block_id / covered_blocks / slots`，这类问题靠 prompt 很难补救，只能靠 schema、adapter 和 validator 收口。

建议把这句话放到文档开头，作为最高原则：

```md
本轮修复优先处理机器契约，不优先改 prompt 文风。
凡跨阶段字段不一致，先修 schema / adapter / validator，再补 prompt 说明。
```

### 2. `rhythmTimelineForBlock` 全部退化成 `filler` 应列为最高优先级

这个是实际功能失效，不是风格问题。只要 Director payload 没拿到 mini climax / major climax / closing hook，下游 prompt 再强也会弱化成普通分镜生成。

建议把验收从“至少 3 个 mini climax block 命中”改成更机器化：

```text
For every meta.rhythm_timeline event:
- event.block_id must resolve to an existing block;
- buildDirectorPayload(block_id).rhythmTimelineForBlock.role must not be filler;
- event.trigger_source_seg_id, if present, must resolve to an existing SEG;
- missing / unresolved event must fail validation before Director call.
```

这样比固定“至少 3 个 mini climax”更通用。

### 3. `genre_bias.primary/value` 判断准确

这不是 LLM 缺字段，而是 prompt / validator / README 之间 schema 漂移。长期统一到 `primary` 是合理的。短期保留 `value` 作为 compatibility alias 也可以，但应加 sunset 机制：

```json
"genre_bias": {
  "primary": "short_drama_contrast_hook",
  "value": "short_drama_contrast_hook",
  "_compat": {
    "value_deprecated_after": "2026-05-15"
  }
}
```

否则临时兼容字段会变成永久双写，后面继续漂移。

---

## 我会调整的部分

### 1. P0 太宽，建议拆成 P0a / P0b / P1

当前 P0 包含：

* `rhythm_timeline` canonical schema
* `genre_bias`
* full prompt
* KVA merge
* `dialogue_char_count`
* L2 evidence / confidence

其中前四项确实接近 P0。`dialogue_char_count` 和 L2 evidence 更像 P1，除非现在已经造成硬失败。

建议改成：

| 级别  | 项目                                             | 原因                                   |
| --- | ---------------------------------------------- | ------------------------------------ |
| P0a | `rhythm_timeline` schema + adapter + fail fast | 已导致 Director block role 全部 filler    |
| P0a | full prompt 运行入口确认                             | 如果 runner 真读 delta，system prompt 不完整 |
| P0a | Scene Architect KVA merge                      | Stage 1.5 结果没有明确消费者                  |
| P0b | `genre_bias.primary/value`                     | 造成 shape warning，影响风格分支稳定性           |
| P1  | `dialogue_char_count` 代码重算                     | deterministic，应修，但不一定阻断生成            |
| P1  | L2 evidence / confidence                       | 质量和可审计性提升，不应拖住 schema 修复             |

这样执行顺序更清晰。

---

## 最大问题：`rhythm_timeline` canonical 示例有点过重

文档里建议的 canonical 结构包含：

```json
"five_stage": { ... },
"slots": { ... }
```

这可能不适合放在 L2 Translator 的 canonical schema 里。

原因是：文档后面又说 L2 的主职责是 parse / normalize，不做二次叙事设计。可是 `five_stage` 和 `slots` 已经接近 Scene Architect / Director 层的编排决策了。把它们提前塞进 L2，会让 L2 重新承担创作性补全。

我建议拆成两层：

### L2 canonical rhythm event：只做事实归一

```json
{
  "rhythm_timeline": {
    "golden_open_3s": {
      "event_id": "RT_OPEN_001",
      "role": "golden_open",
      "block_id": "B01",
      "at_sec": 0,
      "type": "signature_entrance",
      "required": true,
      "evidence_seg_ids": ["SEG_004"]
    },
    "mini_climaxes": [
      {
        "event_id": "RT_MINI_001",
        "role": "mini_climax",
        "block_id": "B02",
        "at_sec": 12,
        "motif": "隐痛曝光",
        "trigger_source_seg_id": "SEG_008",
        "confidence": "mid"
      }
    ],
    "major_climax": {
      "event_id": "RT_MAJOR_001",
      "role": "major_climax",
      "block_id": "B09",
      "at_sec": 82,
      "strategy": "evidence_drop",
      "trigger_source_seg_id": "SEG_044"
    },
    "closing_hook": {
      "event_id": "RT_CLOSE_001",
      "role": "closing_hook",
      "block_id": "B11",
      "at_sec": 112,
      "type": "split_screen_freeze",
      "cliff": true
    }
  }
}
```

### Scene Architect output：再做 five-stage / slots 编排

```json
{
  "rhythm_arrangements": [
    {
      "event_id": "RT_MINI_001",
      "block_id": "B02",
      "role": "mini_climax",
      "five_stage_slots": {
        "trigger": { "shot_role": "setup_trigger" },
        "amplify": { "shot_role": "pressure_amplify" },
        "pivot": { "shot_role": "emotional_turn" },
        "payoff": { "shot_role": "satisfaction_payoff" },
        "residue": { "shot_role": "aftershock" }
      }
    }
  ]
}
```

这样职责更干净：**L2 定位事件，Scene Architect 编排事件，Director 落镜头。**

---

## KVA merge 建议再加一个冲突处理规则

这份建议已经指出 `source_seg_id` 和 `suggested_block_id` 的问题，但还不够。需要显式区分：

* KVA 的来源 block；
* KVA 的消费 block；
* 为什么允许跨 block 消费；
* 谁拥有最终优先级。

建议合并后的字段改成：

```json
{
  "kva_id": "KVA_001",
  "source_seg_id": "SEG_004",
  "source_block_id": "B01",
  "priority": "P0",
  "action_type": "signature_entrance",
  "scene_architect": {
    "consumer_block_id": "B01",
    "suggested_shot_role": "opening_beat",
    "routing_reason": "signature entrance belongs to golden open",
    "authority": "scene_architect_v1"
  }
}
```

同时 validator 加规则：

```text
If source_block_id != consumer_block_id:
- routing_reason is required;
- consumer_block_id must exist;
- Director payload for consumer_block_id must include this KVA;
- source block must receive a trace note to avoid appearing as missing coverage.
```

否则之后很容易出现“源段在 A 块、消费在 B 块，两个块都觉得自己缺 KVA”的问题。

---

## full prompt 修复建议还需要补“生成方式”

文档里说维护 `*-delta.md` 和 `*-full.md`，方向对。但如果人工维护 full prompt，很快会漂移。

更稳的是：

```text
base prompt + delta prompt + injected slices => generated full prompt
```

并在 CI 里检查：

```text
- full prompt 是自动生成产物；
- full prompt hash 写入 run manifest；
- runner 实际读取的 prompt path 和 review bundle 中的 full prompt hash 一致；
- 人不能手改 full prompt，只能改 base / delta / slice。
```

否则你会解决“review bundle 和运行时不一致”，又制造“delta 和 full 不一致”。

---

## `dialogue_char_count` 代码计算：采纳，但别保留太多 LLM 旧字段

把旧值保存为 `_llm_dialogue_char_count` 可以短期 debug，但长期不建议进入正式 payload。原因是下游看到两个 count 容易误用。

建议：

```json
{
  "dialogue_char_count": 18,
  "debug": {
    "llm_dialogue_char_count": 22,
    "dialogue_char_count_corrected": true
  }
}
```

并且只有 debug manifest 保留，不进入 Director / Prompter 的核心输入。

---

## `scene_bucket` 拆分很好，但命名还可以再清楚

当前建议是：

```json
{
  "scene_bucket_fskb": "spectacle",
  "scene_archetype": "beauty_reveal",
  "av_bucket": "mixed",
  "render_bucket": "action"
}
```

我会略改命名：

```json
{
  "fewshot_bucket": "spectacle",
  "scene_archetype": "beauty_reveal",
  "av_density_bucket": "mixed",
  "motion_render_bucket": "action"
}
```

原因是：

* `scene_bucket_fskb` 缩写不直观；
* `av_bucket` 太宽；
* `render_bucket` 不知道是视觉、动作还是模型渲染策略。

字段名本身就是 prompt 的一部分，越少缩写越稳。

---

## 这份建议还缺一个重要模块：contract manifest

目前文档分散提到了 schema、adapter、validator、prompt path，但缺一个统一的运行契约清单。建议新增：

```json
{
  "workflow_version": "sd2_v7",
  "schema_versions": {
    "normalized_script": "v2",
    "editmap_l1": "v7",
    "editmap_l2": "v7.0.0",
    "scene_architect": "v1.0.0",
    "director_payload": "v6_compat_v7",
    "prompter_payload": "v6_compat_v7"
  },
  "prompt_hashes": {
    "script_normalizer_full": "...",
    "editmap_l1_full": "...",
    "editmap_l2_full": "...",
    "scene_architect_full": "...",
    "director_full": "...",
    "prompter_full": "..."
  },
  "compat_adapters": [
    "rhythm_timeline_block_to_block_id",
    "genre_bias_value_alias"
  ]
}
```

这个东西对排查 v5/v6/v7 混合态很有用。否则后面只看 output，很难知道某次运行到底用了哪版 prompt 和哪层兼容 adapter。

---

## 我建议改后的最小执行顺序

### Phase 1：先救真实断链

1. 修 `rhythm_timeline` adapter。
2. 加 `rhythmTimelineForBlock all filler` fail fast。
3. 修 `genre_bias.primary/value`。
4. 复跑现有 case，确认 Director payload block role 正常。

### Phase 2：统一运行时 prompt

1. 生成 full prompt，不人工维护。
2. runner 改读 full prompt。
3. run manifest 记录 prompt hash。
4. review bundle 打包同 hash 的 full prompt。

### Phase 3：让 Scene Architect 结果真的被消费

1. KVA merge 到 Director payload。
2. 区分 `source_block_id` 和 `consumer_block_id`。
3. Scene Architect rhythm event 编排进入 Director payload。
4. 修非法 `delta_sec` 示例和 `rhythm_adjustment_skips`。

### Phase 4：减少 LLM 自证

1. `dialogue_char_count` 代码重算。
2. LLM 输出 evidence，pipeline 算 pass/fail。
3. injection path preflight。
4. pure_md lint。

---

## 最终评价

这份修复建议是可执行的，且方向正确。它最有价值的地方是把问题从“prompt 写法”推进到了“跨阶段契约”。我会保留它的大部分内容，但做三处修改：

1. **P0 缩窄**，避免所有问题都变成最高优先级。
2. **`rhythm_timeline` canonical 减肥**，L2 只归一事件，不承担 five-stage / slots 编排。
3. **full prompt 自动生成并 hash 化**，不要人工维护两份 prompt。

一句话：**这份方案可以采纳，但要防止用一个更大的 schema 去掩盖职责边界问题。**
