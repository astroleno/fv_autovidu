# Post-Review 训后沉淀协议
v1.0

## 目的

建立从生成结果到知识库迭代的**闭环反馈机制**。每次使用 SD2Workflow 生成视频后，通过结构化的回顾流程，将成功模式和失败教训沉淀为 few-shot 知识库的增量更新。

## 适用时机

- Seedance 2.0 视频生成完成后
- 人工审片确认结果后
- 批量生成结束后的集中复盘

---

## I. 回顾输入

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `block_id` | String | ✓ | 对应的 Block ID |
| `sd2_prompt` | String | ✓ | 实际提交的提示词 |
| `generation_result` | Enum | ✓ | `success` / `partial` / `failure` |
| `result_description` | String | ✓ | 人工对结果的描述 |
| `quality_score` | Int(1-10) | ✓ | 结果质量评分 |
| `issue_category` | Array[String] | 仅 partial/failure | 问题分类（见下方枚举） |
| `success_patterns` | Array[String] | 仅 success/partial | 值得沉淀的成功模式 |
| `failure_patterns` | Array[String] | 仅 partial/failure | 需要记录的失败模式 |
| `scene_bucket` | String | ✓ | 该 Block 的场景主桶 |
| `scene_archetype` | String/null | - | 场景原型 |

### issue_category 枚举

| 分类 | 说明 |
|------|------|
| `face_distortion` | 面部变形、五官错位、跳脸 |
| `body_distortion` | 身体比例异常、穿模、手指畸形 |
| `action_misread` | 动作被错误理解（比喻被字面执行等） |
| `skin_color_artifact` | 皮肤变色（对应铁律 2） |
| `costume_conflict` | 服装与参考图冲突 |
| `lighting_instability` | 光线闪烁、色温突变 |
| `motion_chaos` | 运动方向混乱 |
| `asset_missing` | 该出现的资产消失 |
| `extra_element` | 出现了 prompt 未描写的元素 |
| `framing_error` | 构图与预期不符 |
| `timing_mismatch` | 动作时长与预期不符 |
| `metaphor_literal` | 比喻被字面执行 |
| `emotion_flat` | 情绪表达平淡、微表情不足 |
| `transition_glitch` | 时间片之间过渡不自然 |

---

## II. 沉淀流程

### Step 1. 分类与标记

```
generation_result == success → 提取 success_patterns
generation_result == partial → 提取 success_patterns + failure_patterns
generation_result == failure → 提取 failure_patterns
```

### Step 2. 模式结构化

将自然语言的 patterns 转化为结构化知识：

**success_pattern 结构**:
```json
{
  "pattern_id": "sp_dialogue_micro_expression_push_001",
  "scene_bucket": "dialogue",
  "scene_archetype": "power_confrontation",
  "description": "在对手说话时缓推到听者面部，同时描写瞳孔收缩和下颌紧绷，生成结果中微表情清晰可读",
  "applicable_tags": ["listener_reaction", "micro_expression", "slow_push"],
  "confidence": "high",
  "source_block": "EP03-B05",
  "discovered_at": "2026-04-15"
}
```

**failure_pattern 结构**:
```json
{
  "pattern_id": "fp_emotion_skin_blush_001",
  "scene_bucket": "emotion",
  "issue_category": "skin_color_artifact",
  "description": "prompt 中包含'面颊微红'，生成结果面部出现不自然的红色色块",
  "trigger_phrase": "面颊微红",
  "fix_suggestion": "替换为'目光闪躲、下巴收紧、攥紧衣角'",
  "severity": "high",
  "source_block": "EP01-B03",
  "discovered_at": "2026-04-15"
}
```

### Step 3. 知识库更新评估

| 触发条件 | 更新动作 |
|----------|---------|
| 同一 success_pattern 在 ≥3 个不同场景中被验证 | 提升 confidence 为 `proven`，考虑加入对应桶的 `structural_notes` |
| 同一 failure_pattern 在 ≥2 个不同场景中重复 | 添加到对应桶的 `anti_patterns`；若涉及铁律，强化铁律检查 |
| 新的 scene_archetype 被反复需要但当前词表中不存在 | 提交 Retrieval-Contract 词表扩展申请 |
| 某桶缺少高质量示例且质量评分集中在 ≤5 | 从 success_pattern 中提炼新的 `example_prompt` |
| 某铁律被频繁违反 | 在 SD2Prompter 自检清单中强化对应检查项 |

### Step 4. 成熟度追踪

每个桶维护一个成熟度指标：

| 成熟度等级 | 定义 |
|-----------|------|
| `nascent` | 桶刚建立，示例 ≤ 2 个，无验证数据 |
| `growing` | 3-5 个示例，有部分验证数据 |
| `mature` | ≥ 5 个示例，大多数经过 ≥3 次成功验证 |
| `stable` | 示例稳定，failure_pattern 发现率持续下降 |

**成熟度更新规则**:
- 每次批量回顾后重新评估
- 连续 5 次批量回顾中该桶无新的 high severity failure_pattern → 升级一级
- 出现新的 high severity failure_pattern → 降级一级

---

## III. 回顾输出格式

```json
{
  "review_session_id": "review_20260415_001",
  "reviewed_blocks": [
    {
      "block_id": "EP03-B01",
      "generation_result": "success",
      "quality_score": 8,
      "success_patterns": [
        {
          "pattern_id": "sp_transition_establish_slowpan_001",
          "description": "...",
          "applicable_tags": ["spatial_clarity", "atmosphere"]
        }
      ],
      "failure_patterns": []
    },
    {
      "block_id": "EP03-B05",
      "generation_result": "partial",
      "quality_score": 6,
      "issue_category": ["emotion_flat"],
      "success_patterns": [
        {
          "pattern_id": "sp_dialogue_axisstable_001",
          "description": "...",
          "applicable_tags": ["axis_stability"]
        }
      ],
      "failure_patterns": [
        {
          "pattern_id": "fp_dialogue_reaction_missing_001",
          "description": "...",
          "issue_category": "emotion_flat",
          "trigger_phrase": "...",
          "fix_suggestion": "..."
        }
      ]
    }
  ],
  "knowledge_base_updates": [
    {
      "target": "2_Emotion-v2.md",
      "update_type": "add_anti_pattern",
      "content": "不要在听者反应段只写'注视'——必须有至少一个面部肌肉或手部的物理动作"
    }
  ],
  "bucket_maturity": {
    "dialogue": "growing",
    "emotion": "growing",
    "reveal": "nascent",
    "action": "nascent",
    "transition": "growing",
    "memory": "nascent",
    "spectacle": "nascent"
  }
}
```

---

## IV. 自动化提示

编排层可根据以下信号自动触发 Post-Review：

1. 批量生成完成后
2. 人工审片打分完成后
3. 累计未回顾的 Block 数量 ≥ 10

编排层也可将 Post-Review 的 `knowledge_base_updates` 转化为 PR/MR 提交，由人工审核后合入知识库。

---

## V. 硬规则

1. Post-Review 只做**增量更新**——不覆盖现有示例的核心结构
2. 新增的 `anti_patterns` 和 `structural_notes` 必须附带 `source_block` 和 `discovered_at`
3. 铁律本身不可被 Post-Review 修改——铁律只可被**强化**（增加检查项），不可被放松
4. 成熟度评估必须基于**实际生成数据**，不可凭推测升级
5. 当 failure_pattern 与现有 `anti_patterns` 重复时，合并而非新增
