# SD2Workflow v6 · Schema 冻结（增量 · 唯一真相源）

**状态：规范（Normative）· 冻结（Frozen on 2026-04-21）**
**优先级：与 v5 schema 冲突时，以本 v6 增量为准；未提及字段仍沿用 v5 `docs/v5/07_v5-schema-冻结.md`。**

本文件冻结 v6.0 在以下四个消费者上的**增量契约**：

1. **Normalizer v2** 输出（新增：KVA / structure_hints / dialogue_char_count / genre_bias_inferred）
2. **EditMap v6** `appendix` JSON（新增：`meta.style_inference / meta.rhythm_timeline / block_index[i].covered_segment_ids / block_index[i].script_chunk_hint`）
3. **Director v6** `appendix` JSON（新增：`segment_coverage_report / kva_consumption_report / kva_coverage_ratio / structure_hint_consumption / shot_meta / extra_plot_injection_check`）
4. **Prompter v6** `result` JSON（新增：`dialogue_fidelity_check / kva_visualization_check / kva_coverage_ratio / rhythm_density_check / five_stage_check / climax_signature_check / segment_coverage_overall`）

---

## 一、设计原则（v6 追加）

1. **单一真相源 × 显式透传**：原文 seg 的"路由"信息由 EditMap 标记（`covered_segment_ids`），"原文正文"由 payload builder 从 Normalizer 搬运到 `scriptChunk.segments[]`，不要求 EditMap 反刍正文。
2. **三轴正交**：`rendering_style / tone_bias / genre_bias` 相互独立，各自带 `confidence + evidence`。
3. **节奏模板路由化**：`rhythm_timeline` 派生自 `genre_bias.primary` 命中的模板，不走统一系数。
4. **`null` 合法化**：`major_climax.strategy == null` 合法，防止下游硬造。
5. **三层 segment_coverage**：L1（EditMap 软门）/ L2（Prompter 整体硬门）/ L3（Prompter 对白子类硬门）各自独立，任一违规都独立告警。
6. **硬门/软门分明**：每个新增字段都明确标注 `gate_level`（见表）。

---

## 二、Normalizer v2 输出增量

### 2.1 `beat_ledger[].key_visual_actions[]`（KVA · 新增 · 硬提取）

```jsonc
{
  "key_visual_actions": [
    {
      "kva_id": "KVA_001",
      "source_seg_id": "SEG_001",
      "source_beat_id": "BT_001",
      "action_type": "signature_entrance",         // enum 见 §2.1.1
      "summary": "一双高跟鞋出现，镜头逐渐上移",
      "required_shot_count_min": 1,                // int, ≥ 1
      "required_structure_hints": ["low_angle","pan_up"],
      "forbidden_replacement": ["普通全景登场","面部直接特写"],
      "priority": "P0"                             // enum: P0 | P1
    }
  ]
}
```

#### 2.1.1 `action_type` 受控词（KVA 细粒度视觉动作）

以下枚举是 Normalizer v2 抽取 KVA 时可用的 `action_type` 全集（与 `ScriptNormalizer-v2.md` §A.1 抽取规则表保持一致）：

```
# 登场 / 身份类
signature_entrance    // 标志性登场（高跟鞋、逆光亮相）
status_reveal         // 身份揭示（工牌、头衔、制服翻转）
transformation        // 外观转变（换装、化妆）

# 发现 / 对峙类
discovery_reveal      // 偶然发现（推门、撞见）
confrontation_face    // 对峙正面
intimate_betrayal     // 亲密越界（跨坐、拥吻、摸肚子）
performative_affection // 表演性亲密（整理衣领、假牵手）

# 信息 / 能力类
evidence_drop         // 证据抛出（掏录音笔、诊断书、手摸肚子）
ability_visualized    // 能力可视化（闭眼声波、光效）
inner_voice           // 内心独白（VO/OS）

# 结构 / 构图类
split_screen          // 分屏触发
freeze_frame          // 定格悬念
flashback             // 闪回
cross_cut             // 交叉切镜

# 兜底
other                 // 其他（必须在 summary 中详细描述）
```

**三选一 `major_climax.strategy` 是独立枚举**（只 3 值：`identity_reveal / evidence_drop / ability_visualized | null`），不等于 `action_type`；两者的对应关系见 §3.2 和 `v6_rhythm_templates.md` §7。

### 2.2 `beat_ledger[].structure_hints[]`（T08 · 新增）

```jsonc
{
  "structure_hints": [
    {
      "hint_id": "SH_001",
      "source_seg_id": "SEG_003",
      "type": "split_screen",    // enum: split_screen | freeze_frame | flashback | cross_cut | over_shoulder | mosaic_split
      "summary": "左右画面对比：女主查房 / 男反指令",
      "priority": "P0"           // P0=不可替代, P1=可替代
    }
  ]
}
```

### 2.3 `beat_ledger[].segments[].dialogue_char_count`（T13/T15 · 新增）

```jsonc
{
  "segments": [
    {
      "seg_id": "SEG_002",
      "segment_type": "dialogue",  // enum: dialogue | monologue | vo | descriptive
      "speaker": "护士A",
      "text": "刚刚那人是谁啊？我怎么从来没在心外科见过？",
      "dialogue_char_count": 22,   // int ≥ 0；descriptive 恒为 0

      /* v6.0 新增 · 作者授权压缩 */
      "author_hint": {
        "shortened_text": "手术风险极大，我不建议你做",
        "source_marker": "⚠️ 时长压缩建议",
        "rationale": "剧本自标注可压缩到关键句"
      }
    }
  ]
}
```

计算规则：
- 仅统计最终 `text` 的字符数（去编剧批注后）；
- 中文标点计 1，英文字母/数字各计 1；空格不计；
- `segment_type == descriptive` 恒为 0。

**`author_hint` 识别规则**（Normalizer v2 扫描）：

| 剧本标记模式 | 行为 |
|---|---|
| `⚠️ 时长压缩建议` / `时长压缩建议` / `建议压缩` 后跟"核心句：xxx"或"关键句：xxx" | 取冒号后引号内文本为 `shortened_text` |
| `（压缩为：xxx）` / `[核心句：xxx]` / `（可压缩到：xxx）` | 取括号内文本为 `shortened_text` |
| `主要保留：xxx / 可省略：yyy` 结构 | 取"主要保留"后文本为 `shortened_text` |
| 无标记 | `author_hint == null`，铁律 12 禁止压缩 |

`author_hint` 仅用于 `segment_type ∈ {dialogue, monologue, vo}` 的 seg；`shortened_text` 必须是原 `text` 的**子串或重排**（语义同源检查），否则 Normalizer 置 null 并在 `diagnosis.warnings[]` 报 `author_hint_semantic_mismatch`。

### 2.4 `meta.genre_bias_inferred`（T04/T10 · 新增）

```jsonc
{
  "meta": {
    "genre_bias_inferred": {
      "primary": "short_drama_contrast_hook",    // enum 见 §五
      "secondary": "mystery_investigative",      // nullable
      "confidence": 0.82,                         // float [0,1]
      "evidence": [
        { "source": "briefWhitelist.genre", "value": "女频短剧" },
        { "source": "scriptContent", "value": "出现'总裁/秘密身份'关键词 7 次" }
      ]
    }
  }
}
```

`primary` 受控词（v6 白名单，与 EditMap / rhythm_templates 保持一致）：

```
short_drama_contrast_hook
satisfaction_density_first
mystery_investigative
artistic_psychological
slow_burn_longform
mixed          // 无单一强信号，secondary 必填
unknown        // 证据不足
```

---

## 三、EditMap v6 `appendix` 增量

### 3.1 `meta.style_inference`（三轴 · 软门）

```jsonc
{
  "style_inference": {
    "rendering_style": {
      "value": "真人电影",                // v5 renderingStyle 受控词
      "confidence": 0.90,
      "evidence": ["directorBrief.rendering"]
    },
    "tone_bias": {
      "value": "cold_high_contrast",     // enum 见 §3.1.1
      "confidence": 0.75,
      "evidence": ["scriptContent.color_palette", "globalSynopsis.mood"]
    },
    "genre_bias": {
      "primary": "short_drama_contrast_hook",
      "secondary": null,
      "confidence": 0.80,
      "evidence": ["normalizer.meta.genre_bias_inferred"]
    }
  }
}
```

#### 3.1.1 `tone_bias.value` 受控词

```
cold_high_contrast     // 冷光高反差
warm_low_key           // 暖光低调
neutral_daylight       // 中性日光
neon_saturated         // 霓虹饱和
desaturated_gritty     // 低饱和粗粝
sunlit_pastel          // 日光淡彩
other
```

### 3.2 `meta.rhythm_timeline`（T13 · 硬门源）

```jsonc
{
  "rhythm_timeline": {
    "template_id": "short_drama_contrast_hook",
    "info_density_contract": {
      "min_info_points_per_5s": 1,
      "max_none_ratio": 0.15,
      "dialogue_char_per_second_max": 12
    },
    "golden_open_3s": {
      "block_id": "B01",
      "required": true,
      "required_elements_any_of": ["signature_entrance"]
    },
    "mini_climaxes": [
      {
        "seq": 1,
        "block_id": "B03",
        "five_stage": {
          "trigger":  { "hint": "...", "expected_shot_code": "A1" },
          "amplify":  { "hint": "...", "expected_shot_code": "B2" },
          "pivot":    { "hint": "...", "expected_shot_code": "A2" },
          "payoff":   { "hint": "...", "expected_shot_code": "A3" },
          "residue":  { "hint": "...", "expected_shot_code": "B1" }
        }
      }
    ],
    "major_climax": {
      "block_id": "B09",
      "strategy": "identity_reveal",       // enum: identity_reveal | evidence_drop | ability_visualized | null
      "required_signature_elements_any_of": [
        "仰拍","令牌特写","头衔台词"
      ]
    },
    "closing_hook": {
      "block_id": "B11",
      "cliff_sentence_required": true,
      "required_elements_any_of": ["freeze_frame","split_screen"]
    }
  }
}
```

### 3.3 `block_index[i]` 增量

```jsonc
{
  "block_index": [
    {
      /* v5 原字段 */
      "block_id": "B01",
      "editMapBlock": "...",
      "routing": { /* v5 原样 */ },

      /* v6 新增 */
      "covered_segment_ids": ["SEG_001","SEG_002","SEG_003"],
      "must_cover_segment_ids": ["SEG_001","SEG_002"],
      "script_chunk_hint": {
        "lead_seg_id": "SEG_001",
        "tail_seg_id": "SEG_003",
        "overflow_policy": "push_to_next_block"      // enum: push_to_next_block | split_into_sub_shots | drop_with_warning
      }
    }
  ]
}
```

**约束**：

- `covered_segment_ids` 覆盖所有本 block 命中 beat 的 seg_id；
- `must_cover_segment_ids ⊆ covered_segment_ids`，包含所有 `segment_type ∈ {dialogue, monologue, vo}` 的 seg + 所有 P0 KVA 所在 seg；
- 全体 block 的 `covered_segment_ids` 之并集必须 ⊇ `normalizer.beat_ledger[].segments[].seg_id` 的全集（除非在 `diagnosis.known_uncovered_segments[]` 显式声明）。

### 3.4 `diagnosis` 增量（软门）

```jsonc
{
  "diagnosis": {
    /* v5 原字段 */

    /* v6 新增 */
    "v6_checks": {
      "segment_coverage_l1_ratio": 0.98,
      "rhythm_timeline_template_matched": true,
      "major_climax_strategy_resolved": true,
      "known_uncovered_segments": []
    },
    "notice_msg_v6": []   // e.g. "major_climax_strategy_unresolved", "golden_open_missing_signature"
  }
}
```

---

## 四、Director v6 `appendix` 增量

### 4.1 `segment_coverage_report`（硬门源）

```jsonc
{
  "segment_coverage_report": {
    "block_id": "B01",
    "consumed_segments": [
      { "seg_id": "SEG_001", "segment_type": "descriptive", "consumed_at_shot": 1 },
      { "seg_id": "SEG_002", "segment_type": "dialogue",    "consumed_at_shot": 3 }
    ],
    "total_segments_in_covered_beats": 5,
    "consumed_count": 4,
    "coverage_ratio": 0.80,
    "missing_must_cover": [
      {
        "seg_id": "SEG_004",
        "reason": "slot 满 + 语义与 SEG_003 重复",
        "deferred_to_block": "B02"
      }
    ]
  }
}
```

### 4.2 `kva_consumption_report` + `kva_coverage_ratio`（硬门源）

```jsonc
{
  "kva_consumption_report": [
    {
      "kva_id": "KVA_001",
      "consumed_at_shot": 1,
      "shot_code": "A1",
      "verification": "高跟鞋特写 + 低仰 pan_up",
      "priority": "P0"
    }
  ],
  "kva_coverage_ratio": 1.0    // P0 覆盖率，取值 [0,1]
}
```

### 4.3 `structure_hint_consumption`

```jsonc
{
  "structure_hint_consumption": [
    { "hint_id": "SH_002", "type": "split_screen",
      "consumed_at_shot": 5, "shot_code": "D1",
      "verification": "分屏 + 左女主 / 右男反" }
  ]
}
```

### 4.4 `shot_meta[]`（硬门源）

```jsonc
{
  "shot_meta": [
    {
      "shot_idx": 1,
      "info_delta": "identity",        // enum 见 §4.4.1
      "five_stage_role": null          // 或 { "mini_climax_seq": 1, "stage": "trigger" }
    }
  ]
}
```

#### 4.4.1 `info_delta` 受控词

```
identity    // 身份/角色信息
motion      // 动作/位移
relation    // 关系/情感
prop        // 道具/物件
dialogue    // 对白信息
setting     // 场景/环境
none        // 纯过渡（连续 2 个 none → 硬门失败）
```

### 4.5 `extra_plot_injection_check`（软门 · v6.0；v6.1 升硬门）

```jsonc
{
  "extra_plot_injection_check": {
    "injected_plot_points": [],
    "injection_count": 0,
    "pass": true
  }
}
```

---

## 五、Prompter v6 `result` 增量

### 5.1 `dialogue_fidelity_check`（硬门）

```jsonc
{
  "dialogue_fidelity_check": {
    "checked_segments": [
      {
        "seg_id": "SEG_002",
        "director_shot_idx": 3,
        "prompter_shot_idx": 3,
        "raw_text": "...",
        "prompt_text": "...",
        "match_mode": "exact",      // exact | punctuation_only | annotation_stripped | shortened_by_author_hint | semantic_rewrite | summary_merged | silent_substitute
        "pass": true
      }
    ],
    "total": 4,
    "passed": 4,
    "fidelity_ratio": 1.0,
    "pass": true
  }
}
```

硬门阈值：`fidelity_ratio == 1.0`。

### 5.2 `kva_visualization_check` + `kva_coverage_ratio`（硬门）

```jsonc
{
  "kva_visualization_check": [
    {
      "kva_id": "KVA_001",
      "priority": "P0",
      "shot_idx": 1,
      "hit_elements": ["高跟鞋","低仰","镜头上移"],
      "required_hits_min": 1,
      "pass": true,
      "notice": null
    }
  ],
  "kva_coverage_ratio": 1.0
}
```

P0 条目必须 `pass: true`。

### 5.3 `rhythm_density_check`（硬门）

```jsonc
{
  "rhythm_density_check": {
    "window_sec": 5,
    "min_info_points_per_5s": 1,
    "max_none_ratio": 0.15,       // 来自 rhythm_timeline.info_density_contract
    "violations": [
      /* 若无，空数组 */
    ],
    "none_ratio": 0.10,
    "pass": true
  }
}
```

### 5.4 `five_stage_check[]`（硬门）

```jsonc
{
  "five_stage_check": [
    {
      "mini_climax_seq": 1,
      "block_id": "B03",
      "stages_present": ["trigger","amplify","pivot","payoff","residue"],
      "missing_stages": [],
      "pass": true
    }
  ]
}
```

### 5.5 `climax_signature_check`（硬门）

```jsonc
{
  "climax_signature_check": {
    "major_climax": {
      "applicable": true,
      "strategy": "identity_reveal",
      "shot_idx": 12,
      "hit_elements": ["仰拍","头衔特写"],
      "pass": true
    },
    "closing_hook": {
      "applicable": true,
      "shot_idx": 15,
      "hit_elements": ["分屏"],
      "pass": true
    }
  }
}
```

### 5.6 `segment_coverage_overall`（硬门 L2 + L3）

```jsonc
{
  "segment_coverage_overall": {
    "total_segments":              18,
    "consumed_segments":           18,
    "coverage_ratio":              1.00,

    "dialogue_like_total":         7,
    "dialogue_like_consumed":      7,
    "dialogue_like_coverage":      1.00,

    "pass_l2": true,   // coverage_ratio ≥ 0.90（v6.0）；v6.1 升到 0.95
    "pass_l3": true,   // dialogue_like_coverage == 1.0
    "missing_segments": []
  }
}
```

---

## 六、硬门/软门总览

| 字段 / 校验 | 消费者 | 门级 | v6.0 门槛 | v6.1 规划 |
|---|---|---|---|---|
| `covered_segment_ids` 并集 ⊇ Normalizer seg 全集 | EditMap | 软门 | warning，可在 `known_uncovered_segments` 声明 | 升硬门 |
| `style_inference` 三轴完整 | EditMap | 软门 | warning | 升硬门 |
| `rhythm_timeline` 模板匹配 | EditMap | 软门 | warning | 升硬门 |
| `major_climax.strategy` 要么合法 enum 要么 null | EditMap | **硬门** | 必须合法 | 同 |
| `segment_coverage_report.missing_must_cover[]` 无遗漏或全部 deferred | Director | **硬门** | pipeline 拦 | 同 |
| `kva_coverage_ratio`（P0） | Director / Prompter | **硬门** | == 1.0 | 同 |
| `shot_meta[].info_delta` 连续 2 none | Director / Prompter | **硬门** | 不允许 | 同 |
| 五段式完整 | Director / Prompter | **硬门** | mini_climax 所在 block 五阶段齐备 | 同 |
| 三选一签名命中 | Director / Prompter | **硬门** | strategy != null 时必须命中 | 同 |
| closing_hook 末 shot freeze/split_screen | Director / Prompter | **硬门** | 必须 | 同 |
| `dialogue_fidelity_check.fidelity_ratio` | Prompter | **硬门** | == 1.0 | 同 |
| `segment_coverage_overall.coverage_ratio` | Prompter | **硬门 L2** | ≥ 0.90 | ≥ 0.95 |
| `segment_coverage_overall.dialogue_like_coverage` | Prompter | **硬门 L3** | == 1.0 | 同 |
| `extra_plot_injection_check.pass` | Director | 软门 | warning | v6.1 升硬门 |
| `anti_cleansing_check`（对白反清洁化） | Prompter | — | v6.0 不引入 | **v6.1 新增硬门** |

---

## 七、降级开关语义

| 开关 | 作用 |
|---|---|
| `--allow-v6-soft` | 所有 v6 硬门降级 warning；保留字段输出 |
| `--skip-rhythm-timeline` | EditMap 不产 `meta.rhythm_timeline`；五段式 / 三选一 / closing_hook 硬门自动跳过；`info_delta` 仍生效 |
| `--rhythm-soft-only` | 五段式 / 三选一 / closing_hook / info_delta 降级 warning，但字段仍必须输出 |
| `--skip-scene-architect` | v6.0 不受影响（Scene Architect 为 v6.1 引入） |
| `--skip-style-inference` | EditMap 不产 `meta.style_inference`；Director 回落 v5 `parsed_brief`；三轴软门跳过 |
| `--skip-kva-hard` | KVA 硬门降级 warning；`kva_consumption_report` / `kva_visualization_check` 仍必须输出 |

---

## 八、与 v5 合同的兼容性

1. v5 合同的**所有字段**不受本 v6 增量影响；
2. v6 新增字段都带默认值：
   - Normalizer 未升级时，EditMap 读不到 KVA / genre_bias_inferred，按空数组/`unknown` 处理，EditMap `style_inference.genre_bias.primary` 走 fallback（基于 briefWhitelist.genre）；
   - EditMap 未升级时，Director payload 的 `scriptChunk / rhythmTimelineForBlock / styleInference` 全部为 null，v6 Director 自动退化为 v5 行为，硬门全部跳过；
3. `--allow-v6-soft` 开启时，所有 v6 合同都只产字段不拦截，用于观察期。

---

## 九、版本演进

| 版本 | 日期 | 状态 | 冻结内容 |
|---|---|---|---|
| v5 | 2026-04-16 | 🟢 Frozen | `docs/v5/07_v5-schema-冻结.md` 全部字段 |
| v6.0 | 2026-04-21 | 🟢 Frozen | 本文件（五个消费者的增量） |
| v6.1 | 计划 2026-05-04 | ⏳ | Scene Architect payload / 反清洁化 / 微表情去重 / 构图硬锚 |
