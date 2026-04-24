# SD2 Few-Shot Knowledge Base
v1.0

## 目的

本目录承载 **EditMap-SD2 → 编排层 → SD2Prompter** 之间的独立 few-shot 知识库。

- `EditMap-SD2` 负责输出 `few_shot_retrieval`
- 编排层负责按检索键选择 bucket 和示例
- `SD2Prompter` 只消费注入后的 `fewShotContext`

主 Prompt 不直接内嵌大量 few-shot 文本，避免 system prompt 过重、优先级冲突和维护困难。

## 主桶设计

知识库按高频场景主桶组织：

- `dialogue`: 对话、对峙、正反打、听者反应
- `emotion`: 单人情绪探索、凝视、自我消化、沉默反应
- `reveal`: 认知翻转、觉醒、真相揭示、权力反转
- `action`: 追逐、打斗、技能释放、强位移、高冲击行为
- `transition`: 建立环境、进出场、桥接、节奏呼吸
- `memory`: 回忆、闪回、非现实时间线切入

以下内容不作为主桶，而作为 `visual_tags`：

- `dreamlike`
- `ui_overlay`
- `non_physical_space`
- `flashback`
- `high_motion`
- `cool_tone`

## 检索流程

1. 编排层读取 `editMapBlock.few_shot_retrieval`
2. 先按 `scene_bucket` 选主桶
3. 再按 `structural_tags[]` 和 `visual_tags[]` 做桶内排序
4. 选出 1-3 个示例，组装为 `fewShotContext`
5. 注入 `SD2Prompter`

## 注入格式

```json
{
  "scene_bucket": "dialogue",
  "selected_examples": [
    {
      "example_id": "dialogue_two_person_lowkey_v1",
      "pattern_summary": "先建立双人空间关系，再进入说话者/听者节奏",
      "camera_bias": ["固定镜头", "缓慢推进"],
      "must_cover": ["axis_stability", "listener_reaction", "micro_expression"],
      "example_prompt": "完整三段式正例，供 SD2Prompter 做模式模仿"
    }
  ],
  "injection_rules": [
    "few-shot 只迁移模式，不迁移具体人物、场景、道具",
    "若与 editMapBlock 冲突，以 editMapBlock 为准",
    "example_prompt 只作为风格和结构参考，不得直接拷贝其中事实",
    "example_prompt 只可迁移句法骨架和信息组织方式，不得提高环境装饰密度",
    "不得从 example_prompt 继承次要道具、动物、天气、灯源、材质细节、色温设定"
  ]
}
```

## `mixed` 桶判定规则

`mixed` 是兜底桶，不是默认桶。判定必须遵循以下顺序：

1. **优先选最强单桶**：判断 Block 中**信号最强**的单一维度，分配到对应主桶
2. **叠加不等于 mixed**：一个 Block 同时含对话 + 轻微情绪，只要对话是主要驱动力，仍判为 `dialogue`
3. **仅当两个维度势均力敌且缺一不可时**才判为 `mixed`。例如：Block 前半段是高强度打斗，后半段是情绪爆发性对白，两段时间占比接近且风格完全不同
4. 若 `mixed` 在全集中的使用率超过 20%，说明判定规则过松，应回检并收紧

`mixed` 桶检索时，编排层从两个最相关的主桶各取 1 个示例组合注入。

## 排序规则

- `scene_bucket` 命中优先级最高
- `structural_tags[]` 比 `visual_tags[]` 权重更高
- 与当前 `sd2_scene_type` 冲突的示例降权
- 与当前 `renderingStyle` / 资产域 / `artStyle` 冲突的示例**强降权**（降至候选池末位或直接排除），不是"降一点权"——风格/质感/色域冲突的 few-shot 对 SD2 引擎输出质量有显著负面影响
- 结构相近但细节密度更低的示例优先——示例越"克制"，下游越不容易被诱导堆砌

## 词表适用范围

- `structural_tags`、`visual_tags`、`injection_goals` 三张词表同时约束 **EditMap-SD2 的 `few_shot_retrieval` 输出** 和 **Bucket 文件中示例的 `must_cover` 字段**
- `must_cover` 的值必须从 `injection_goals` 词表中选取，不得自造
- `pattern_summary` 和 `camera_bias` 为自由文本/自由枚举，不受词表限制

## Controlled Vocabulary（受控词表）

EditMap-SD2 输出的 `few_shot_retrieval` 中 `structural_tags`、`visual_tags`、`injection_goals` 必须从以下封闭词表中选取。不在词表中的值视为非法，编排层可静默丢弃。

### structural_tags（结构标签）

| 标签 | 含义 |
|------|------|
| `single_subject` | 单人场景，仅一个角色出镜 |
| `two_person_confrontation` | 双人对峙、对话、施压 |
| `group_dialogue` | 三人及以上的多人对话 |
| `listener_reaction` | 存在明确的听者反应需求 |
| `table_barrier` | 有桌/台/柜等物理隔挡的对话 |
| `axis_sensitive` | 轴线关系是重点（正反打等） |
| `awakening` | 觉醒、苏醒、意识恢复 |
| `recognition` | 身份确认、认出某人/某物 |
| `truth_drop` | 真相揭示、关键信息落点 |
| `power_reversal` | 权力/强弱关系翻转 |
| `beat_escalation` | 节拍递进、情绪或冲突逐步升级 |
| `chase` | 追逐、追赶 |
| `duel` | 一对一对打、决斗 |
| `skill_release` | 技能释放、爆发性能力展示 |
| `impact_hit` | 打击落点、碰撞瞬间 |
| `entry_exit` | 角色进场或离场 |
| `establishing` | 建立环境、交代空间关系 |
| `bridge_beat` | 段落桥接、节奏呼吸、过渡 |
| `approach` | 角色靠近某目标 |
| `spatial_reset` | 空间关系重置（换场后重建） |
| `gaze_hold` | 持续凝视、视线锁定 |
| `material_anchor` | 以物件细节承载情绪（手部、道具等） |
| `interior_pressure` | 室内封闭空间的压迫感 |
| `flashback` | 回忆/闪回片段 |
| `memory_fragment` | 碎片化记忆 |
| `past_overlay` | 过去时间线覆盖当前现实 |
| `recall_trigger` | 由当前事物触发记忆 |

### visual_tags（视觉标签）

| 标签 | 含义 |
|------|------|
| `low_key_interior` | 低调室内光线 |
| `high_key_exterior` | 高调室外光线 |
| `cool_tone` | 冷色调主导 |
| `warm_tone` | 暖色调主导 |
| `high_contrast` | 高反差光影 |
| `silhouette` | 剪影效果 |
| `neon_cyber` | 赛博霓虹光效 |
| `natural_daylight` | 自然日光 |
| `candlelight` | 烛光/火光 |
| `dreamlike` | 梦境质感 |
| `non_physical_space` | 非物理空间（抽象/虚空等） |
| `flashback_texture` | 闪回画面质感（暗角/柔焦/碎片） |
| `ui_overlay` | 系统界面/全息叠加 |
| `high_motion` | 高动态场景 |
| `slow_contemplative` | 缓慢沉思节奏 |
| `grain_texture` | 胶片颗粒/粗糙质感 |
| `desaturated` | 低饱和 |

### injection_goals（补强目标）

| 标签 | 含义 |
|------|------|
| `micro_expression` | 微表情细节（眼神、嘴角、面部肌肉） |
| `material_interaction` | 环境-服装-材质物理交互 |
| `axis_stability` | 轴线稳定性（对话正反打） |
| `listener_reaction` | 听者反应镜头质量 |
| `action_readability` | 动作可读性（方向、力度、结果） |
| `reveal_escalation` | 揭示节奏递进 |
| `memory_transition` | 记忆/闪回的切入与退出过渡 |
| `spatial_clarity` | 空间关系清晰度 |
| `slow_push` | 缓推运镜质量 |
| `impact_clarity` | 打击/碰撞的视觉清晰度 |
| `speed_boundary` | 速度感边界（运动模糊、边缘散焦） |
| `breathing_detail` | 呼吸、胸廓起伏等生理细节 |
| `eye_focus_shift` | 视线焦点变化 |
| `restraint` | 情绪克制的外部化表达 |
| `direction_readability` | 运动方向可读性 |
| `space_continuity` | 跨时间片的空间连续性 |
| `hierarchy_flip` | 权力层级翻转的视觉表达 |
| `reaction_contrast` | 反应对比（强弱/动静对比） |
| `timing_punch` | 节奏打点精度 |
| `recognition_shift` | 认知变化的面部表达 |
| `face_change` | 表情断裂/突变 |
| `status_reset` | 关系重置后的视觉落地 |
| `transition_boundary` | 时空过渡边界处理 |
| `memory_texture` | 记忆画面的质感表达 |
| `return_path` | 从记忆/闪回返回现实的过渡 |
| `fact_delivery` | 记忆中的信息揭示可读性 |
| `timeline_separation` | 时间线区分的视觉清晰度 |
| `emotional_echo` | 情感共鸣/回响 |
| `atmosphere` | 氛围营造 |
| `entry_hint` | 角色/事件即将进入的视觉暗示 |
| `exit_direction` | 离场方向的可读性 |
| `bridge_state` | 桥接段的状态承载 |
| `handoff` | 段落交接的平滑度 |

---

## Coverage Matrix（旧管线能力替代路径）

以下矩阵标注 EditMap v2.8 + ShotPrompt + ImagePrompter + MotionDirector 中的核心能力在新 SD2 架构中的替代方式。

| 旧管线能力 | 新架构替代路径 | 状态 |
|-----------|--------------|------|
| `motionBias`（激进/平衡/沉稳）→ `motion_budget` 级联 | SD2Prompter 内置运镜推理表（Step 5） + few-shot `camera_bias` | **由 few-shot + 内置规则承接** |
| `episodeShotCount` + density 权重分配 | 时间片划分公式（Step 1）替代镜头分配；SD2 引擎自行决定内部 shot 结构 | **永久简化**：Block 内由 SD2 引擎自治 |
| `technique_budget`（reserved/forbidden camera） | few-shot `camera_bias` + `injection_goals` 间接引导 | **由 few-shot 承接**：不做硬禁止，改为软偏好 |
| ShotPrompt 三档时长护栏（快/标准/慢） | 时间片 `[2s, 8s]` 护栏 + 对白 `est_sec ±20%` 约束 | **永久简化**：粗粒度护栏足够 |
| ImagePrompter 受控词表（景别/焦段/角度枚举） | SD2Prompter 光影物理化（Step 3）+ 材质交互（Step 4）自然语言描写 | **永久放弃枚举**：SD2 引擎通过自然语言理解摄影指令 |
| MotionDirector `speedBias` 级联 | few-shot `camera_bias` 中的速度倾向 + `injection_goals` 如 `slow_push` | **由 few-shot 承接** |
| MotionDirector 动态强度判定（低/中/高 × key_moment） | SD2Prompter 的 `sd2_scene_type`（文戏/武戏/混合）+ 运镜推理表 | **永久简化**：三档 scene_type 替代五层强度矩阵 |
| ImagePrompter 角色一致性引用（attire_state 逐镜跟踪） | EditMap-SD2 Block 级 `attire_state` + @图N 语义桥梁 | **由 @图N 体系承接** |
| ShotPrompt Shot 级 `assets_used` 精确子集 | SD2Prompter 自检第 15 条：资产覆盖校验 | **由自检承接** |
| ScriptSupervisor 连续性台账 | EditMap-SD2 `continuity_hints` + `prevBlockContext` 投影 | **由 continuity_hints 承接** |

---

## SD2 引擎能力边界与替代策略

SD2 是**单镜头连续视频生成引擎**，以下手法超出其当前能力，不应在 `sd2_prompt` 中出现。EditMap-SD2 和编排层应提前处理：

| 场景需求 | EditMap-SD2 处理策略 | 编排层/后期处理策略 |
|----------|--------------------|--------------------|
| **闪回/回忆插入** | 将闪回拆为独立 Block（`scene_bucket: memory`），与现实时间线 Block 物理分离；在 `transition_out` 中标记过渡类型（如 `dissolve` / `flash_white`） | 编排层按 Block 顺序拼接，过渡效果由后期叠加 |
| **分屏/画中画** | 将两个同时发生的视角拆为**连续 Block**（先 A 视角 Block 再 B 视角 Block），不在同一 Block 中混合 | 若需要真实分屏效果，编排层在后期合成中并列两段视频 |
| **时间倒流** | 正向叙述，标记 `transition_out.type = "reverse"` 或类似后期指令 | 编排层后期倒放 |
| **慢动作** | 在 Block 叙述中使用自然节奏描写（"缓缓"/"逐渐"），不使用"慢动作"元指令 | 极端慢放需求由编排层后期插帧 |
| **字幕/文字叠加** | 在 Block 的 `audio_cue` 或独立后期字段中记录文字需求 | 编排层后期叠加字幕层 |

**对 few-shot 的约束**：`memory` 桶的示例必须是**独立 Block 级别的回忆场景描写**（一个 prompt 只描写回忆中的一段连续画面），不得在示例中展示"现实→回忆→现实"的时间线切换。

---

## 硬规则

- few-shot 只提供 **骨架、节奏、运镜偏好、特殊模式处理**
- few-shot 不得提供新的资产、对白、场景事实
- 最终 prompt 中的所有事实必须回到 `editMapBlock`
- **引擎边界红线**：分屏、闪回内切、字幕叠加、倒放、变速指令**严禁出现在 `sd2_prompt` 中**；这些需求一律由 EditMap-SD2 拆分或编排层后期处理
