# SD2Workflow v3.1 接口合同

**状态：已冻结（2026-04-16）**
**日期：2026-04-16**
**权威等级：本文档是 SD2Workflow v3.1 的唯一执行基准。所有 prompt 改写、知识切片编写、编排层实现均以本文档为准。其他文档（架构愿景、知识萃取清单、历史升级计划）仅作参考，不构成约束。与本文档冲突时，以本文档为准。**

---

## 〇、架构概要

三阶段流水线，职责严格分离：

```
EditMap（Opus 4.6）
  输入：剧本 + 资产 + 全局参数
  职责：叙事节奏分析 + 情绪曲线 + 路由标签 + 资产映射
  输出：markdown_body（每组纯叙事信号）+ appendix JSON

    ↓ 编排层按组拆分 + 按路由标签注入知识切片 + 按 scene_run_id 调度并发

Director（Qwen3.6-plus，按组并发/串行）
  输入：EditMap 单组段落 + 知识切片 + FSKB 示例 + prevBlockContext
  职责：叙事到视觉的翻译（分镜、运镜、光影、音效）
  输出：markdown_body（分镜稿）+ appendix JSON（含 continuity_out）

    ↓ 编排层投影 prevBlockContext + 透传资产映射表

Prompter（轻量模型，全并发）
  输入：Director 单组分镜稿 + 资产映射表 + 知识切片
  职责：编译为 Seedance 2.0 三段式 prompt + @图N Block 内重编号 + 铁律自检
  输出：sd2_prompt + 校验报告
```

---

## 合同 1：`@图N` 编号策略

### 冲突

| 文档 | 说法 |
|------|------|
| EditMap v3 (line 193) | 全局唯一，废弃 Block 内重编号 |
| Prompter v3 (line 12) | Block 内重编号，每 Block 从 `@图1` 开始 |

### 冻结：两层分离

| 阶段 | `@图N` 使用方式 | 编号规则 |
|------|----------------|---------|
| **EditMap** | `appendix.meta.asset_tag_mapping` 输出全局映射表 | 全局唯一，按 `referenceAssets` 顺序 |
| **EditMap markdown_body** | 不使用 `@图N`，每组写完整角色描述 | — |
| **Director markdown_body** | 不使用 `@图N`，每组写完整角色描述 | — |
| **Prompter sd2_prompt** | Block 内重编号，每 Block 从 `@图1` 开始 | 按本 Block `present_asset_ids` 首次出场顺序 |
| **编排层** | 透传 `asset_tag_mapping` + `present_asset_ids` 给 Prompter | 不做编号转换 |

**Prompter 如何确定本 Block 的资产子集**：不靠文本匹配。编排层将 `block_index[].present_asset_ids[]`（见合同 3）透传给 Prompter，Prompter 从中按首次出场顺序分配 Block 内编号，再从 `asset_tag_mapping` 查 `asset_description`。

---

## 合同 2：Block 时长规则

### 冲突

| 文档 | 说法 |
|------|------|
| EditMap v3 (line 75) | 组时长 5-16s，Hook/Cliff 5-8s |
| 知识萃取 drift | 组时长 ≥12s |

### 冻结：分层管控

drift「≥12s」是题材特例，不是通用约束。

| 规则 | 层级 | 范围 |
|------|------|------|
| 组时长 5-16s | EditMap | 全局 |
| Hook/Cliff ≤ 10s | EditMap | 首尾组 |
| 单子镜头 ≥ 3s | Director（切片 `structure_constraints`） | 全局 |
| 冲击帧 2s 例外 | Director | 每组最多 1 个 |
| 每组子镜头 ≤ 5 | Director | 全局 |
| 禁连续 3 同景别 | Director（切片 `structure_constraints`） | 全局 |

---

## 合同 3：EditMap 输出 Schema

### 3.1 markdown_body 每段格式（传给 Director）

```markdown
### 段落 {N}（第{M}组）| 时长 {X}s

**叙事阶段：** {Hook / Setup / Escalation / Reversal / Payoff / Cliff}
**节奏档位：** {1-5 档}
**情绪主体：** {角色名}（{因果说明}）
**对白节奏型：** {① 对峙快节奏 / ② 日常中节奏 / ③ 触动慢节奏}
**主角反应节点：** {观众必须看到的核心反应瞬间}
**长台词标记：** {位置 + 预估秒数，若无则写「无」}
**在场角色：** {角色 A（完整描述），角色 B（完整描述）}

{原始剧本片段}
```

**EditMap 不再输出的**：声画分离设计、视觉增强、光影基准、时长压缩建议。Director 根据叙事信号 + 知识切片自行设计。

### 3.2 markdown_body 全局 Section（一次性）

- `## 【组骨架】`：所有组的摘要
- `## 【道具时间线】`：有状态变化的道具
- `## 【禁用词清单】`：全局禁用词
- `## 【尾部校验块】`：自检结果

### 3.3 appendix.block_index[] Schema（冻结）

```json
{
  "id": "B01",
  "start_sec": 0,
  "end_sec": 10,
  "duration": 10,
  "scene_run_id": "S1",
  "present_asset_ids": ["asset-qinruolan", "asset-zhaokaiyi", "asset-hospital-corridor"],
  "scene_bucket": "dialogue",
  "scene_archetype": "power_confrontation",
  "structural_tags": ["two_person_confrontation", "emotion_turning"],
  "injection_goals": ["audio_visual_split", "reaction_micro_expression"],
  "rhythm_tier": 3
}
```

**新增字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scene_run_id` | String | **✓** | 场次 ID（如 `S1`, `S2`）。同一 scene_run_id 内的组**串行**（需要 prevBlockContext），不同 scene_run_id 的组**可并发**。EditMap 根据剧本场景切换点划分。场景切换标志：地点变更、时间跳跃、角色群体完全更换。 |
| `present_asset_ids` | Array[String] | **✓** | 本组在场资产的 `asset_id` 列表。EditMap 从剧本片段中提取，按首次出场顺序排列。Prompter 据此做 Block 内 `@图N` 重编号，不依赖文本匹配。 |
| `rhythm_tier` | Int(1-5) | **✓** | 节奏档位数值，与 markdown 段落中的「节奏档位」一致。编排层可用于注入对应的知识切片。 |

**其余字段（id/start_sec/end_sec/duration/scene_bucket/scene_archetype/structural_tags/injection_goals）定义不变**，沿用 v3。

### 3.4 appendix 其他字段（不变）

- `meta.title`、`meta.genre`、`meta.target_duration_sec`、`meta.total_duration_sec`
- `meta.parsed_brief`、`meta.asset_tag_mapping[]`、`meta.episode_forbidden_words[]`
- `diagnosis.*`

---

## 合同 4：Director 输入/输出 Schema

### 4.1 Director 输入合同

```yaml
# 必需
editMapParagraph: String       # 当前组的 EditMap 段落（合同 3.1 格式）
blockIndex: Object             # 当前组的 block_index 条目（合同 3.3 Schema）
assetTagMapping: Array[Object] # 全局资产映射表
parsedBrief: Object            # 画幅/风格/色调等全局参数
episodeForbiddenWords: Array   # 禁用词清单

# 编排层注入
knowledgeSlices: Array[String] # 按路由标签拼接的知识切片 Markdown
fewShotContext: Array[Object]  # FSKB 示例（见合同 6）

# 可选
prevBlockContext: Object|null  # 前一组的连续性上下文（见合同 5）
```

### 4.2 Director markdown_body 每组 Section Header（冻结）

Director 输出的 markdown_body 中，每组**必须**使用以下锚点格式：

```markdown
## B{NN} | {start_sec}-{end_sec}s | {scene_bucket}
```

示例：`## B01 | 0-10s | confrontation`

**为什么冻结此格式**：编排层需要可靠地将 Director 输出按组拆分给 Prompter。使用 `## B{NN}` 作为分割锚点，编排层用正则 `^## B\d+` 切分，不依赖自由文本解析。`block_id` + 时间范围 + 桶标签三合一，便于日志回溯。

### 4.3 Director appendix JSON Schema（冻结）

```json
{
  "shot_count_per_block": [
    {"id": "B01", "shot_count": 3, "duration": 10}
  ],
  "total_shot_count": 28,
  "total_duration_sec": 120,
  "forbidden_words_scan": {
    "scanned_count": 12,
    "hits": 0,
    "pass": true
  },
  "continuity_out": {
    "last_shot": {
      "shot_type": "特写",
      "camera_angle": "平视",
      "camera_move": "缓推",
      "description": "秦若岚（30岁女性，短发，深蓝职业装）眼角泛泪，嘴唇微颤"
    },
    "last_lighting": "侧光，色温3200K暖黄，主光从画左45°打入",
    "characters_final_state": [
      {
        "asset_id": "asset-qinruolan",
        "position": "画面中心偏左",
        "posture": "坐姿，身体前倾",
        "emotion": "压抑的悲伤"
      }
    ],
    "scene_exit_state": "ongoing"
  }
}
```

**`continuity_out` 字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `last_shot.shot_type` | String | ✓ | 末尾时间片景别（使用 Director 枚举值） |
| `last_shot.camera_angle` | String | ✓ | 末尾时间片角度 |
| `last_shot.camera_move` | String | ✓ | 末尾时间片运镜 |
| `last_shot.description` | String | ✓ | 末尾时间片画面描述（50 字内） |
| `last_lighting` | String | ✓ | 末尾光影状态（含色温、方向） |
| `characters_final_state[]` | Array | ✓ | 每个在场角色的结束状态 |
| `characters_final_state[].asset_id` | String | ✓ | 对应 `asset_tag_mapping` 中的 `asset_id` |
| `characters_final_state[].position` | String | ✓ | 画面位置 |
| `characters_final_state[].posture` | String | ✓ | 体态/姿势 |
| `characters_final_state[].emotion` | String | ✓ | 情绪状态 |
| `scene_exit_state` | Enum | ✓ | `ongoing`（场景未结束）/ `exit`（角色离场）/ `cut`（硬切换场） |

**编排层投影规则**：
- 从 `continuity_out` 直接构建下一组的 `prevBlockContext`（字段 1:1 映射）
- 若 `scene_exit_state == "cut"`，下一组的 `prevBlockContext = null`（新场次起始）
- 若 `scene_exit_state == "exit"`，保留 `last_lighting` 但清空 `characters_final_state`

---

## 合同 5：连续性上下文 prevBlockContext

### 冻结：结构化投影，不解析自由文本

`prevBlockContext` 不再由编排层硬解析 Director markdown，而是直接从 Director `appendix.continuity_out`（合同 4.3）结构化投影。

**Director 输入侧的 prevBlockContext Schema**：

```json
{
  "last_shot": {
    "shot_type": "特写",
    "camera_angle": "平视",
    "camera_move": "缓推",
    "description": "秦若岚（短发，深蓝职业装）眼角泛泪"
  },
  "last_lighting": "侧光，色温3200K暖黄",
  "characters_final_state": [
    {
      "asset_id": "asset-qinruolan",
      "position": "画面中心偏左",
      "posture": "坐姿，身体前倾",
      "emotion": "压抑的悲伤"
    }
  ],
  "scene_exit_state": "ongoing"
}
```

**并发调度规则**（依赖 `scene_run_id`）：

```
同一 scene_run_id 内 → 串行（B01 完成 → 投影 continuity_out → B02）
不同 scene_run_id 间 → 并发（S1 和 S2 独立执行）
首组 / scene_exit_state=="cut" 后的首组 → prevBlockContext = null
```

**Prompter 不接收 prevBlockContext**。连续性是 Director 的职责。

---

## 合同 6：FSKB vs knowledge_slices + injection_map.yaml Schema

### 6.1 边界划分

| 维度 | FSKB（`3_FewShotKnowledgeBase/`） | knowledge_slices（`4_KnowledgeSlices/`） |
|------|------|-----------------|
| 内容 | 完整示例 prompt + structural_notes + anti_patterns | 规则 / 方法论 / 词库 / 约束 |
| 格式 | JSON（`example_prompt` + `structural_notes` + `anti_patterns`） | Markdown |
| 检索 | `scene_bucket` + `scene_archetype` → 选 1-3 示例 | 路由标签 → 查映射表 → 拼接全部命中 |
| 注入位置 | `fewShotContext` 参数 | system prompt 末尾追加 |
| 互斥 | 同一概念不可同时出现在两处 | — |

### 6.2 injection_map.yaml Schema（冻结）

```yaml
# injection_map.yaml — 知识切片路由映射表
# 编排层按此表机械执行：路由标签 → 命中切片 → 拼接注入

version: "1.0"

# 按消费者分组
director:
  # 无条件注入（每次 Director 调用都带）
  always:
    - slice_id: structure_constraints
      path: director/structure_constraints.md
      max_tokens: 500

  # 条件注入（路由标签命中时注入）
  conditional:
    - slice_id: structure_fewshot
      path: director/structure_fewshot.md
      max_tokens: 800
      match:
        structural_tags:
          any_of: ["beat_escalation", "emotion_turning", "crisis_burst"]

prompter:
  always:
    - slice_id: iron_rules_full
      path: prompter/iron_rules_full.md
      max_tokens: 600

  conditional:
    - slice_id: vertical_physical_rules
      path: prompter/vertical_physical_rules.md
      max_tokens: 400
      match:
        aspect_ratio: "9:16"

# 全局规则
rules:
  # 同一消费者的切片拼接上限（超过则按 priority 截断）
  max_total_tokens_per_consumer: 2000

  # 优先级：always > conditional；conditional 内 priority 越小越优先
  # 冲突处理：同一字段被多个切片覆盖时，priority 小的生效
  priority_order: "always_first_then_by_priority_asc"

  # mixed 场景：scene_bucket == "mixed" 时
  # 编排层从两个最相关主桶各取 1 个 FSKB 示例（沿用 Retrieval-Contract-v2 规则）
  # knowledge_slices 按 structural_tags 正常匹配，不做特殊处理
  mixed_bucket_strategy: "fskb_dual_bucket_slice_normal"

  # aspect_ratio 追加规则：当 parsedBrief.aspectRatio == "9:16" 时
  # 自动追加匹配 aspect_ratio: "9:16" 的全部切片
  aspect_ratio_auto_append: true
```

**关键协议**：
- `max_tokens` 是预估上限，用于编排层做 token budget 控制
- `match` 字段支持 `any_of`（数组中任一命中即匹配）和精确值匹配
- 切片文件本身是纯 Markdown，编排层读取后原文拼接到 system prompt
- `mixed` 场景对 FSKB 和 slices 的策略不同：FSKB 取双桶示例，slices 按 tags 正常匹配

---

## 合同 7：Prompter 输入 Schema

### 7.1 Prompter 输入合同

```yaml
# 必需
directorMarkdownSection: String      # Director 单组分镜稿（按 "## B{NN}" 锚点切分）
blockIndex: Object                   # 当前组的 block_index 条目（含 present_asset_ids）
assetTagMapping: Array[Object]       # 全局资产映射表
parsedBrief: Object                  # 画幅/风格/色调
episodeForbiddenWords: Array         # 禁用词

# 编排层注入
knowledgeSlices: Array[String]       # 切片 Markdown（iron_rules_full 等）

# 可选
fewShotContext: Array[Object]        # FSKB 示例
```

### 7.2 Prompter 核心输出字段（不变）

| 字段 | 说明 |
|------|------|
| `sd2_prompt` | 三段式完整提示词 |
| `block_asset_mapping` | 本 Block 局部 `@图N` → `asset_id` 映射（基于 `present_asset_ids` 重编号） |
| `asset_tag_validation` | 重编号 + 一致性校验结果 |
| `iron_rule_checklist` | 铁律逐条自检 |
| `sd2_prompt_issues[]` | 问题记录 |
| `sd2_prompt_principles[]` | 本次应用原则 |

---

## 合同 8：P0 最小可执行集

### 8.1 P0 切片

| 切片 ID | 路径 | 内容 | 消费者 |
|---------|------|------|--------|
| `structure_constraints` | `4_KnowledgeSlices/director/structure_constraints.md` | 子镜头≥3s、禁连续同景别、每组≤5 子镜头 | Director |
| `structure_fewshot` | `4_KnowledgeSlices/director/structure_fewshot.md` | 题材无关的组结构范式示例 | Director |
| `vertical_physical_rules` | `4_KnowledgeSlices/prompter/vertical_physical_rules.md` | 躺姿俯拍、推轨禁上摇、道具坐标、目光轨迹 | Prompter |
| `iron_rules_full` | `4_KnowledgeSlices/prompter/iron_rules_full.md` | 合并去重全部铁律（~12 条） | Prompter |

### 8.2 P0 编排层骨架

```
1. 读取 EditMap 输出（markdown_body + appendix）
2. 用 "### 段落" 正则拆分 markdown_body 为组段落数组
3. 读取 appendix.block_index[]，按 scene_run_id 分组
4. 对每组：
   a. 从 block_index 读路由标签
   b. 查 injection_map.yaml → 拼接知识切片
   c. 从 FSKB 按 scene_bucket + scene_archetype 选 1-3 示例
   d. 构建 Director 输入 payload
5. 调度 Director：
   - 同 scene_run_id → 串行执行
   - 跨 scene_run_id → 并发执行
   - 每组完成后提取 appendix.continuity_out → 构建下一组 prevBlockContext
   - 若 continuity_out.scene_exit_state == "cut" → 下一组 prevBlockContext = null
6. 对每组 Director 输出：
   a. 用 "## B{NN}" 正则提取分镜稿 section
   b. 从 block_index 取 present_asset_ids
   c. 查 injection_map.yaml → 拼接 Prompter 切片
   d. 构建 Prompter 输入 payload
7. 调度 Prompter（全并发）
8. 收集全部 sd2_prompt + 校验报告
9. 合并校验：iron_rule_checklist 全 pass + asset_tag_validation 全 pass → 交付
```

### 8.3 实施顺序

```
① 冻结本合同（已完成）
② 改写 EditMap v3 → v3.1（移除镜头级内容，新增 scene_run_id / present_asset_ids / rhythm_tier）
③ 改写 Director v3 → v3.1（接受纯叙事信号，输出 continuity_out，section header 用 ## B{NN}）
④ 改写 Prompter v3 → v3.1（基于 present_asset_ids 重编号，合并全部铁律）
⑤ 写 P0 四个知识切片
⑥ 写 injection_map.yaml
⑦ 实现编排层骨架
⑧ 端到端测试（1 集）
```

**在 ① 冻结之前，不写任何 prompt、不写任何切片、不写任何代码。**

---

## 附录 A：文档层级

| 文档 | 定位 | 约束力 |
|------|------|--------|
| **本文档（接口合同）** | 接口定义 + 字段 Schema + 执行计划 | **唯一执行基准** |
| `v3.1-职责分离与知识注入架构.md` | 架构愿景与设计理念 | 仅供理解背景，不构成约束 |
| `知识萃取-fengxing-video.md` | 知识源评估与萃取清单 | 萃取排期参考，P0 以本合同为准 |
| `v3-架构升级计划.md` | v3 历史设计 | 纯历史参考 |
| `v2-升级计划.md` | v2 历史设计 | 纯历史参考 |

**任何与本文档冲突的内容，以本文档为准。**

---

## 附录 B：变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-16 | 初版：6 个合同（@图N、时长、EditMap→Director、FSKB/slices、prevBlockContext、P0） |
| v2 | 2026-04-16 | 补充 5 个字段级合同：scene_run_id、present_asset_ids、continuity_out、injection_map.yaml schema、Director section header。声明为唯一标的文档。合同从 6 个扩展为 8 个。 |
| v3 | 2026-04-16 | 状态冻结。修复 scene_bucket 示例（confrontation→dialogue）、present_asset_ids 示例对齐 asset_id 格式、injection_map structural_tags 对齐 FSKB 受控词表。 |
