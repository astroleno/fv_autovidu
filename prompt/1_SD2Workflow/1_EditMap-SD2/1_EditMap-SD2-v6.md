# SD2 EditMap · v6.0（v5 增量 · P0 硬路径）

> **状态：2026-04-21 草案**
> **继承关系**：本文件是 v5 的**增量**。`1_EditMap-SD2-v5.md` 的全部章节（输入来源 / §0 时长拆分 / §1 组骨架 / §2 资产引用 / §3–§4 routing / §5–§7 返回格式 / §IV 完整输出 / §V 自检）**继续生效**；本 v6 只说明"新增字段 + 新增推导 + 新增硬/软门 + 被 v6 更新的边界"。
> **触发原因**：v5 产线稳定但存在三大根因 —— 并发链路剧本断流（对白/KVA 无法下传）、节奏层缺度量（爽点密度仅 1–2 条）、风格锁定与三轴缺位。本 v6 修复 P0 断流与节奏硬门；风格软门放 v6.1。
> **依赖**：Normalizer 必须升到 v2（产 `beat_ledger[].key_visual_actions[]` + `structure_hints[]` + `dialogue_char_count` + `meta.genre_bias_inferred`）。

---

## 本 v6 关键变更一览

| # | 变更点 | 章节 | 门级 |
|---|--------|------|------|
| 1 | Step 0.7 · **风格三轴 `style_inference`** 兜底推理 | §A.1 | 软门（warning） |
| 2 | Step 0.8 · **每 block `covered_segment_ids[]` 与 `script_chunk_hint`** | §A.2 | **硬门**（v6.1-HOTFIX-D 升级） |
| 3 | Step 0.9 · **`meta.rhythm_timeline` 推导**（模板路由 + 几何公式） | §A.3 | **硬门** |
| 4 | **`major_climax.strategy` 三选一 + null 合法化** | §A.4 | **硬门**（null 时跳过签名校验） |
| 5 | **三层 `segment_coverage` 独立门级 + tail_seg 几何约束** | §A.5 | L1 **硬门** / tail_seg **硬门** / L2 L3 下游硬门（v6.1-HOTFIX-D） |
| 6 | `diagnosis` 字段追加（pipeline 回填权威值） | §A.6 | — |

---

## 〇、优先级仲裁铁律（沿用 00 号文档 §0）

```
① 甲方 reference / Normalizer segments（真相源）
     ↓  覆写
② 保真硬门（对白原文 · raw_excerpt 覆盖率 · KVA 消费）
     ↓  覆写
③ 节奏与风格目标（rhythm_timeline · style_inference · info_density_contract）
     ↓  覆写
④ 场级美学（Scene Blocking · Audio Intent · 构图倾向）
```

冲突时上位覆写下位；本 v6 所有硬门设计时**必须自问**"是否与上位合同冲突"，冲突时上位生效、本硬门跳过，跳过原因写入 `diagnosis.warning_msg`。

---

## A. 新增章节（插在 v5 `§0.B 时长拆分自检` 之后、`§1 组骨架锚定` 之前）

### A.1 Step 0.7 · 风格三轴 `style_inference` 兜底推理（T10 · 软门）

**目标**：把 v5 单轴 `renderingStyle` 扩为三轴，每轴**独立、可缺省、可推理**，并给证据。

**三轴受控词表**：

| 轴 | 字段 | 受控词 |
|---|------|--------|
| 视觉渲染 | `rendering_style.value` | `真人电影 / 3D写实动画 / 水墨动画 / 2D手绘` |
| 色调氛围 | `tone_bias.value` | `cold_high_contrast / warm_low_key / neutral_daylight / neon_saturated / desaturated_gritty / sunlit_pastel / other`（与 schema §3.1.1 对齐） |
| 剧情张力 | `genre_bias.primary` | `short_drama_contrast_hook / satisfaction_density_first / mystery_investigative / slow_burn_longform / artistic_psychological` |

**推理来源优先级**（从高到低）：

1. `directorBrief` 原文显式 → `confidence = high`，`source = "brief"`；
2. `globalSynopsis` 有线索 → `confidence = mid`，`source = "inferred_from_synopsis"`；
3. `scriptContent` 关键词推理 → `confidence = low`，`source = "inferred_from_script"`，必须列 ≥ 3 条证据；
4. `normalizedScriptPackage.meta.genre_bias_inferred`（Normalizer 兜底结论）→ 作为"最后防线"合并；
5. **任何一轴 `confidence == low`** → `diagnosis.warning_msg[]` 追加 `style_inference_low_confidence_on_<axis>`。

**输出 schema**（写入 `meta.style_inference`）：

```jsonc
"style_inference": {
  "rendering_style": {
    "value": "真人电影",
    "confidence": "high",
    "evidence": ["directorBrief 原文 '真人电影'"],
    "source": "brief"
  },
  "tone_bias": {
    "value": "cold_high_contrast",
    "confidence": "mid",
    "evidence": [
      "scriptContent 含 '冷光灯 / 水磨石 / 玻璃反光'",
      "genre_bias.primary == short_drama_contrast_hook 推断"
    ],
    "source": "inferred_from_script"
  },
  "genre_bias": {
    "primary": "short_drama_contrast_hook",
    "secondary": ["satisfaction_density_first"],
    "confidence": "high",
    "evidence": [
      "globalSynopsis 含 '撞破奸情' '复仇'",
      "parsed_brief.genre == revenge"
    ],
    "source": "derived_from_parsed_brief_and_script"
  }
}
```

**与 v5 `parsed_brief` 的关系**：`parsed_brief.renderingStyle / artStyle` 仍然写，但被"三轴"取代为**主消费字段**；v6 下游（Director/Prompter）读 `meta.style_inference` 优先。

### A.2 Step 0.8 · 每 block `covered_segment_ids[]` 与 `script_chunk_hint`（T09 · 软门）

**目标**：把 Normalizer 的 `seg_id` 显式分配到 block，让 payload builder 可以**运行时现查原文**，彻底修复并发链路断流。

**产出方式**：

- 在写 `appendix.block_index[i]` 时，追加 3 个新字段：
  - `covered_beat_ids[]`：本 block 覆盖的 `beat_id`（v5 其实已隐含，v6 显式化）；
  - `covered_segment_ids[]`：本 block 覆盖的 `seg_id`，**顺序即叙事顺序**，覆盖完整，不重叠；
  - `script_chunk_hint`：细粒度提示，含 `lead_seg_id / tail_seg_id / must_cover_segment_ids / overflow_policy`。
- `must_cover_segment_ids` 必须包含：
  1. 所有 `segment_type ∈ {dialogue, monologue, vo}` 的 seg_id（上位硬门，对白必须 100% 消费）；
  2. 所有 `key_visual_actions[].priority == "P0"` 所在的 `source_seg_id`。
- `overflow_policy` 枚举：
  - `push_to_next_block`：塞不下时推迟到下一 block（默认）；
  - `split_into_sub_shots`：在 Director 层拆 shot；
  - `drop_with_warning`：强降级（仅 `descriptive` 类允许）。

**输出 schema**（追加到 `block_index[i]`）：

```jsonc
{
  "block_id": "B01",
  "start_sec": 0, "end_sec": 10, "duration": 10,
  "scene_run_id": "S1",
  "present_asset_ids": ["秦若岚"],
  "rhythm_tier": 3,
  "routing": { /* v5 原样 */ },
  "shot_budget_hint": { /* v5 原样 */ },

  /* v6 新增 */
  "covered_beat_ids": ["BT_001"],
  "covered_segment_ids": ["SEG_001","SEG_002","SEG_003","SEG_004","SEG_005"],
  "script_chunk_hint": {
    "lead_seg_id": "SEG_001",
    "tail_seg_id": "SEG_005",
    "must_cover_segment_ids": ["SEG_002","SEG_004"],
    "overflow_policy": "push_to_next_block"
  }
}
```

**硬门（v6.1-HOTFIX-D 升级）**：`diagnosis.segment_coverage_check` = ⋃ `block_index[i].covered_segment_ids[]` ⊇ ⋃ `beat_ledger[*].segments[].seg_id` 的 **0.95**。低于阈值 → pipeline **exit 7**，拒绝写盘；仅在 `--allow-v6-soft` / `--skip-editmap-coverage-hard` 显式降级时转为 warning。

**动机（2026-04-21）**：leji-v6e_pass2 验收观察到 EditMap 只处理前 26/62 段（ratio=0.419），但 LLM 自填 `segment_coverage_ratio_estimated: 0.97`（与事实相反），软门放行让后半场关键戏（撞破对峙、怀孕反转、绿茶插话、门外幻想、closing hook）整段丢失。本硬门直接阻断"工程成立但叙事不成立"的伪 pass。

**额外几何约束 · tail_seg_covered_check（v6.1-HOTFIX-D 新增硬门）**：
- 时间轴上最后一个 `seg_id`（遍历 `beat_ledger[*].segments[]` 取最后一条）**必须进入最少一个 `block.covered_segment_ids[]`**；
- 未覆盖 → pipeline **exit 7**；可 `--skip-last-seg-hard` 单独降级；
- 原因：L1 ratio 即使 ≥ 0.95，仍可能漏掉最后 1–3 段（尾钩、反转、cliffhanger 正是最后一段），本约束保证 closing_hook 有实际可消费的素材。

### A.3 Step 0.9 · `meta.rhythm_timeline` 推导（T13 · 硬门）

**目标**：把"爽点密度"从描述字段升级为**可度量硬门**。

**输入信号**：

| 信号 | 来源 | 备注 |
|---|---|---|
| `duration_sec` | `episodeDuration` | 必给 |
| `genre_bias.primary` | 本 §A.1 产出 | 缺失/low → 默认 `satisfaction_density_first` |
| `block_count` | `len(block_index)` | 约束爆点数上限 |
| `source_dialogue_char_count` | Σ `beat_ledger[].beat_dialogue_char_count` | **上位真相源**，覆写模板期望 |

**节奏模板表**（v6 冻结，按 `genre_bias.primary` 路由，**直接查表、不做系数相乘**；完整正反例见切片 `editmap/v6_rhythm_templates.md`）：

| `genre_bias.primary` | `mini_per_30s` | `open_hook_type` | `major_climax_window_pct` | `dialogue_char_hint_per_min` | `bonding_budget_ratio` |
|---|:-:|---|:-:|:-:|:-:|
| `satisfaction_density_first`（**v6 默认**） | 1.3 | `conflict_direct` | 0.80 | 260 | 0.05 |
| `short_drama_contrast_hook` | 1.2 | `rumor_overheard` | 0.80 | 280 | 0.05 |
| `mystery_investigative` | 1.0 | `clue_drop` | 0.75 | 220 | 0.08 |
| `slow_burn_longform` | 0.7 | `atmosphere_open` | 0.70 | 180 | 0.12 |
| `artistic_psychological` | 0.6 | `imagery_open` | 0.65 | 140 | 0.15 |

**推导公式**：

```text
mini_count_hint = round(duration_sec / 30 × template.mini_per_30s)
mini_count      = min(mini_count_hint, block_count - 1)         # 每块最多承 1 个爆点

span = duration_sec - 15 - 8                                    # 保留头尾 open / closing
gap  = span / (mini_count + 1)
mini_climaxes[i].at_sec = round(8 + gap × (i + 1))

major_climax.at_sec = round(duration_sec × template.major_climax_window_pct)

source_count                  = source_dialogue_char_count        # 原文上位
episode_template_hint         = round(template.dialogue_char_hint_per_min × duration_sec / 60)
effective_expected            = round(min(source_count, episode_template_hint) × 0.95)
episode_dialogue_floor_hard   = round(effective_expected × 0.5)
episode_dialogue_ceiling_hard = round(source_count × 1.05)
bonding_budget_sec            = clamp(round(duration_sec × template.bonding_budget_ratio),
                                      0 if duration_sec < 60 else 3, 25)
```

**输出 schema**（写入 `meta.rhythm_timeline`）：

```jsonc
"rhythm_timeline": {
  "derived_from": {
    "duration_sec": 120,
    "genre_bias_primary": "short_drama_contrast_hook",
    "template_routed": "short_drama_contrast_hook",
    "template_version": "v6.0",
    "source_dialogue_char_count": 580
  },

  "golden_open_3s": {
    "block_id": "B01",
    "conflict_type": "rumor_overheard",
    "must_show": ["主角脸部特写","非常态信号"],
    "covered_segment_ids": ["SEG_001","SEG_002"],
    "shots_count_min": 2
  },

  "mini_climaxes": [
    {
      "seq": 1, "at_sec_derived": 30, "at_sec_final": 30, "duration_sec": 10,
      "block_id": "B03", "motif": "info_gap_control",
      "trigger_source_seg_id": "SEG_013",
      "five_stage": {
        "trigger": { "shot_idx_hint": 1, "desc": "听见门外异响" },
        "amplify": { "shot_idx_hint": 2, "desc": "脚步趋近门缝" },
        "pivot":   { "shot_idx_hint": 3, "desc": "门缝窥见" },
        "payoff":  { "shot_idx_hint": 4, "desc": "确认场内真相" },
        "residue": { "shot_idx_hint": 5, "desc": "后退半步" }
      }
    }
  ],

  "major_climax": {
    "at_sec_derived": 96, "at_sec_final": 96, "duration_sec": 12,
    "block_id": "B09",
    "strategy": "evidence_drop",          // 或 null（见 §A.4）
    "must_shots": {
      "close_up_on": "证据特写",
      "camera_move": ["低仰拍","慢动作"],
      "sfx_emphasis": "hard"
    }
  },

  "closing_hook": {
    "block_id": "B10",
    "hook_type": "split_screen_irony",
    "freeze_frame_required": true,
    "cliff_sentence_required": true,
    "shots_count_min": 2
  },

  "info_density_contract": {
    "min_info_points_per_5s": 1,
    "source_dialogue_char_count": 580,
    "template_hint_per_min": 280,
    "episode_template_hint": 560,
    "effective_expected": 532,
    "episode_dialogue_floor_hard": 266,
    "episode_dialogue_ceiling_hard": 609,
    "bonding_budget_sec": 6
  }
}
```

### A.4 `major_climax.strategy` 三选一 + `null` 合法化（T14 · 硬门）

**枚举**：`identity_reveal / evidence_drop / ability_visualized / null`。

**选择规则**（命中即停）：

| 剧本信号 | `strategy` |
|---|---|
| 含"证据 / 文件 / 转账记录 / 录音 / 物证" | `evidence_drop` |
| 含"身份差 / 制服 / 头衔 / 当众亮明 / 令牌" | `identity_reveal` |
| 含"技能 / 法术 / 金手指 / 系统 / 反制手段" | `ability_visualized` |
| 以上都无 | **`null`**（合法），`diagnosis.notice_msg += "major_climax_strategy_unresolved"` |

**硬门仲裁**：`strategy == null` 时，下游"major_climax 签名校验"硬门**跳过**；pipeline 不得自行补造证据戏（违反 §〇 上位合同）。

### A.5 三层 `segment_coverage` 独立门级（v6.1-HOTFIX-D：L1 升级为硬门）

与 00 号文档 §4.1 对齐：

| 层 | 指标 | 产出 | 阈值 | 门级 | 语义 |
|---|---|---|:-:|---|---|
| L1 · EditMap | `segment_coverage_check` | `diagnosis` | ≥ 0.95 | **硬门**（v6.1-HOTFIX-D） | 是否把 `seg_id` 分配到 block |
| L1.5 · EditMap | `last_seg_covered_check` | `diagnosis` | tail 必进 | **硬门**（v6.1-HOTFIX-D 新增） | 时间轴末段必须被覆盖 |
| L1.6 · EditMap | `source_integrity_check` | `diagnosis.v6_softgate_report.source_integrity` | 引用 seg_id ⊆ universe | **硬门**（v6.2-HOTFIX-G 新增） | 禁止伪造 seg_id |
| L2 · Prompter 整集 | `segment_coverage_ratio` | `sd2_final_report` | ≥ 0.90 | **硬门** | 实际消费占比 |
| L3 · Prompter 子类 | `dialogue_subtype_coverage` | `episode_coverage` | = 1.00 | **硬门**（上位） | 对白类必须 100% 消费 |

L1 / L1.5 / L1.6 / L2 / L3 全部为硬门，任一失败 pipeline 立即 exit 7 / 8。仅在 `--allow-v6-soft` / `--skip-editmap-coverage-hard` / `--skip-last-seg-hard` / `--skip-source-integrity-hard` 显式降级时转为 warning。

**L1.6 · source_integrity_check（v6.2-HOTFIX-G）动机**：leji-v6f 豆包实验暴露出 LLM 会在 `appendix.block_index[].covered_segment_ids` 中**伪造 universe 之外的 seg_id**（真实 Normalizer 池到 `SEG_062` 为止，LLM 却自造 `SEG_063`…`SEG_072`，并长出一个剧本外尾钩字幕）。HOTFIX-D 的 L1 用 universe 过滤伪段，所以伪段既不计入覆盖率也不报警，会被当作 pass 写盘并向下游传染。L1.6 直接禁止"越界造段"：扫 `covered_segment_ids` + `must_cover_segment_ids` + `script_chunk_hint.{lead_seg_id, tail_seg_id, must_cover_segment_ids}` 中所有 seg_id，任意一个 ∉ universe → 硬门 fail。

### A.6 `diagnosis` 字段追加

v5 原有 `diagnosis.*` 保持不变，v6 追加：

```jsonc
"diagnosis": {
  /* v5 原字段保持 */

  // v6.1-HOTFIX-D：以下两字段由 pipeline **回填**为实算值，LLM 即使写了也会被覆盖，
  // LLM 原值另存到 *_llm_self_reported 字段（审计用）。LLM 端只需专注于正确切块与
  // 填 covered_segment_ids[]；本两字段不是 LLM 的责任面。
  "segment_coverage_check": true,           // L1 硬门结果（pipeline 权威）
  "segment_coverage_ratio_estimated": 0.97, // number（pipeline 权威）
  "last_seg_covered_check": true,           // v6.1-HOTFIX-D 新增硬门结果（pipeline 权威）

  // v6.1-HOTFIX-D：pipeline 自动标记，LLM 无需输出
  "pipeline_authoritative": true,
  "pipeline_authoritative_note": "…",
  "segment_coverage_ratio_llm_self_reported": 0.97,  // LLM 原值（审计）
  "segment_coverage_check_llm_self_reported": true,  // LLM 原值（审计）

  "style_inference_completeness": "full",   // full / partial_low_confidence / missing
  "rhythm_timeline_derived": true,          // 是否成功推导
  "major_climax_strategy_resolved": true,   // false 时 strategy=null 合法
  "notice_msg": [
    // 软警告合集，如 "style_inference_low_confidence_on_tone_bias",
    // "major_climax_strategy_unresolved"
  ],
  "warning_msg": [
    // 可恢复的异常：如"L1 segment_coverage 0.91 < 0.95（降级模式下）"
  ]
}
```

**禁止条款（v6.1-HOTFIX-D）**：
- LLM **禁止**自填 `segment_coverage_check` / `segment_coverage_ratio_estimated` / `last_seg_covered_check` 作为"结论"；
- 即使填了，pipeline 也会按实算值覆盖；LLM 自报值仅保留为 `*_llm_self_reported` 回归审计用，**不再参与任何下游决策**。

---

## B. 对 v5 输入/输出的更新点

### B.1 输入：增消费 `normalizedScriptPackage`

v5 的 EditMap 已经把 Normalizer 当作上游，但字段层面只消费 `beat_ledger / temporal_model / character_registry / state_ledger`。v6 追加 2 项消费：

- `beat_ledger[].segments[].dialogue_char_count` — 用于 A.3 的 `source_dialogue_char_count` 累加；
- `beat_ledger[].key_visual_actions[]` — 用于 A.2 的 `must_cover_segment_ids` 收束；
- `beat_ledger[].structure_hints[]` — 用于 A.2 的 `must_cover_segment_ids` 收束；
- `meta.genre_bias_inferred` — 作为 A.1 的兜底输入。

### B.2 §I.1 组骨架 · 条目数量检查追加

v5 要求 `markdown_body.## 【组骨架】` 行数 == `appendix.block_index.length`；v6 追加：

- 每条 `block_index[i]` 必须有**非空** `covered_segment_ids[]`；
- 所有 block 的 `must_cover_segment_ids[]` 之并集 ⊇ `{所有 dialogue/monologue/vo 类 seg_id}` ∪ `{所有 P0 KVA 的 source_seg_id}`。若不满足 → `diagnosis.warning_msg += "must_cover_leak"`。

### B.3 §IV 实际返回格式 · 追加

在 v5 的返回 JSON 基础上，顶层 `appendix` 必须包含：

```jsonc
{
  "markdown_body": "... (v5 原样)",
  "appendix": {
    "block_index": [ /* 每条追加 covered_* + script_chunk_hint */ ],
    "meta": {
      "video": { /* v5 原样 */ },
      "parsed_brief": { /* v5 原样 */ },
      "style_inference": { /* v6 新增 · §A.1 */ },
      "rhythm_timeline": { /* v6 新增 · §A.3 */ },
      "status_curve": [ /* v5 原样 */ ],
      "psychology_plan": [ /* v5 原样 */ ]
    },
    "diagnosis": { /* v5 字段 + v6 追加 · §A.6 */ }
  }
}
```

### B.3.1 `markdown_body` 字符串安全性硬约束（v6.3 新增）

**背景**：v5/v6 的输出是 `{"markdown_body": "...", "appendix": {...}}` JSON 壳。OpenAI-compat/DashScope 的 `response_format=json_object` 模式会自动对 `markdown_body` 字符串里的特殊字符做转义；但 **Anthropic `/messages` 端点（含 APIMart 上的 `claude-opus-*-thinking` 系列）没有同等强制**，模型需自觉遵守 JSON 字符串字面值规则，否则顶层 JSON 立刻在第一个裸 `"` 处崩解。

**硬约束（所有 LLM 后端一律遵守）**：

1. **禁止裸英文双引号**：`markdown_body` 字符串内**严禁**出现 `"`（U+0022）。凡需要引用台词、角色称呼、旁白内容时，**一律改用中文直角引号**：
   - 对白、旁白、内心独白 → 使用「」（U+300C/300D）；必要时嵌套『』（U+300E/300F）。
   - 举例：~~母亲VO痛批"心脏有病不能生"~~ → `母亲VO痛批「心脏有病不能生」`。
2. **禁止裸反斜杠**：`markdown_body` 内如出现单个 `\`，必须写成 `\\`。
3. **换行只能是 JSON 转义 `\n`**：不要在 `markdown_body` 字符串字面里直接按回车换行（JSON 字符串不允许字面换行）。
4. **禁止 Markdown 围栏内再次使用英文双引号**：尤其是 ` ```json ... ``` ` 代码块、表格单元格 `| ... |`、`> quote` 块。若确实需要展示英文引号语义，改用 ``` ` ` ``` 反引号或中文「」。
5. **`appendix` JSON 字段不受本约束**：`appendix.*` 是结构化数据，引号由 JSON 解析器保证；但如果 appendix 里的某个**字符串值**内含裸 `"`，同样要写成中文「」或转义成 `\"`。

**为什么这条是硬约束**：EditMap v6 的 `markdown_body` 动辄数千字、包含大量角色对白与旁白，一次未转义的 `"` 就会让 `JSON.parse` 在 position N 爆错，整份 EditMap 作废——`claude-opus-4-6-thinking` 已在实测中因此连续两次 fail。改用「」既满足 JSON 合法性，又保留了中文剧本的语感，零副作用。

---

### B.4 §V 自检清单追加（仅追加 v6 项）

在 v5 原有自检条目末尾追加：

1. `meta.style_inference.{rendering_style, tone_bias, genre_bias}` 三轴均有值，每轴 `evidence[] ≥ 1`；
2. 每个 `block_index[i].covered_segment_ids[]` 非空；
3. `meta.rhythm_timeline.derived_from` / `golden_open_3s` / `mini_climaxes` / `major_climax` / `closing_hook` / `info_density_contract` 齐备；
4. `major_climax.strategy` 取值 ∈ `{identity_reveal, evidence_drop, ability_visualized, null}`；为 `null` 时 `diagnosis.notice_msg` 必含 `major_climax_strategy_unresolved`；
5. `major_climax.block_id` 在 `block_index` 里实际存在；
6. `mini_climaxes[].at_sec_derived` 单调递增，相邻差值 ≤ 25s；
7. `info_density_contract.episode_dialogue_floor_hard ≤ effective_expected ≤ episode_dialogue_ceiling_hard`；
8. L1 `segment_coverage_check` 若为 false，`warning_msg` 必含诊断原因（v6.1-HOTFIX-D：本字段由 pipeline 回填，LLM 无需自评）；
9. **（v6.1-HOTFIX-D 新增）时间轴上最后一个 `seg_id` 必须出现在至少一个 `block.covered_segment_ids[]`**，保证 closing_hook 有可消费素材；
10. **（v6.1-HOTFIX-F 新增）遇到 pipeline 注入的"动态硬下限"段（directorBrief 尾部 `──（HOTFIX F · pipeline 注入 · 最高优先级硬约束 …）──` 标记），必须优先服从**：
    - `shots.length ≥ max(50, segs_count)`；
    - `blocks.length ≥ max(15, ceil(segs_count/4))`；
    - 剧本体量 > 目标时长时以"每 block 镜头数↑ + 每镜头时长↓"方式压缩，**禁止丢弃后半段 segment**。
11. **（v6.2-HOTFIX-G 新增 · 源真相一致性铁律）所有 `seg_id` 必须来自 Normalizer 的真实 universe**：
    - `appendix.block_index[*].covered_segment_ids[]`、`must_cover_segment_ids[]`、`script_chunk_hint.{lead_seg_id, tail_seg_id, must_cover_segment_ids[]}` 中**任何**一个 `seg_id` 都必须能在 `__NORMALIZED_SCRIPT_PACKAGE__.beat_ledger[*].segments[*].seg_id` 或 `script_segments[*].seg_id` 里找到；
    - **严禁**自造超出 universe 的 seg_id（如 Normalizer 只到 `SEG_062`，不得自行生成 `SEG_063`…）；
    - **严禁**额外生成剧本外的"尾钩字幕 / 彩蛋段"塞进 `markdown_body` 并引用伪 seg_id；
    - 若剧本体量不足以铺满 120s，请**拆 shot / 放慢节奏**，而不是造段；
    - pipeline 会用 `source_integrity_check` 硬门拦截任何伪 seg_id，失败直接 exit 7。

---

## C. 降级开关语义（pipeline 层提示）

| 开关 | 对 EditMap 的含义 |
|---|---|
| `--allow-v6-soft` | 所有 v6 硬门降级为 warning（含 L1 段覆盖 / tail_seg） |
| `--skip-editmap-coverage-hard` | **仅** L1 段覆盖（≥ 0.95）硬门降级（v6.1-HOTFIX-D） |
| `--skip-last-seg-hard` | **仅** last_seg_covered_check 硬门降级（v6.1-HOTFIX-D） |
| `--skip-source-integrity-hard` | **仅** source_integrity_check 硬门降级（v6.2-HOTFIX-G） |
| `--skip-rhythm-timeline` | 不产 `meta.rhythm_timeline`，但仍产 style_inference + covered_segment_ids |
| `--skip-style-inference` | 不产 `meta.style_inference`，Director 回落 v5 `parsed_brief` |
| `--rhythm-soft-only` | rhythm_timeline 产出正常，但 pipeline 下游的节奏硬门降级 warning |

---

## D. 版本演进

| 版本 | 日期 | 状态 | 要点 |
|------|------|------|------|
| v5.0-rev9 | 2026-04-17 | 🟢 稳定 | v5 工程基线（Slot-fill、付费、routing） |
| v6.0 | 2026-04-21 | 🟢 正式 | 三轴 style_inference + covered_segment_ids + rhythm_timeline + 三层覆盖率 |
| v6.1-HOTFIX-A | 2026-04-21 | 🟢 | 修复 Stage 0 产物在 `--skip-editmap` 重跑时未挂载；run_sd2_pipeline 自动 mount |
| v6.1-HOTFIX-B | 2026-04-21 | 🟢 | Prompter 自检 `dialogue_fidelity_check` 假阳性降级（raw_text 空 + prompt 非空 → phantom_pass_detected） |
| v6.1-HOTFIX-C | 2026-04-21 | 🟢 | 汇总导出器 timecode 正则放宽 + EditMap block.time 兜底链 |
| v6.1-HOTFIX-D | 2026-04-21 | 🟢 | **L1 段覆盖升级硬门 + tail_seg 硬门 + diagnosis 权威回填**（本次） |
| v6.1-HOTFIX-E | 2026-04-21 | 🟢 | prompt 文档侧收口：L1/tail 硬门化 + 禁写 LLM 自估字段（本次） |
| v6.1-HOTFIX-F | 2026-04-21 | 🟢 | directorBrief 动态硬下限注入：shot ≥ max(50, segs) / block ≥ max(15, segs/4) / tail_seg 必进 |
| v6.2-HOTFIX-G | 2026-04-22 | 🟢 | **source_integrity_check 硬门**：禁止 EditMap 伪造 universe 之外的 seg_id（v6f 豆包实验发现）（本次） |
| v6.2-HOTFIX-I | 2026-04-22 | 🟢 | Prompter 产物完整性检测 + repetition collapse 自动重试 1 次（本次） |
| v6.2-HOTFIX-J | 2026-04-22 | 🟢 | run_sd2_pipeline 新增 `--block-chain-backend=doubao`：Stage 2/3 可切火山 Ark（本次） |
| v6.1 | 计划 2026-05-04 | ⏳ | 引入 Stage 1.5 Scene Architect（微调 rhythm_timeline；本 v6 对其输出兼容） |

---

## E. 与其他 v6 文档的分工（读者索引）

- 对白保真硬门文本 → `docs/v6/02_v6-对白保真与beat硬锚.md`
- 并发链路断流修复的 payload builder 侧 → `docs/v6/04_v6-并发链路剧本透传.md`
- Scene Architect 的 ±3s 微调（v6.1） → `docs/v6/05_v6-场级调度与音频意图.md`
- 节奏模板与验收指标 → `docs/v6/06_v6-节奏推导与爆点密度.md`
- 节奏模板的正反例切片 → `4_KnowledgeSlices/editmap/v6_rhythm_templates.md`
