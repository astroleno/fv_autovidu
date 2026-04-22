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
| `--skip-segment-coverage-hard` | Director `segment_coverage_report.coverage_ratio ≥ 0.90` 硬门降级 warning |
| `--skip-info-density-hard` | Director `shot_meta.info_delta.none_ratio` 硬门降级 warning |
| `--skip-dialogue-fidelity-hard` | Prompter sd2_prompt 对 `scriptChunk` 对白原文的字符级比对硬门降级 warning |
| `--skip-prompter-selfcheck-hard` | Prompter v6.1 自检硬门（8 条：`dialogue_fidelity` / `kva_coverage` / `rhythm_density` / `five_stage` / `major_climax` / `closing_hook` / `segment_l2` / `segment_l3`）整组降级 warning |

### 7.1 Prompter 自检硬门映射表（v6.1 新增：pipeline 实读 Prompter output）

v6.0 阶段 Prompter 虽然在 JSON output 里产出上述自检字段，但 pipeline 仅在 Director 侧做同名硬门，没有读 Prompter 自己的判定。**v6.1 起 pipeline 会同时消费 Prompter self-check**，这是为了暴露一种边界情况：**Prompter 正文照做但自检不自信**（例如 closing_hook 段没有 split_screen / freeze，Prompter 自己把 `climax_signature_check.closing_hook.pass = false`，但 Director 侧只能看 shot_meta 不知道 Prompter 怎么写 sd2_prompt）。

| 自检字段 | hardgate code | 通过判定 | 降级 flag |
|---|---|---|---|
| `dialogue_fidelity_check.fidelity_ratio` | `prompter_self_dialogue_fidelity` | `== 1.0` | `--skip-prompter-selfcheck-hard` |
| `kva_coverage_ratio` | `prompter_self_kva_coverage` | `== 1.0`（仅当 scriptChunk 含 P0 KVA） | 同上；无 P0 自动 skip |
| `rhythm_density_check.pass` | `prompter_self_rhythm_density` | `true` | 同上 |
| `five_stage_check[].pass` | `prompter_self_five_stage` | 全部 `true` | 同上 |
| `climax_signature_check.major_climax.pass` | `prompter_self_major_climax` | `applicable=false` 或 `pass=true` | 同上 |
| `climax_signature_check.closing_hook.pass` | `prompter_self_closing_hook` | `applicable=false` 或 `pass=true` | 同上 |
| `segment_coverage_overall.pass_l2` | `prompter_self_segment_l2` | `true` | 同上 |
| `segment_coverage_overall.pass_l3` | `prompter_self_segment_l3` | `true`（对白段 100%） | 同上 |

> 实现位置：`scripts/sd2_pipeline/lib/sd2_prompter_selfcheck_v6.mjs`。字段缺失时 `status=skip`（LLM 未输出），不拦截也不降级；真正 fail 才进入 hardgateOutcomes。

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
| v6.1-HOTFIX-A/B | 2026-04-21 | 🟢 Frozen | Stage 0 产物自动挂载 + Prompter 自检假阳性清洁化 |
| v6.1 | 计划 2026-05-04 | ⏳ | Scene Architect payload / 反清洁化 / 微表情去重 / 构图硬锚 |

---

## 十、v6.1 HOTFIX · 真相源透传与自检假阳性（2026-04-21）

> 触发背景：`leji-v6d` 全链路跑后，用户审稿发现"Stage 2/3 根本没吃到 `normalized_script_package`"——
>   导出 `sd2_final_report.json` 里 `has_normalized_script_package: false`；所有
>   `director_kva_coverage` 都降级为 `skip — no_kva_in_chunk`；B10 `dialogue_fidelity_check`
>   竟然以 `raw_text="" prompt_text="<silent>"` 的形态自报 `pass=true`（LLM 在无参照物
>   情况下给出的假阳性）。两条症状合起来让当轮所有 "pass" 都只是降级模式下的表面通过。

### 10.1 HOTFIX A · `run_sd2_pipeline.mjs` 自动挂载既有 Stage 0 产物

**问题根因**：`normalizerArtifactPath` 只在 Stage 0 **实跑成功**时被赋值。若用户传
`--skip-editmap` / `--no-normalizer` / `--dry-run`，变量保持空串，`--normalized-package`
不会传给 `call_editmap_sd2_v6.mjs` / `call_sd2_block_chain_v6.mjs`，
即使 output-dir 下 `normalized_script_package.json` 明明已经存在。

**修复**：Stage 0 block 结束后增加一段探测——若 `normalizerArtifactPath` 为空但
`normalizerOut` 文件存在（上一轮遗留或外部写入），自动挂载。

```js
if (sd2Version === 'v6' && !normalizerArtifactPath && fs.existsSync(normalizerOut)) {
  normalizerArtifactPath = normalizerOut;
  console.log(`[run_sd2_pipeline] Stage 0 未实跑，自动挂载既有产物：${normalizerOut}...`);
}
```

**日志指纹**：触发时会打印 `Stage 0 未实跑，自动挂载既有产物`；Stage 0 实跑成功时仍
走原路径 `Stage 0 产物就绪，将透传给 EditMap`，两条日志互斥。

**边界**：Stage 0 实跑失败会先 `process.exit(8/9)`，不会走到这条探测；`--no-normalizer`
场景若 output-dir 没有 normalized_script_package.json，探测也不误挂——保持诚实降级。

### 10.2 HOTFIX B · Prompter `dialogue_fidelity_check` 假阳性清洁化

**问题根因**：`checkPrompterSelfDialogueFidelity` 原本只看 `fidelity_ratio === 1` 就判 pass。
但 Prompter LLM 在 scriptChunk 缺失时会写出：

```json
{ "checked_segments": [{ "raw_text": "", "prompt_text": "<silent>", "pass": true }],
  "fidelity_ratio": 1, "pass": true }
```

——"我没检查到任何对白，所以我通过了"。pipeline 如果照单全收，相当于替 LLM 盖章假阳性。

**修复**：`checkPrompterSelfDialogueFidelity` 新增一层扫描——
`checked_segments` 中任一条 `raw_text === ""` **且** `prompt_text !== ""`，
整体降级为 `fail`（reason: `phantom_pass_detected`），不再信任 LLM 自报的 `fidelity_ratio`。

**边界**：
- 真实无对白场景 LLM 应输出 `checked_segments: []`（total=0），该路径 pass 不受影响；
- raw_text 与 prompt_text 均非空走原 `fidelity_ratio` 判定，完全兼容。

**回归测试**：`scripts/sd2_pipeline/tests/test_prompter_selfcheck_v6_hotfix_b.mjs`
覆盖 6 个用例（假阳性命中 / 真实无对白 / 真 pass / 真 fail / 字段缺失 / 多条假阳性），
CI 与本地都可直接 `node` 运行。

### 10.3 两条 HOTFIX 的协作关系

| 场景 | HOTFIX A 命中 | HOTFIX B 命中 | 最终判定 |
|---|---|---|---|
| Stage 0 实跑 + scriptChunk 正常 | N | N | LLM 自检按原规则判 |
| `--skip-editmap` 二跑 + 既有 Stage 0 产物 | **Y（自动挂载）** | N（有参照物，不会假阳性） | 下游所有硬门按真实状态判定 |
| `--no-normalizer` + 无 Stage 0 产物 | N | **Y（兜底降级假阳性）** | 假阳性被挡住，真实"无对白"仍 pass |
| Stage 0 实跑失败 | 不会走到（`process.exit`） | —— | 非零退出 |

两条修复彼此独立：A 是"让真相源不丢"，B 是"就算丢了也不装样子"。
任何一条单独打开都有防护价值，叠加即得深度防御。

### 10.4 HOTFIX C · 汇总导出器时间轴 bug 修复

**问题根因**：leji-v6e_pass2 复查发现 `sd2_final_report.json` 中 B05/B09 的 time
被错误地写成 `{start_sec: 0, end_sec: 12}`，但同一 block 的 `sd2_prompt` 内
timecode 明明写的是 `00:48–00:60` / `00:96–00:108`。两层 bug：

1. **正则太严格**：`extractTimeFromShots` 原正则
   `^\s*(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})\s*$`
   强制分/秒各 2 位。LLM 偶尔写出 `00:96–00:108`（把 96 秒写成 "00:96" 而不是
   "01:36"），秒位 `108` 是 3 位数直接拒识，整段 fallback。
2. **Fallback 从 0 开始**：timecode 解析失败时，原代码直接从 0 累加 `duration_sec`，
   完全没有参考 EditMap 里该 block 的真实起止时间，于是 B05 被写成 0–12s 而不是
   48–60s。

**修复**：
- **C-1 正则放宽**：`(\d{1,4}):(\d{1,4})`，仍用 `分*60+秒` 语义解释。
  `00:96` → 96 秒（与 `01:36` 等价），`00:108` → 108 秒。
- **C-2 三段 fallback 链**：`extractV6ResultView(result, editMapBlockTime)` 新增参数，
  `extractTimeFromShots(shots, editMapBlockTime)` 对应：
  1. shots[].timecode 首末解析成功 → 用之；
  2. 解析失败 + EditMap block.time 可用 → 用 EditMap；
  3. 最终兜底：从 0 累加 duration_sec（历史行为，仅当前两路都空）。
- **EditMap 产物索引**：exporter 读 `edit_map_sd2.json` 构建
  `block_id → time` 映射。Director payload 的 `edit_map_block` 在 v6 链路上
  经常是空 dict，所以直接查 EditMap 产物最稳。

**日志指纹**：无新增日志；修复前症状是 final_report 里 `time: {start_sec: 0, ...}`
与 prompt 内 timecode 脱节；修复后 time 总是与 prompt 内 timecode 或 EditMap 对齐。

**回归测试**：`scripts/sd2_pipeline/tests/test_export_timecode_v6_hotfix_c.mjs`
覆盖 8 个用例：标准格式 / 3 位秒放宽 / 等价写法 / EditMap 兜底（leji-v6e_pass2 B05
场景）/ 历史兜底 / 优先级正确 / 中英破折号 / 空 shots。

**与 A/B 的关系**：C 只管"导出器把时间写对"，不参与硬门判定，和 A/B 正交。
但如果没有 A 把 normalized_script_package 透传下来，即便时间轴正确，内容也还是
脱锚——所以交付验收的顺序是 A → B → C，缺一不可。

### 10.5 HOTFIX D · EditMap 段覆盖硬门化 + tail_seg 几何约束 + diagnosis 权威回填

**问题根因**：leji-v6e_pass2 回归观察到 —— 即便 A/B/C 三发 HOTFIX 都已落地，EditMap
仍然只把 62 个 seg 中的前 26 个送进下游（ratio=0.419）。更严重的是：LLM 在
`appendix.diagnosis.segment_coverage_ratio_estimated` 字段里**自填 0.97**，和 pipeline
实算值 0.419 差了一个数量级。由于 L1 是**软门**（只 warn 不拦），加上 LLM 自报一个"真阳性"
数字，所以最终 `segment_coverage_check: true` 一路放行，后半场（撞破对峙、怀孕反转、
绿茶插话、门外幻想、closing hook 素材）整段没进 block，导致"工程成立，叙事不成立"。

**三条根因**：
1. **L1 覆盖是软门**：`ratio < 0.95` 只 warn，不阻塞。遇到 LLM 懒惰策略（"能切多少切多少、
   装作覆盖率够了"）时，没有兜底拦截。
2. **LLM 可自填结论字段**：`diagnosis.segment_coverage_ratio_estimated` 是一个"LLM 自评"
   字段，pipeline 原先不覆盖。LLM 可以"自报 pass"，让下游误以为已验证。
3. **缺 tail_seg 几何约束**：即便整体 ratio 达标，LLM 也可以"放弃最后 3 段"换总覆盖率 96%，
   但最后 3 段往往是 cliffhanger / closing_hook 的物料，放弃等于叙事破产。

**修复三件套**：

- **D-1 · L1 段覆盖升级硬门**：`call_editmap_sd2_v6.mjs` 的 `runSegmentCoverageL1Check`
  返回 `status === 'fail'` 时，默认 `process.exit(7)`。仅当 CLI 传 `--allow-v6-soft` 或
  `--skip-editmap-coverage-hard` 时降级为 warn（保留审计轨迹）。
- **D-2 · 新增 last_seg_covered_check 硬门**：`runLastSegCoveredCheck(parsed, normalizedPackage)`。
  从 `beat_ledger[*].segments[]` 取出时间轴上**最后一个** `seg_id`（ordered universe 末元素），
  扫 `⋃ block_index[i].covered_segment_ids[]` 是否命中。未命中 → `process.exit(7)`。可 `--skip-last-seg-hard`
  单独降级。
- **D-3 · diagnosis 权威回填**：`backfillDiagnosisAuthoritativeMetrics(parsed, segCheck, tailCheck)`
  在 pipeline 层直接覆盖：
  - `diagnosis.segment_coverage_check` = `segCheck.status === 'pass'`
  - `diagnosis.segment_coverage_ratio_estimated` = pipeline 实算（保留 3 位小数）
  - `diagnosis.last_seg_covered_check` = `tailCheck.status === 'pass'`
  - `diagnosis.pipeline_authoritative = true` + `pipeline_authoritative_note`
  - LLM 原值留底到 `*_llm_self_reported` 字段（仅审计，不进下游决策）

**日志指纹**（成功）：
```
[call_editmap_sd2_v6] v6 硬门 · segment_coverage L1: pass (62/62, ratio=1.000)
[call_editmap_sd2_v6] v6 硬门 · last_seg_covered_check: pass tail=SEG_062
```

**日志指纹**（严格模式失败 · 非降级）：
```
[call_editmap_sd2_v6] v6 硬门 · segment_coverage L1: fail (26/62, ratio=0.419) missing(前12)=SEG_027,SEG_028,...
[call_editmap_sd2_v6] v6 硬门 · last_seg_covered_check: fail tail=SEG_062 (tail_seg SEG_062 not found in any block.covered_segment_ids)
[call_editmap_sd2_v6] ❌ v6 EditMap 硬门失败 2 项：
  - segment_coverage_l1 ratio=0.419 < 0.95 (26/62)
  - last_seg_covered_check: tail_seg SEG_062 not found in any block.covered_segment_ids
[call_editmap_sd2_v6] 如需一次性降级请加 --allow-v6-soft（或对应 --skip-editmap-coverage-hard / --skip-last-seg-hard）。拒绝写盘。
(exit 7)
```

**降级开关矩阵**：

| flag | 效果 |
|---|---|
| 无 flag（严格模式） | L1 + tail_seg 任一 fail → exit 7 |
| `--skip-editmap-coverage-hard` | L1 降级 warn，tail_seg 仍硬门 |
| `--skip-last-seg-hard` | tail_seg 降级 warn，L1 仍硬门 |
| `--allow-v6-soft` | 一次性全部降级（包含 D/E/F + Prompter 侧 B 系列） |

**回归测试**：`scripts/sd2_pipeline/tests/test_editmap_hardgate_v6_hotfix_d.mjs`
覆盖 21 个用例：universe 抽取 / L1 pass/fail/skip / 阈值边界（59/62, 58/62）/ tail_seg 三态
/ diagnosis 回填（含 LLM 留底）/ 动态硬下限公式 / appendHardFloor 正确性。

### 10.6 HOTFIX E · 1_EditMap-SD2-v6.md prompt 文档收口

**动机**：D 在代码层把 L1/tail 硬门化之后，LLM 侧的 system prompt 还在说"L1 是软门"、
还在让 LLM 自填 `segment_coverage_check` 和 `segment_coverage_ratio_estimated`。prompt 与
pipeline 行为脱节会让 LLM 端产生自相矛盾的指令，影响下一轮生成质量。

**修复**：
- §A.2 门级由"软门"→"**硬门**（v6.1-HOTFIX-D 升级）"。
- §A.5 三层覆盖率表格 L1 软 → **硬**，新增 L1.5（tail_seg_covered_check）行。
- §A.5 正文追加 HOTFIX-D 动机段、exit 7 语义、降级开关说明。
- §A.6 `diagnosis` 追加"pipeline 回填"条款：
  - `segment_coverage_check` / `segment_coverage_ratio_estimated` / `last_seg_covered_check` 由 pipeline 权威回填；
  - LLM 自填会被覆盖，原值留底到 `*_llm_self_reported`；
  - 明确"LLM 禁止自评上述字段"。
- §B.4 自检条目追加 #9（tail_seg 必须进 block）与 #10（服从"动态硬下限"段）。
- §C 降级开关表追加 `--skip-editmap-coverage-hard` / `--skip-last-seg-hard`。
- §D 版本演进追加 v6.1-HOTFIX-A/B/C/D/E/F 条目。

### 10.7 HOTFIX F · directorBrief 动态硬下限注入

**背景**：用户验收目标是"**120 秒 × 高密度快节奏 × 至少 50 个镜头**"。但
`prepare_editmap_input.mjs` 生成的默认 brief 用的是软措辞「镜头总数请基于剧本密度 …
自主决定（参考区间 45–75，以剧本节奏为准）」。这类"参考区间"LLM 经常解读为
"可以不到下限"，导致只出 26 个 block/shot 覆盖前半段。

**设计决策（用户 2026-04-21）**：
- 走方案 B：代码硬门 + prompt 文档 + brief 文案三路并举；
- 数字用**动态**而非固定：`max(50, segs_count)` / `max(15, ceil(segs_count/4))`，对不同体量
  剧本通用。

**修复**：在 `call_editmap_sd2_v6.mjs` 组装 `userPayload` 之前（但在 Stage 0 产物挂载之后），
调用 `composeDynamicHardFloorBrief(segsCount, tailSegId, episodeDuration)` 生成一段"HOTFIX F
标记的最高优先级硬约束"文字，通过 `appendHardFloorToDirectorBrief` 追加到
`userPayload.directorBrief` 末尾。LLM 看到的内容：

```
──（HOTFIX F · pipeline 注入 · 最高优先级硬约束，覆盖上方"参考区间"软措辞）──
本集目标：120 秒 × 高密度快节奏；剧本共 62 个 segment。
【硬下限 · 镜头】shots.length ≥ 62（max(50, segs_count)）。达不到就继续拆，不要省略后半场。
【硬下限 · Block】blocks.length ≥ 16（max(15, ceil(segs_count/4))），且每块 4–15s、总时长守恒。
【硬下限 · Segment 覆盖】⋃ covered_segment_ids ⊇ 全集 segs × 0.95，L1 覆盖率 < 0.95 → 硬门失败。
最后一个 seg（SEG_062）必须进入最后一个 block.covered_segment_ids，否则流水线会用 last_seg_covered_check 硬门拦截。
如果剧本体量 > 目标时长，请通过"每 block 镜头数↑ + 每镜头时长↓"的方式压缩，而不是丢弃后半段 segment。
禁止 LLM 自填 appendix.diagnosis.segment_coverage_check / segment_coverage_ratio_estimated，此两字段由 pipeline 回填（HOTFIX D）。
```

**时序考虑**：`prepare_editmap_input.mjs` 跑在 Stage 0 之前，拿不到 segs_count。因此
把动态计算放在 `call_editmap_sd2_v6.mjs` 的 userPayload 组装阶段（此时 Stage 0 产物已挂载），
是改动最小、时序最稳的方案。

**日志指纹**：
```
[call_editmap_sd2_v6] HOTFIX F · 动态硬下限已注入 directorBrief：shot≥62 / block≥16 / tail=SEG_062
```

**与 D/E 的协作**：
- **F → LLM**：prompt 层面告知 LLM 数字下限，把"软参考区间"压为"硬下限"；
- **D → pipeline**：代码层面兜底，LLM 不听话也会被 exit 7 拦住；
- **E → prompt doc**：system prompt 本体也同步改写，避免 LLM 看到内部矛盾的两套说法。
三者叠加实现"prompt 打招呼 + 代码兜底 + 文档一致"的深度防御。

### 10.8 交付验收顺序

A → B → C → D → E → F **顺序必须**：
- A 不先落：Stage 0 产物不传到下游，D/F 都无从拿 `segs_count` / `tail_seg_id`；
- B 不先落：Prompter 层仍会"自欺 pass"，掩盖上游 EditMap 的真实失败；
- C 不先落：时间轴写错会误导"Block 覆盖正确但时长错位"的判断；
- D 不先落：L1 软门会让 LLM 幻觉 ratio=0.97 直接通过；
- E 不先落：prompt 仍让 LLM 自填结论字段，和 D 冲突；
- F 不先落：没有"至少 N shot / 至少 M block"的显式硬约束，LLM 会按"参考区间"下限偷懒。

验收命令（严格模式）：
```bash
node scripts/sd2_pipeline/run_sd2_pipeline.mjs \
  --sd2-version v6 \
  --project-id leji-v6f \
  --episode-id 第1集 \
  --script-file sample/第1集/剧本.md \
  --duration 120 \
  # 注意：**不要** 加 --allow-v6-soft，跑严格模式
```

---

## 11. HOTFIX G/I/J（2026-04-22）· 源真相铁律 + Prompter 防崩 + 豆包后端

### 11.1 触发原因（leji-v6f 豆包实验）

leji-v6f 在豆包 Ark 后端下跑出**三类新的严重缺陷**：

1. **EditMap 伪造 seg_id**：真实 Normalizer universe 到 `SEG_062` 为止，但 LLM 在 `appendix.block_index[15/16].covered_segment_ids` 里自造了 `SEG_063`–`SEG_072` 共 10 个伪段，并在 `markdown_body` 额外长出一个"剧本外尾钩字幕"。HOTFIX-D 的 L1 `collectCoveredSegmentIds` **用 universe 过滤伪段**，所以伪段不进覆盖率、也不报警，导致"假 pass 传染下游"。
2. **B03 Prompter repetition collapse**：`prompts/B03.json` 的 `global_prefix` 被 LLM 循环填充"偶像剧、家庭剧、伦理剧、婆媳剧、宅斗剧…"重复到 23530 字符，耗光 max_tokens，其余自检字段（`dialogue_fidelity_check` / `segment_coverage_overall` / `pass_l2` / `pass_l3`）全部被截断丢失，pipeline 只能全部 skip，整 block 静默失败。
3. **Stage 2/3 换后端的需求**：用户手搓了 `call_sd2_block_chain_v6_doubao.mjs` 做 Ark 适配，需要 `run_sd2_pipeline.mjs` 提供正式的 backend 开关。

### 11.2 HOTFIX G · source_integrity_check 硬门

**代码**：`scripts/sd2_pipeline/call_editmap_sd2_v6.mjs`

- 新增纯函数 `collectAllReferencedSegIds(parsed)`：**不过滤 universe**，扫出 `appendix.block_index[*].{covered_segment_ids, must_cover_segment_ids, script_chunk_hint.{lead_seg_id, tail_seg_id, must_cover_segment_ids}}` 中所有被引用的 seg_id；
- 新增纯函数 `runSourceIntegrityCheck(parsed, normalizedPackage)`：
  - `'pass'`：所有引用 ⊆ universe；
  - `'fail'`：存在引用 ∉ universe，附带 `outOfUniverseIds`；
  - `'skip'`：Stage 0 未挂载或 universe 为空；
- `main()` 里作为硬门接入：`sourceCheck.status === 'fail'` 时 `hardFails.push(...)` → `process.exit(7)`；
- 支持降级：`--skip-source-integrity-hard` 或 `--allow-v6-soft`；
- `appendix.diagnosis.v6_softgate_report.source_integrity` 回写审计轨迹。

**Prompt 文档同步**：`1_EditMap-SD2-v6.md` §A.5 新增 L1.6 行、§B.4 新增自检条目 #11（源真相铁律）。

**回归测试**：`tests/test_editmap_hardgate_v6_hotfix_g.mjs`（15 用例，全过），覆盖：
- `collectAllReferencedSegIds` 的去重/嵌套 hint 扫描；
- pass / fail（复现 v6f 豆包伪段）/ skip 三路径；
- `hint.must_cover` 里的伪 seg 也能被抓到。

### 11.3 HOTFIX I · Prompter 产物完整性 + repetition collapse 自动重试

**代码**：
- 新模块 `scripts/sd2_pipeline/lib/sd2_prompter_anomaly_v6.mjs`
  - `detectPrefixRepetitionCollapse(globalPrefix)`：若 `globalPrefix.length > 4000` 且存在某个 3–6 字**纯中文**短语（非同一字重复）出现 ≥ 20 次 → 判定 collapse；
  - `detectTailFieldsMissing(prParsed)`：`dialogue_fidelity_check` / `segment_coverage_overall` / `forbidden_words_self_check` 必须至少 1 个存在；
  - `shouldRetryPrompter(prParsed)`：综合判定。
- 调用链 `scripts/sd2_pipeline/call_sd2_block_chain_v6.mjs`
  - 把 Prompter `callLLM` 包进两次尝试的循环：第 1 次温度 `0.35`、第 2 次温度 `0.55`；
  - 若第 1 次判定异常，日志 `⚠️ Prompter 产物异常，以 temperature=0.55 自动重试…`；
  - 若两次都异常，保留最后一次解析结果、写 `_v6_anomaly_retry.reasons`，让下游硬门（`runAllPrompterSelfChecks`）按 fail 处置。
- 产物元数据：`prompts/Bxx.json._v6_anomaly_retry = { attempts, reasons, hotfix: 'I' }`。

**回归测试**：`tests/test_prompter_anomaly_v6_hotfix_i.mjs`（22 用例，全过），覆盖：
- v6f B03 真实样式循环复现 + phrase 命中；
- 正常 prefix 不误伤（英文重复 / 单字重复 / 非循环中文都不触发）；
- `shouldRetryPrompter` 四象限（双阳 / 单阳 / 双阴）的 reasons 排列。

### 11.4 HOTFIX J · `run_sd2_pipeline --block-chain-backend=doubao`

**代码**：`scripts/sd2_pipeline/run_sd2_pipeline.mjs`

- 新增 CLI 参数 `--block-chain-backend`，值 `default`（默认，保持 DashScope/云雾）或 `doubao`（切火山 Ark）。
- 仅对 `--sd2-version v6` 生效；其他版本忽略。
- `doubao` 模式下 chainScript 改为 `call_sd2_block_chain_v6_doubao.mjs`（用户提供的入口已经把 `ARK_*` 映射到 `SD2_LLM_*` 并复用 v6 主脚本的 `main()`）。
- 同时透传新的降级 flag `--skip-source-integrity-hard` 到 EditMap 层。

**与块间并发/块内串行的关系**：HOTFIX J **只替换 LLM HTTP 后端**，不改动 fan-out（`Promise.all + runOne`）与 block 内 Director → Prompter 串行的执行语义。

### 11.5 交付顺序

A→B→C→D→E→F→**G→I→J** 必须有序：

- **G** 依赖 D 的 universe 计算（`computeSegmentUniverseFromPackage` 复用）；不先落，后半场（或剧本外）伪段会继续污染 Director/Prompter；
- **I** 独立，但部署顺序放在 G 之后：先保证 EditMap 不伪造，再保证 Prompter 偶发崩溃能自愈；
- **J** 放最后：只有 G/I 落地后，豆包后端的验收才有意义——否则伪段/重复崩溃的问题会被误记到"豆包模型差"账上。

### 11.6 验收命令（leji-v6g · 豆包并发）

```bash
node scripts/sd2_pipeline/run_sd2_pipeline.mjs \
  --sd2-version v6 \
  --project-id leji-v6g \
  --episode-id 第1集 \
  --script-file sample/第1集/剧本.md \
  --duration 120 \
  --block-chain-backend doubao
  # 严格模式：不加任何 --skip-* / --allow-v6-soft
```

Stage 0/1（Normalizer / EditMap）仍走 DashScope；Stage 2/3（Director / Prompter 块链）切豆包并发。期望 `v6_softgate_report.source_integrity.status === 'pass'` 且不再出现 `SEG_063+` 伪段。

### 11.7 leji-v6g 验收结果（2026-04-22 豆包并发跑）

**三类严重缺陷全部消失：**

| 缺陷类别 | leji-v6f | leji-v6g |
|---|---|---|
| EditMap 伪造 SEG_063–072 | ❌ 10 个伪段 | ✅ source_integrity=pass，totalReferenced=61，全部 ⊆ universe |
| B03 `global_prefix` 膨胀 23KB、尾部字段丢失 | ❌ `field_missing / pass_l2_missing` | ✅ `global_prefix=33` 字符，`dialogue_fidelity_check / segment_coverage_overall / forbidden_words_self_check` 全部齐备 |
| 16 个 block 尾部自检字段 | B03 缺失 | ✅ 16/16 `tail_ok` |

**额外发现 + HOTFIX K：**

豆包 `doubao-seed-2-0-pro-260215` 系列文本模型**不支持** `response_format: json_object`（返回 `InvalidParameter`）。新增 `SD2_LLM_DISABLE_JSON_RESPONSE_FORMAT=1` 环境变量，`applyArkEnvForSd2Pipeline()` 默认开启；JSON 归一由 system prompt 硬约束 + `parseJsonFromModelText` 的 `jsonrepair` 兜底。

**仍残留的 LLM 质量问题（13 项硬门失败，归属 HOTFIX H 待处理）：**

- `director_kva_coverage` × 7（B04/B05/B06/B07/B09/B10/B13）— Doubao 漏掉部分 P0 KVA；
- `director_segment_coverage @ B16` = 0.21 — B16 覆盖率 LLM 策略性偏低；
- `prompter_dialogue_fidelity` × 5（B09/B11/B13/B15/B16）— 缺 SEG_028 / SEG_034 / SEG_040 / SEG_045 / SEG_048/53/54 对白。

**结论**：HOTFIX G/I/J/K 修复了"基础设施性"问题（伪造段、JSON 崩溃、模型后端兼容），Doubao 后端的 fan-out 并发已完全跑通；剩余的"对白保住 / 动作没保住"属于 LLM payload 增强范畴（HOTFIX H 规划中），不在本轮修复范围。
