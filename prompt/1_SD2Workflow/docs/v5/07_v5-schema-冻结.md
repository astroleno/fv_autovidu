# SD2Workflow v5 · Schema 冻结（唯一真相源）

**状态：规范（Normative）· 冻结（Frozen on 2026-04-16）**
**优先级：所有其他 v5 文档与本文件冲突时，以本文件为准。**

本文件冻结 v5 的三份数据合同：

1. **EditMap `appendix` JSON**（输出契约）
2. **Director `appendix` JSON**（输出契约）
3. **Prompter `result` JSON**（输出契约）

编排层读写、normalize 校验、回归比对、CI 挡板，**所有消费者都只读本合同**。前面 00–06 文档中任何示例 JSON 如与本合同不一致，按本合同修正。

---

## 一、设计原则

1. **routing 嵌入 `block_index[i]`，不外联**：免掉 join key，工程上最简。
2. **视频全局属性进 `meta.video`**，不进 `routing`：`aspect_ratio / scene_bucket_default` 是片级属性，与 block 无关。
3. **routing_trace 是数组**，每 block 一条，由**编排层产出**（非 LLM 产出）。
4. **所有新字段都有默认值**（空数组 `[]` / `"none"` / `0`），v4 消费者可忽略。
5. **v4 旧字段 `structural_tags` 进入兼容层**：normalize 读时映射为 `structural`，3 个月过渡期后移除。

---

## 二、EditMap `appendix` 字段合同（v5 冻结版）

```jsonc
{
  "meta": {
    "video": {
      "aspect_ratio": "9:16",                 // enum: "9:16" | "16:9" | "1:1"
      "scene_bucket_default": "dialogue",     // block 未覆盖时的回退值
      "genre_hint": "urban_mystery",          // 供 paywall_level 默认值决策
      "target_duration_sec": 120
    },

    // T03 · 地位跷跷板（v5 新增）
    "status_curve": [
      {
        "block_id": "B01",
        "protagonist": { "position": "down", "reason": "被误解" },
        "antagonists": [
          { "name": "A", "position": "up", "reason": "权威在手" }
        ],
        "delta_from_prev": "down_deeper"      // up/up_steep/down/down_deeper/stable
      }
    ],

    // T04 · 情绪闭环（v5 新增 · 软门）
    "emotion_loops": [
      {
        "loop_id": "L1",
        "span_blocks": ["B01", "B02"],
        "stages": {
          "hook": "...", "pressure": "...", "lock": "...",
          "payoff": "...", "suspense": "..."
        },
        "completeness": "full"                // full/partial/missing
      }
    ],

    // T05 · 爽点三层（v5 新增）
    "satisfaction_points": [
      {
        "block_id": "B04",
        "motif": "status_reversal",           // 受控词见 §五
        "trigger": "public_humiliation_reverse",
        "payoff_hint": "反打 + 多人反应镜"
      }
    ],

    // T06 · 心理学计划（v5 新增）
    "psychology_plan": [
      {
        "block_id": "B01",
        "group": "hook",                      // hook/retention/payoff/bonding/relationship/conversion
        "effects": ["loss_aversion", "zeigarnik"],
        "hint": "先丢失再悬念"
      }
    ],

    // T08 · 信息差账本（v5 新增 · 软门 · 已按悬疑修宽）
    "info_gap_ledger": [
      {
        "block_id": "B01",
        "actors_knowledge": [
          { "actor": "protagonist",  "knows": ["自己无辜"] },
          { "actor": "antagonist_A", "knows": ["物证在 A 手上", "动机"] },
          {
            "actor": "audience",
            "knows": ["主角无辜"],
            "hidden_from_audience": ["A 的真实动机"]   // 显式留白
          }
        ]
      }
    ],

    // T08 · 证据链阶梯（v5 新增 · 软门 · 允许回撤）
    "proof_ladder": [
      {
        "block_id": "B02",
        "level": "rumor",                     // rumor/physical/testimony/self_confession
        "item": "同事闲谈",
        "retracted": false
      },
      {
        "block_id": "B06",
        "level": "testimony",
        "item": "目击证词",
        "retracted": true,                    // 证词反水；审计时忽略该条再查单调
        "retract_reason": "证人反水"
      }
    ],

    // T09 · 主角主体性目标（v5 新增 · 软门）
    "protagonist_shot_ratio_target": {
      "overall": 0.55,
      "per_block_min": 0.30,
      "hook_block_min": 0.50,
      "payoff_block_min": 0.60
    },

    // T12 · 付费脚手架（v5 新增）
    "paywall_scaffolding": {
      "final_block_id": "B10",
      "level": "final_cliff",                 // none/soft/hard/final_cliff
      "elements": {
        "freeze_frame": true,
        "reversal_character_enter": true,
        "time_deadline_hint": false,
        "cta_copy_hook": "下一集她会..."
      }
    },

    // ⭐ v5.0 HOTFIX · 镜头预算（派生字段，由 normalize 写入；LLM 不写）
    // 用于 Director 透传软预算 + 合并期软门校验 total_shot_count
    "target_shot_count": {
      "target":    30,                         // 目标镜头总数（来自 workflowControls.shotCountTargetApprox）
      "tolerance": [26, 35],                   // ±15% 容忍区间
      "avg_shot_duration_sec": 4               // 单镜头平均时长（冗余便于快速校验）
    },

    // 全局资产映射（v4 已有，保持）
    "asset_tag_mapping": [ /* { asset_id, tag: "@图N", description } */ ],

    // 路由审计日志（编排层产出；LLM 不写）
    "routing_trace": [
      {
        "block_id": "B01",
        "applied":   [ { "slice_id": "...", "tokens": 430, "from": "director.always" } ],
        "truncated": []
      }
    ],

    // ⭐ v5.0 HOTFIX · 软门统一告警出口（编排层产出；LLM 不写）
    // 所有软门违反都以 structured record 写入，不阻塞但可审计
    "routing_warnings": [
      {
        "code":      "shot_count_budget_exceeded",   // ∈ routing_warning_code 见 §五
        "severity":  "warn",                         // warn | info
        "block_id":  null,                           // 片级告警为 null；块级填 block_id
        "actual":    39,
        "expected":  { "target": 30, "tolerance": [26, 35] },
        "message":   "总镜头数 39 超出容忍上限 35（+12.9%）"
      }
    ]
  },

  "block_index": [
    {
      "block_id":     "B01",
      "duration":     12,
      "summary":      "...",
      "scene_bucket": "dialogue",             // block 级，覆盖 meta.video.scene_bucket_default

      // 🟩 canonical routing：嵌入 block_index，每 block 一份
      "routing": {
        "structural":    ["beat_escalation"],
        "satisfaction":  [],                  // ≤ 1 个
        "psychology":    ["loss_aversion"],   // ≤ 2 个
        "shot_hint":     ["A_event", "B_emotion"],
        "paywall_level": "none"               // 仅首/末 block 非 none
      },

      // ⭐ v5.0 HOTFIX · 块级镜头预算（派生字段，由 normalize 写入；LLM 不写）
      // target = round(duration / avg_shot_duration_sec)，tolerance=[max(1,t-1), t+1]
      "shot_budget_hint": {
        "target":    3,                       // 本 block 推荐镜头数
        "tolerance": [2, 4]                   // ±1 容忍
      },

      "present_asset_ids": ["c_lin", "p_letter"]
    }
  ],

  "diagnosis": {
    // v4 硬检（保留）
    "duration_sum_check":       true,
    "max_block_duration_check": true,
    "skeleton_integrity_check": true,

    // v5 新增 · 硬门（违反则 retry）
    "routing_schema_valid":     true,         // routing 六字段齐全、取值合法

    // v5 新增 · 软门（违反仅 warning，不阻塞）
    "emotion_loop_check":       true,         // T04
    "info_gap_check":           true,         // T08 · 改宽后：audience.knows + hidden ⊇ protagonist.knows
    "proof_ladder_check":       true,         // T08 · 允许 retracted 回撤
    "protagonist_shot_ratio_check": true,     // T09 · Director 回填，见 §三
    "paywall_scaffolding_check":    true,     // T12

    "notes": []
  }
}
```

### 硬门清单（v5.0，违反则 retry → 仍失败则丢弃）

> 共 **5 条**（EditMap normalize 侧 4 + Prompter 校验侧 1 条组合）。

**EditMap 侧（H1–H4，进 `diagnosis.*`）**：

- `duration_sum_check`
- `max_block_duration_check`
- `skeleton_integrity_check`
- `routing_schema_valid`（**v5 EditMap 侧新增的唯一硬门**）

**Prompter 侧（H5，进 `validation_report.*`）**：

- `avsplit_format_check` + `bgm_no_name_check`（T11；两项合并为 H5，任一失败即 retry）

### 软门清单（v5.0，违反仅 warning，不阻塞；统一写入 `meta.routing_warnings[]`）

- `emotion_loop_check` · T04
- `info_gap_check` · T08
- `proof_ladder_check` · T08
- `protagonist_shot_ratio_check` · T09
- `paywall_scaffolding_check` · T12
- `shot_count_budget_check` · v5.0 HOTFIX（总镜头数 vs `meta.target_shot_count.tolerance`）
- `shot_budget_per_block_check` · v5.0 HOTFIX（块镜头数 vs `block.shot_budget_hint.tolerance`）
- `iron_rule_checklist_presence` · v5.0 HOTFIX（Prompter 返回空 `iron_rule_checklist` 时告警）
- `psychology_group_synonym_fallback` · v5.0 HOTFIX（LLM 自创词被同义词层兜底时打 info）
- `satisfaction_subject_check` · v5.0 治本（`satisfaction_points[i]` 主体不是主角/我方时告警；交叉检查 §4.2 payoff 位置硬约束）
- `proof_ladder_coverage_check` · v5.0 治本 · rev4（`revenge` / `suspense` / `general` 题材下 `proof_ladder` 覆盖率 < 50% 或最高 level 未触达 `testimony` 时告警；`sweet_romance` / `fantasy` 跳过）
- `payoff_protagonist_reaction_check` · v5.0 治本（Director 产出 payoff block 中无显式主角反应特写镜头时告警；该块 `ratio_actual` 下限强拉 0.5）

---

## 三、Director `appendix` 字段合同（v5 冻结版）

Director 在 v5.0 的输出保持 v4 形态（markdown + `continuity_out`），**不强制产出结构化 `shots_contract[]`**。结构化 shot 合同延后到 v5.1。

```jsonc
{
  "appendix": {
    "shot_count_per_block": [
      {
        "block_id":    "B01",
        "shot_count":  3,                              // v5.0 LLM 自报；block_chain 合并期汇总进 total_shot_count
        "duration":    9                               // 与 block_index[i].duration 一致
      }
    ],
    "continuity_out": {
      "block_id": "B01",
      "shot_codes_used": ["A2", "B1", "C1"],           // T07 · 软字段：LLM 自报
      "protagonist_shot_ratio_actual": 0.52,           // T09 · 软字段：LLM 自估
      "protagonist_shot_ratio_check":  true,           // T09 · 软字段：LLM 自评
      "prev_block_state": "..."
    }
  }
}
```

> **约定**：T07 的 `shot_codes_used[]` 与 T09 的 `ratio_actual` 在 v5.0 均为 **LLM 自报**，仅进 warning 与 QA 抽样；**不参与 CI 硬挡板**。v5.1 由 `shots_contract[]` 结构化后升为硬挡板。
>
> **v5.0 HOTFIX**：block_chain 编排层必须在合并阶段把每个 block 的 `appendix.shot_count_per_block[].shot_count` 累加为 `meta.routing_warnings` 的 `shot_count_budget_check` 输入；块级超差则同时写 `shot_budget_per_block_check`。

---

## 四、Prompter `result` 字段合同（v5 冻结版）

```jsonc
{
  "block_id": "B01",
  "sd2_prompt": "...",                  // 每 shot 含 [FRAME][DIALOG][SFX][BGM] 四段
  "block_asset_mapping": {              // block 局部 @图N 映射（v4 已有）
    "@图1": "c_lin",
    "@图2": "p_letter"
  },
  "validation_report": {
    "bare_name_check":       true,
    "global_tag_leak_check": true,
    "avsplit_format_check":  true,      // T11 · 四段齐
    "bgm_no_name_check":     true       // T11 · BGM 不具名
  }
}
```

---

## 五、受控词表（v5 唯一版本 · 其他文档引用此处）

```
status_position       : ["up","mid","down"]
status_delta          : ["up","up_steep","down","down_deeper","stable"]

satisfaction_motif    : ["status_reversal","control","exclusive_favor","instant_justice","none"]
satisfaction_trigger  : ["public_humiliation_reverse","resource_deprivation_return",
                         "rule_exploitation","boundary_setting","info_gap_control",
                         "authority_endorsement","cost_materialized","none"]

psychology_group      : ["hook","retention","payoff","bonding","relationship","conversion"]
psychology_effect     : ["loss_aversion","negative_bias","zeigarnik","cognitive_dissonance",
                         "peak_end","anchoring","inequity_aversion","sunk_cost",
                         "authority_bias","scarcity","social_proof","reciprocity"]

shot_code_category    : ["A_event","B_emotion","C_transition","D_welfare"]
emotion_loop_stage    : ["hook","pressure","lock","payoff","suspense"]
proof_level           : ["rumor","physical","testimony","self_confession"]
paywall_level         : ["none","soft","hard","final_cliff"]
aspect_ratio          : ["9:16","16:9","1:1"]
scene_bucket          : ["dialogue","action","ambience","mixed"]
actor_kind            : ["protagonist","antagonist_<name>","npc_<name>","audience"]

// v5.0 HOTFIX · routing_warnings[].code 枚举（软门告警码）
routing_warning_code  : ["shot_count_budget_exceeded",
                         "shot_count_budget_deficit",
                         "shot_budget_per_block_exceeded",
                         "shot_budget_per_block_deficit",
                         "iron_rule_checklist_missing",
                         "iron_rule_checklist_failed_item",
                         "avsplit_format_failed",              // Prompter 硬门副告警（用于调试，不替代 H5）
                         "bgm_name_leak",                      // Prompter 硬门副告警（不替代 H5）
                         "psychology_group_synonym_fallback",  // LLM 自创词被同义词映射兜底
                         "emotion_loop_check_failed",
                         "info_gap_check_failed",
                         "proof_ladder_check_failed",
                         "protagonist_shot_ratio_below_min",
                         "paywall_scaffolding_check_failed",
                         // v5.0 治本 · 语义层软门
                         "satisfaction_subject_misaligned",     // satisfaction_points 主体不是主角/我方
                         "proof_ladder_coverage_insufficient",  // proof_ladder 覆盖率不足或 level 未触达 testimony
                         "payoff_without_protagonist_reaction"] // Director 产出的 payoff block 无主角反应特写

// v5.0 HOTFIX · psychology_group 同义词映射（LLM 自由词 → 6 个合法槽）
// pipeline 层兜底路由；完整表参见 02_v5-路由与切片扩展.md §4
psychology_group_synonym_map:
  // → hook
  "opening" | "cold_open" | "attention" | "intro"                       → "hook"
  // → retention
  "pressure" | "stakes" | "tension" | "suspense" | "curiosity" | "masking" | "concealment" → "retention"
  // → payoff
  "reversal" | "twist" | "revelation" | "catharsis" | "release" | "climax" | "resolution"  → "payoff"
  // → bonding
  "emotion" | "empathy" | "vulnerability" | "intimacy" | "warmth"       → "bonding"
  // → relationship
  "conflict" | "power_dynamic" | "confrontation" | "alliance" | "rivalry" → "relationship"
  // → conversion
  "cliff" | "cliffhanger" | "cta" | "hook_next"                         → "conversion"
```

---

## 六、兼容层（v4 → v5 迁移）

仅允许在 `scripts/sd2_pipeline/normalize_edit_map_sd2_v5.mjs` 的下列位置出现旧字段名，**代码注释必须标 `// v5 兼容层（三个月过渡期）`**：

```js
// v5 兼容层（三个月过渡期）
if (block.structural_tags && !block.routing?.structural) {
  block.routing = block.routing || {};
  block.routing.structural = block.structural_tags;
}
```

兼容动作：

| v4 形态 | v5 canonical | 兼容处理 |
|---------|-------------|---------|
| `block_index[i].structural_tags` | `block_index[i].routing.structural` | 自动迁移 |
| `meta.routing.structural_tags`（若有） | `block_index[i].routing.structural` | 自动迁移 |
| `meta.asset_tag_mapping` | 保留同名 | 无需改 |
| Director v4 `prevBlockContext.structural_tags` | 读 `block_index[i].routing.structural` | 更新 Director v5 prompt 的字段引用 |

其他 v4 字段**不动**。

---

## 七、`diagnosis` 审计规则（精确定义）

### 7.1 `routing_schema_valid`（硬门）

逐 block 检查 `block_index[i].routing` 六字段：

- `structural` / `satisfaction` / `psychology` / `shot_hint` 必须是数组（可空）。
- `paywall_level` 必须是字符串且取值 ∈ `paywall_level` 枚举。
- `satisfaction` 长度 ≤ 1；`psychology` 长度 ≤ 2。
- 数组内取值必须落在对应受控词表中。

任一 block 违反 → `false`。

### 7.2 `info_gap_check`（软门 · 已按悬疑修宽）

对每个 block 的 `actors_knowledge`：

- 必须存在 `actor == "audience"` 条目。
- **弱覆盖规则**：`audience.knows ∪ audience.hidden_from_audience ⊇ protagonist.knows`
  （即：观众对主角知晓的事实，要么已知、要么显式标为"对观众隐藏"）。
- **不要求**观众覆盖 `antagonist_*` 的知识。

### 7.3 `proof_ladder_check`（软门 · 允许回撤）

- 先过滤掉 `retracted == true` 的条目，剩余集合按 `block_id` 顺序检查 `level` 单调不下降。
- 全片至少出现 2 个不同 `level`（不含被过滤的）。
- 题材可 skip：EditMap 在 `meta.genre_hint` ∈ {"non_mystery"} 时，整个 ladder 可为空且 `check == true`。

### 7.4 `emotion_loop_check`（软门）

- `emotion_loops[]` 长度 ≥ 2。
- 首末两个 loop 必须 `completeness == "full"`。
- 其余 loop 中 `completeness == "full"` 占比 ≥ 60%。

### 7.5 `protagonist_shot_ratio_check`（软门 · LLM 自估）

- Director 在每个 block 的 `continuity_out.protagonist_shot_ratio_actual` 自估。
- Target 取自 `meta.protagonist_shot_ratio_target`：
  - hook block（首）≥ `hook_block_min`
  - payoff block（`meta.satisfaction_points` 命中）≥ `payoff_block_min`
  - 其余 ≥ `per_block_min`
- 违反只打 warning，不 retry。

### 7.6 `paywall_scaffolding_check`（软门）

- 若 `paywall_scaffolding.level == "final_cliff"`：Director 末 block 产出需在文本中含"冻帧"/"反转"/"反应镜"三要素的至少 2 项（关键词匹配）。
- `hard`：末 block 文本中需含"时间"/"截止"/"计时"/"日历"至少 1 项关键词。
- `soft`：不做关键词检查。
- 违反 warning 不阻塞。

### 7.7 `shot_count_budget_check` / `shot_budget_per_block_check`（v5.0 HOTFIX 软门）

**片级（shot_count_budget_check）**：

- 输入：`meta.target_shot_count.{target, tolerance}`（normalize 派生）+ 合并期累加得到 `total_shot_count`。
- 规则：`tolerance[0] ≤ total_shot_count ≤ tolerance[1]` → pass；否则写告警。
- 上越：`code = "shot_count_budget_exceeded"`；下越：`code = "shot_count_budget_deficit"`。

**块级（shot_budget_per_block_check）**：

- 输入：每个 block 的 `shot_budget_hint.{target, tolerance}`（normalize 派生）+ Director `appendix.shot_count_per_block[].shot_count`。
- 对每个 block 独立判，超差则逐条写入 `routing_warnings[]`，`block_id` 必填。

> 两项都不阻塞流水线；仅作为 QA 抽样与长期数据。

### 7.8 `iron_rule_checklist_presence`（v5.0 HOTFIX 软门）

- Prompter 返回的 `iron_rule_checklist` 为空对象 `{}` 或整体缺失 → `code = "iron_rule_checklist_missing"`，block 级告警。
- 任一项 `value === false` → `code = "iron_rule_checklist_failed_item"`，`message` 带失败项键名列表。

### 7.9 `psychology_group_synonym_fallback`（v5.0 HOTFIX info 级）

- 当 `routing.psychology_group` 值不在 `psychology_group` 枚举内，但命中 `psychology_group_synonym_map` 成功兜底 → 写 `severity = "info"` 记录（不是 warn，告知运营 LLM 在用自由词）。
- 若同义词也未命中 → 不 fallback 切片，改写 `severity = "warn"` 告警。

### 7.10 `satisfaction_subject_check`（v5.0 治本 · 软门 · 语义层）

交叉校验 `meta.satisfaction_points[i]` 与 `meta.status_curve[block_id == satisfaction_points[i].block_id]`：

- **不一致信号（判定主体错位）**：
  - `status_curve[B].protagonist.position == "down"` 但 `satisfaction_points[i].block_id == B` 存在；或
  - `status_curve[B].delta_from_prev ∈ {"down","down_deeper"}` 但 `satisfaction_points[i].block_id == B` 存在；
- 命中任一即写 `code = "satisfaction_subject_misaligned"`、`severity = "warn"`、`block_id = B`、`expected = {"protagonist.position": "mid|up", "delta_from_prev": "up|up_steep"}`、`actual = <当前 status_curve 值>`。
- **实现位置**：`normalize_edit_map_sd2_v5.mjs`（纯数据比对，无 LLM 调用）。

### 7.11 `proof_ladder_coverage_check`（v5.0 治本 · 软门 · v5.0-rev4 调整）

- **不触发条件**（任一满足即跳过）：
  - `meta.video.genre_hint ∈ {"non_mystery", "sweet_romance", "fantasy"}`（v5.0-rev4 扩展：这三个题材天然不依赖证据链）；或
  - `proof_ladder` 为空（由 `proof_ladder_check` 本身判定）。
- **覆盖率阈值**（v5.0-rev4：`0.6 → 0.5`，更贴近医疗情感 / 家庭伦理类剧本的实际密度）：
  设 `N = block_index[].length`，`C = 去重 block_id 在 proof_ladder 非 retracted 条目中的数量`；若 `C < ceil(N × 0.5)` → 写 `code = "proof_ladder_coverage_insufficient"`、`severity = "warn"`、`message = "coverage C/N (<50%)"`。
- **最高 level**：非 retracted 条目最高 level 未触达 `testimony` 或 `self_confession` → 同 code 追写一条，`expected.max_level ≥ "testimony"`、`actual.max_level = <实际>`。
- **例外**：末 block `paywall_level == "final_cliff"` 时 `max_level` 允许停在 `physical` / `testimony`。
- **实现位置**：`normalize_edit_map_sd2_v5.mjs · checkProofLadderCoverage()`。

### 7.12 `payoff_protagonist_reaction_check`（v5.0 治本 · 软门 · Director 侧）

- **触发条件**：block 被判定为 payoff block（见 Director v5 prompt §9.1 识别规则）。
- **判定路径**（编排层在 `call_sd2_block_chain_v5.mjs` 中执行）：
  1. 优先读 `continuity_out.notes` 中 `payoff_reaction_shots: [...]` 字段；若存在且非空 → pass；
  2. 否则回退到 `ratio_actual < 0.5` 判定（payoff block 硬下限）→ 写 `code = "payoff_without_protagonist_reaction"`、`severity = "warn"`、`block_id = B`、`expected.min_ratio = 0.5`、`actual.ratio_actual = <number>`。
- **不阻塞**；但 QA 抽样应优先复核此类 block 的画面。

---

## 七·附：`routing_warnings[]` 字段合同

```jsonc
{
  "code":     "shot_count_budget_exceeded",    // ∈ routing_warning_code
  "severity": "warn",                          // "warn" | "info"
  "block_id": null | "B03",                    // 片级用 null
  "actual":   <number | string>,               // 实际观测值
  "expected": <object>,                        // 期望值快照（可含 target/tolerance/enum 等）
  "message":  "人类可读说明（建议带百分比 / 失败项列表）"
}
```

**写入方**：编排层（`normalize_edit_map_sd2_v5.mjs` 负责 EditMap 侧软门；`call_sd2_block_chain_v5.mjs` 负责 Director/Prompter 侧软门）。

**消费方**：`sd2_routing_trace.json`（审计文件）+ CI 抽样脚本 + 人工 QA。

**不阻塞**：任一 warn/info 都不影响 pipeline 继续往下走。

---

## 八、`injection_map.yaml` 版本与 schema 对齐

`injection_map.yaml v2.0` 中所有 `match.*` 字段与本合同 canonical 对齐：

| `injection_map.match` | 从哪取值 |
|----------------------|---------|
| `structural` | `block_index[i].routing.structural[]` |
| `satisfaction` | `block_index[i].routing.satisfaction[]` |
| `psychology` | `block_index[i].routing.psychology[]` |
| `shot_hint` | `block_index[i].routing.shot_hint[]` |
| `paywall_level` | `block_index[i].routing.paywall_level` |
| `scene_bucket` | `block_index[i].scene_bucket`（缺省回退 `meta.video.scene_bucket_default`） |
| `aspect_ratio` | `meta.video.aspect_ratio`（**不从 routing 取**） |

> **禁用字段**（历史误写）：`meta.routing.aspect_ratio`、`meta.routing.*`（作为数组外联形式）。
> 如在任何文档中再出现，以本合同为准。

### 8.1 editmap/ 方法论切片 · 不进 `injection_map.yaml`（v5.0 架构红线）

> **结论**：`4_KnowledgeSlices/editmap/` 下的 6 份编剧方法论切片**不登记为 `injection_map.yaml` 的任何 consumer**，也**不占** `max_total_tokens_per_consumer` 预算。

**机制**：pipeline 在构建 EditMap system prompt 时，由 `scripts/sd2_pipeline/call_editmap_sd2_v5.mjs` 直接 `fs.readdirSync('editmap/')` 静态拼接。

**理由**：

1. **EditMap 是路由器**——`routing.*` 五字段由它一次性产出，供下游 Director / Prompter 的 `injection_map` 匹配；
2. **路由器不能被自己路由**——若 editmap/ 方法论走 routing 条件加载，会形成「要识别 satisfaction → 需先加载 subtext_and_signals → 而加载又要先识别 satisfaction」的死循环；
3. **方法论是 system prompt 的常量组成部分**——不是「按 block 动态拼装」的数据，而是「对整个剧本的元认知框架」，挂载一次即可。

**约束**：

- `routing_trace[].applied` / `.truncated` **不含** editmap/ 切片的 `slice_id`（它们不经过注入，不产生 trace）；
- editmap/ 切片整体 token ≤ 12,000（硬限；v5.0 GA 实测 ~10,981 tokens），超限 → CI 阻塞 PR；
- editmap/ 新增 / 删除切片 → 同步更新 `docs/v5/08_v5-编剧方法论切片.md §二 / §三`。

**完整机制、拼接顺序、token 预算规则见** `docs/v5/08_v5-编剧方法论切片.md`。本节与该文件冲突时**以该文件为准**（editmap 挂载机制由 08 号文件定义）。

---

## 九、golden sample 约定

v5.0 GA 前，仓库须落地 3 份 golden sample（Week 0 交付物），用于把"文字合同"变成"可执行样本"：

```
docs/v5/golden/
├── editmap_sample.json        # 完整 appendix，覆盖 §二 全部字段
├── director_sample.md          # markdown + continuity_out 示例
└── prompter_sample.json        # 完整 result，四段切 + 局部 @图N
```

CI 跑"golden diff"：样本变化须同步更新 schema 注释。

---

## 十、变更锁

本文件标记 `冻结（Frozen）`。后续如需修改：

1. 在 PR 中必须同步更新 00–06 文档的对应引用；
2. `injection_map.yaml` 版本号 → `v2.1+`；
3. `normalize_edit_map_sd2_v5.mjs` 同步；
4. golden sample 三份同步重录。

---

**所有其他文档（00/01/02/03/04/05/06）中与本文件冲突的描述，全部以本文件为准。**
