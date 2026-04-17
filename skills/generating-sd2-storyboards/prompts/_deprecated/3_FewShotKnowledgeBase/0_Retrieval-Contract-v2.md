# SD2 Few-Shot Knowledge Base
v2.0

## 目的

本目录承载 **EditMap-SD2 → 编排层 → SD2Director / SD2Prompter** 之间的独立 few-shot 知识库。

- `EditMap-SD2` 负责输出 `few_shot_retrieval`（含 `scene_archetype`）
- 编排层负责按检索键选择 bucket 和示例
- `SD2Director` 消费 few-shot 中的**运镜偏好和结构骨架**
- `SD2Prompter` 消费 few-shot 中的**措辞风格和描写模式**

> **v2 变更摘要**：新增 `spectacle` 主桶（视觉奇观/福利）；新增 `scene_archetype` 检索维度；示例格式新增 `structural_notes` 和 `anti_patterns`；词表扩展。

## 主桶设计

知识库按高频场景主桶组织：

- `dialogue`: 对话、对峙、正反打、听者反应
- `emotion`: 单人情绪探索、凝视、自我消化、沉默反应
- `reveal`: 认知翻转、觉醒、真相揭示、权力反转
- `action`: 追逐、打斗、技能释放、强位移、高冲击行为
- `transition`: 建立环境、进出场、桥接、节奏呼吸
- `memory`: 回忆、闪回、非现实时间线切入
- `spectacle`（v2 新增）: 视觉奇观、美感展示、身体接触/暧昧、特效释放、视觉福利

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
3. **若 `scene_archetype` 存在，用其做桶内精细排序**（v2 新增）
4. 再按 `structural_tags[]` 和 `visual_tags[]` 做桶内排序
5. 选出 1-3 个示例，组装为 `fewShotContext`
6. 注入 `SD2Director` 和 `SD2Prompter`

## 注入格式

```json
{
  "scene_bucket": "dialogue",
  "scene_archetype": "power_confrontation",
  "selected_examples": [
    {
      "example_id": "dialogue_two_person_lowkey_v2",
      "pattern_summary": "先建立双人空间关系，再进入说话者/听者节奏",
      "camera_bias": ["固定镜头", "缓慢推进"],
      "must_cover": ["axis_stability", "listener_reaction", "micro_expression"],
      "example_prompt": "完整三段式正例",
      "structural_notes": [
        "学习要点1",
        "学习要点2"
      ],
      "anti_patterns": [
        "不要迁移的内容1"
      ]
    }
  ],
  "injection_rules": [
    "few-shot 只迁移模式，不迁移具体人物、场景、道具",
    "若与 editMapBlock 冲突，以 editMapBlock 为准",
    "example_prompt 只作为风格和结构参考，不得直接拷贝其中事实",
    "example_prompt 只可迁移句法骨架和信息组织方式，不得提高环境装饰密度",
    "不得从 example_prompt 继承次要道具、动物、天气、灯源、材质细节、色温设定",
    "不得从 example_prompt 继承服装、配饰、发型及其他可替换的角色外观细节",
    "必须阅读 structural_notes 理解要学什么，阅读 anti_patterns 理解不要迁移什么"
  ]
}
```

## `mixed` 桶判定规则

`mixed` 是兜底桶，不是默认桶。判定必须遵循以下顺序：

1. **优先选最强单桶**：判断 Block 中**信号最强**的单一维度
2. **叠加不等于 mixed**
3. **仅当两个维度势均力敌且缺一不可时**才判为 `mixed`
4. 若 `mixed` 在全集中的使用率超过 20%，说明判定规则过松

`mixed` 桶检索时，编排层从两个最相关的主桶各取 1 个示例组合注入。

## 排序规则

- `scene_bucket` 命中优先级最高
- **`scene_archetype` 精确命中时，该示例优先于仅 bucket 命中的示例**（v2 新增）
- `structural_tags[]` 比 `visual_tags[]` 权重更高
- 与当前 `sd2_scene_type` 冲突的示例降权
- 与当前 `renderingStyle` / 资产域 / `artStyle` 冲突的示例**强降权**
- 结构相近但细节密度更低的示例优先

## 词表适用范围

- `structural_tags`、`visual_tags`、`injection_goals` 三张词表同时约束 **EditMap-SD2 的 `few_shot_retrieval` 输出** 和 **Bucket 文件中示例的 `must_cover` 字段**
- `must_cover` 的值必须从 `injection_goals` 词表中选取
- `pattern_summary` 和 `camera_bias` 为自由文本
- `structural_notes` 和 `anti_patterns` 为自由文本数组

## Controlled Vocabulary（受控词表）

### structural_tags（结构标签）

| 标签 | 含义 |
|------|------|
| `single_subject` | 单人场景 |
| `two_person_confrontation` | 双人对峙、对话、施压 |
| `group_dialogue` | 三人及以上的多人对话 |
| `listener_reaction` | 存在明确的听者反应需求 |
| `table_barrier` | 有桌/台/柜等物理隔挡 |
| `axis_sensitive` | 轴线关系是重点 |
| `awakening` | 觉醒、苏醒 |
| `recognition` | 身份确认 |
| `truth_drop` | 真相揭示 |
| `power_reversal` | 权力翻转 |
| `beat_escalation` | 节拍递进 |
| `chase` | 追逐 |
| `duel` | 一对一对打 |
| `skill_release` | 技能释放 |
| `impact_hit` | 打击落点 |
| `entry_exit` | 角色进场或离场 |
| `establishing` | 建立环境 |
| `bridge_beat` | 段落桥接 |
| `approach` | 角色靠近 |
| `spatial_reset` | 空间重置 |
| `gaze_hold` | 持续凝视 |
| `material_anchor` | 以物件承载情绪 |
| `interior_pressure` | 室内压迫感 |
| `flashback` | 回忆/闪回 |
| `memory_fragment` | 碎片化记忆 |
| `past_overlay` | 过去时间线覆盖 |
| `recall_trigger` | 由当前事物触发记忆 |
| `voice_image_split`（v2 新增） | 声画分离——画面与声音不同步 |
| `comedy_rhythm`（v2 新增） | 喜剧节奏快切 |
| `emotion_turning`（v2 新增） | 情绪突变/转折点 |
| `prop_driven_reveal`（v2 新增） | 道具驱动的真相揭示 |
| `instant_defeat`（v2 新增） | 一招制敌/碾压式快结 |
| `crisis_burst`（v2 新增） | 危机快切/紧急爆发 |
| `body_scan`（v2 新增） | 身体扫描镜头 |
| `vfx_buildup`（v2 新增） | 特效蓄力→释放→影响→收尾 |
| `intimate_proximity`（v2 新增） | 近距离暧昧/身体接触 |
| `beauty_showcase`（v2 新增） | 美感展示/揭示式入画 |

### visual_tags（视觉标签）

| 标签 | 含义 |
|------|------|
| `low_key_interior` | 低调室内光线 |
| `high_key_exterior` | 高调室外光线 |
| `cool_tone` | 冷色调 |
| `warm_tone` | 暖色调 |
| `high_contrast` | 高反差 |
| `silhouette` | 剪影 |
| `neon_cyber` | 赛博霓虹 |
| `natural_daylight` | 自然日光 |
| `candlelight` | 烛光/火光 |
| `dreamlike` | 梦境质感 |
| `non_physical_space` | 非物理空间 |
| `flashback_texture` | 闪回画面质感 |
| `ui_overlay` | 系统界面叠加 |
| `high_motion` | 高动态 |
| `slow_contemplative` | 缓慢沉思 |
| `grain_texture` | 胶片颗粒 |
| `desaturated` | 低饱和 |
| `backlit_rim`（v2 新增） | 逆光勾勒轮廓 |
| `shallow_dof`（v2 新增） | 浅景深虚化背景 |
| `golden_hour`（v2 新增） | 黄金时段暖光 |
| `moonlit`（v2 新增） | 月光冷蓝 |
| `impact_flash`（v2 新增） | 冲击闪光/爆发光效 |

### injection_goals（补强目标）

| 标签 | 含义 |
|------|------|
| `micro_expression` | 微表情细节 |
| `material_interaction` | 环境-材质物理交互 |
| `axis_stability` | 轴线稳定性 |
| `listener_reaction` | 听者反应镜头 |
| `action_readability` | 动作可读性 |
| `reveal_escalation` | 揭示节奏递进 |
| `memory_transition` | 记忆切入退出 |
| `spatial_clarity` | 空间关系清晰 |
| `slow_push` | 缓推运镜质量 |
| `impact_clarity` | 打击视觉清晰度 |
| `speed_boundary` | 速度感边界 |
| `breathing_detail` | 呼吸细节 |
| `eye_focus_shift` | 视线焦点变化 |
| `restraint` | 情绪克制外部化 |
| `direction_readability` | 运动方向可读性 |
| `space_continuity` | 空间连续性 |
| `hierarchy_flip` | 权力层级翻转 |
| `reaction_contrast` | 反应对比 |
| `timing_punch` | 节奏打点精度 |
| `recognition_shift` | 认知变化面部表达 |
| `face_change` | 表情断裂/突变 |
| `status_reset` | 关系重置视觉落地 |
| `transition_boundary` | 时空过渡边界 |
| `memory_texture` | 记忆画面质感 |
| `return_path` | 闪回返回现实过渡 |
| `fact_delivery` | 信息揭示可读性 |
| `timeline_separation` | 时间线区分 |
| `emotional_echo` | 情感共鸣 |
| `atmosphere` | 氛围营造 |
| `entry_hint` | 进入视觉暗示 |
| `exit_direction` | 离场方向可读性 |
| `bridge_state` | 桥接段状态 |
| `handoff` | 段落交接平滑度 |
| `scan_path_template`（v2 新增） | 身体扫描路径模板 |
| `phase_structure`（v2 新增） | 阶段结构（蓄力/释放/影响/收尾） |
| `atmosphere_interaction_vocabulary`（v2 新增） | 氛围互动词汇 |
| `physical_description_discipline`（v2 新增） | 纯物理描述纪律 |
| `protagonist_reaction`（v2 新增） | 主角受力反应质量 |
| `silence_density`（v2 新增） | 沉默段描写密度 |

### scene_archetype（场景原型·v2 新增）

场景原型是可选的桶内精细检索维度，由 EditMap-SD2 在 `few_shot_retrieval.scene_archetype` 中输出。

| scene_archetype | 适用 bucket | 说明 |
|----------------|------------|------|
| `opening_reveal` | transition | 揭示式开场 |
| `speed_atmosphere` | action / transition | 速度氛围 |
| `beauty_reveal` | spectacle | 美感展示 |
| `power_entrance` | dialogue / transition / spectacle | 威压/权力登场 |
| `dark_suspense` | emotion / transition | 夜戏/暗场悬疑 |
| `warm_daily` | dialogue / emotion | 闺蜜/日常温馨 |
| `flashback_sequence` | memory | 回忆/闪回序列 |
| `space_showcase` | transition / spectacle | 豪华空间首次展示 |
| `instant_defeat` | action | 一招制敌 |
| `crisis_burst` | action | 危机快切 |
| `prop_reveal` | reveal | 道具揭示驱动真相 |
| `vfx_release` | action / spectacle | 特效释放 |
| `group_battle` | action | 多人群战 |
| `voice_image_split` | dialogue | 声画分离四段切 |
| `comedy_fastcut` | dialogue | 喜剧快切对话 |
| `inner_monologue` | emotion | 内心独白 |
| `emotion_turning` | emotion / reveal | 情绪转折点 |
| `power_confrontation` | dialogue | 威压对峙 |
| `suspense_freeze` | reveal / emotion | 悬念定格收尾 |
| `solo_performance` | emotion | 独立表演 |
| `montage_compress` | transition | 蒙太奇/时间压缩 |
| `fan_service` | spectacle | 男频视觉福利 |
| `intimate_contact` | spectacle | 身体接触/暧昧 |

---

## SD2 引擎能力边界与替代策略

| 场景需求 | EditMap-SD2 处理策略 | 编排层/后期处理策略 |
|----------|--------------------|--------------------|
| 闪回/回忆插入 | 拆为独立 Block | 后期拼接 |
| 分屏/画中画 | 拆为连续 Block | 后期合成 |
| 时间倒流 | 正向叙述 | 后期倒放 |
| 慢动作 | 自然节奏描写 | 后期插帧 |
| 字幕/文字叠加 | 记录在 audio_cue | 后期叠加 |

**对 few-shot 的约束**：`memory` 桶的示例必须是**独立 Block 级别的回忆场景描写**，不得展示"现实→回忆→现实"的时间线切换。

---

## 硬规则

- few-shot 只提供 **骨架、节奏、运镜偏好、特殊模式处理、措辞参考**
- few-shot 不得提供新的资产、对白、场景事实
- 最终 prompt 中的所有事实必须回到 `editMapBlock`
- **引擎边界红线**：分屏、闪回内切、字幕叠加、倒放、变速指令严禁出现在 `sd2_prompt` 中
- **必须阅读 `structural_notes`**：理解示例要学什么
- **必须阅读 `anti_patterns`**：理解示例中哪些部分不可迁移
