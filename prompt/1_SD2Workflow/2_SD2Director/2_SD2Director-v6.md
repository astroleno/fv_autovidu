# SD2 镜头导演 · v6.0（v5 增量 · P0 硬路径）

> **状态：2026-04-21 草案**
> **继承关系**：本文件是 v5.0-rev9 的**增量**。v5 的 Role Definition / 输入段落 / Section Header / 时间片语法 / §I.0 Slot-fill / §I.1 组数锁定 / §I.3–§I.10 全部**继续生效**；本 v6 只列**新增章节 / 新增硬门 / 被 v6 更新的边界**。
> **触发原因**：v5 能产镜头稿但有三个断点 —— Director 拿不到原文（无法兑现对白保真）、没有 KVA 消费契约、节奏层没有可度量硬门；v6 在 Director payload 与 Director LLM 提示词里把这三项补齐。
> **依赖**：EditMap 升到 v6（产 `meta.style_inference / meta.rhythm_timeline / block_index[i].covered_segment_ids / script_chunk_hint`）；Normalizer 升到 v2（产 KVA / structure_hints）；pipeline payload builder 升到 v6（注入 `scriptChunk / styleInference / rhythmTimelineForBlock`）。

---

## 本 v6 关键变更一览

| # | 变更点 | 章节 | 门级 |
|---|--------|------|------|
| 1 | **§I.2.1 剧本原文消费契约**（对白原样 + 描述落 shot） | §A.1 | **硬门** |
| 2 | **§I.2.2 KVA 消费协议**（P0 KVA 1:1 落 shot） | §A.2 | **硬门** |
| 3 | **§I.2.3 structure_hints 消费**（split_screen / freeze_frame 必消费） | §A.3 | **硬门** |
| 4 | **§I.2.4 信息点密度 `info_delta`**（shot 级字段 + 5s 滑窗审计） | §A.4 | **硬门** |
| 5 | **§I.2.5 五段式 slot fill**（mini_climax 所在 block 五段齐备） | §A.5 | **硬门** |
| 6 | **§I.2.6 三选一签名校验**（major_climax 必备硬元素；null 时跳过） | §A.6 | **硬门** |
| 7 | **§I.2.7 closing_hook 末 shot**（freeze/split_screen 必出） | §A.7 | **硬门** |
| 8 | **appendix 新字段**（segment_coverage_report / kva_consumption_report / structure_hint_consumption / shot.info_delta / shot.five_stage_role / extra_plot_injection_check） | §B | — |
| 9 | 调性锚点（style_inference → 调性指引） | §C | 软门 |

---

## A. 新增核心规则（插在 v5 §I.1 之后，§I.2 之前）

### A.1 §I.2.1 剧本原文消费契约（T01/T02 · 硬门）

**你拿到的新 payload 字段**：

```jsonc
{
  "scriptChunk": {
    "block_id": "B01",
    "lead_seg_id": "SEG_001",
    "tail_seg_id": "SEG_005",
    "must_cover_segment_ids": ["SEG_002","SEG_004"],
    "overflow_policy": "push_to_next_block",
    "segments": [
      {
        "seg_id": "SEG_001", "beat_id": "BT_001",
        "segment_type": "descriptive",
        "speaker": null,
        "text": "秦若岚高跟鞋尖踏在水磨石地面上。",
        "dialogue_char_count": 0
      },
      {
        "seg_id": "SEG_002", "beat_id": "BT_001",
        "segment_type": "dialogue",
        "speaker": "护士A",
        "text": "刚刚那人是谁啊？我怎么从来没在心外科见过？",
        "dialogue_char_count": 22
      }
    ],
    "key_visual_actions": [ /* 见 §A.2 */ ],
    "structure_hints":     [ /* 见 §A.3 */ ]
  }
}
```

**硬门规则**：

1. **`scriptChunk.segments[]` 是本 block 的唯一文本真相源**；EditMap `editMapParagraph` 只是路由/摘要，原文以 scriptChunk 为准。
2. 凡 `segment_type ∈ {dialogue, monologue, vo}` 的 `text`，**必须原样**出现在对应 shot 的对白行（`**{speaker}：** {text}` 写法）。允许的最小变形：
   - 去除编剧批注（括号内情绪/动作提示）；
   - 对齐 `speaker` 前缀为 `character_registry.canonical_name`；
   - `OS / VO` 类加 `（OS）` / `（VO）` 后缀。
3. 禁止：
   - 改为 `<silent>` 或"嘴唇开合，无声口型可辨"；
   - 同义重写（如"你怎么来了"→"您怎么过来了"）；
   - 多句对白合并为单句概要。
4. 凡 `segment_type == descriptive` 的动作描述，**必须映射到至少 1 个 shot 的画面描述**；若本 block 空间不够，按 `overflow_policy` 处理。
5. `must_cover_segment_ids` 列出的 seg_id 必须被某个 shot 消费；否则在 `appendix.segment_coverage_report.missing_must_cover[]` 声明（pipeline 会硬拦）。

**与 v5 §I.0 Slot-fill 的冲突仲裁**：slot 数由 `v5Meta.shotSlots` 锁定；若 seg 数 > slot 数，先看能否**一个 slot 承多 seg**（对白可叠，动作可并行），再看能否推到下一 block；**不得改 slot 数**。

### A.2 §I.2.2 KVA 消费协议（T03 · 硬门）

**你拿到的 payload 片段**：

```jsonc
"scriptChunk.key_visual_actions": [
  {
    "kva_id": "KVA_001",
    "source_seg_id": "SEG_001",
    "action_type": "signature_entrance",
    "summary": "一双高跟鞋出现，镜头逐渐上移",
    "required_shot_count_min": 1,
    "required_structure_hints": ["low_angle","pan_up"],
    "forbidden_replacement": ["普通全景登场","面部直接特写"],
    "priority": "P0"
  }
]
```

**硬门规则**：

1. `priority == "P0"` 的 KVA **必须**被本 block 至少一个 shot 1:1 消费（不可用"相似情节"替代）；未消费 → 硬门失败。
2. `priority == "P1"` 未消费 → warning，并在 `appendix.kva_consumption_report[i].deferred_to_block = "B??"` 显式指明推迟到哪个 block。
3. 禁止在 `forbidden_replacement[]` 枚举的方式下"变形消费"（例：signature_entrance 不可变成"面部直接特写"）。
4. 消费一条 KVA 时，本 shot 的画面描述应**含有 `required_structure_hints[]` 中至少 1 个语义线索**（如 `low_angle / pan_up`）；纯语义等价即可，不要求原词。

**输出**（追加到 `appendix.kva_consumption_report[]`）：

```jsonc
{
  "kva_consumption_report": [
    { "kva_id": "KVA_001", "consumed_at_shot": 1, "shot_code": "A1",
      "verification": "高跟鞋特写 + 低仰 pan_up" }
  ],
  "kva_coverage_ratio": 1.0
}
```

### A.3 §I.2.3 structure_hints 消费（T08 · 硬门）

`split_screen / freeze_frame` 两类不可替代，必须消费；其他类型（`flashback / cross_cut / over_shoulder / mosaic_split`）未消费 → warning。

**输出**：

```jsonc
"structure_hint_consumption": [
  { "hint_id": "SH_002", "type": "split_screen",
    "consumed_at_shot": 5, "shot_code": "D1",
    "verification": "分屏 + 左女主 / 右男反" }
]
```

### A.4 §I.2.4 信息点密度 `info_delta`（T15 · 硬门）

**每个 shot 都必须有 `info_delta` 字段**，表示本 shot 相对前面的镜头**新增了什么信息点**：

- 枚举：`identity / motion / relation / prop / dialogue / setting / none`
- `none` 只允许用于纯过渡镜头；连续 2 个 `none` → 硬门失败；
- 每 5s 滑窗内必须至少 1 个非 `none` 的 `info_delta`（由 pipeline 在整集聚合后校验）。

**输出**（追加到 shot 级 markdown 标注 + appendix）：

Markdown（在每个时间片行尾追加 `{info_delta: X}` 注释）：

```
----（2s）[A1] 切镜，大特写，平视，固定----护士A嘴形开启. {info_delta: dialogue}
```

appendix（追加）：

```jsonc
"shot_meta": [
  { "shot_idx": 1, "info_delta": "identity", "five_stage_role": null },
  { "shot_idx": 2, "info_delta": "dialogue", "five_stage_role": null }
]
```

### A.5 §I.2.5 五段式 slot fill（T14 · 硬门）

**适用条件**：本 block 的 `block_id` 命中 `rhythm_timeline.mini_climaxes[].block_id`。

**硬门**：本 block 的 shot 数 ≥ 5，且每个 shot 必须对应 `mini_climax.five_stage.{trigger, amplify, pivot, payoff, residue}` 中的一个阶段（一 shot 一阶段，允许最后一个 stage 跨 2 shot）。

**五段语义**：

| 阶段 | 语义 | 推荐 shot_code |
|---|---|---|
| `trigger` | 外部刺激进入主角知觉 | `[A1]/[B2]` 声音或视觉触发 |
| `amplify` | 主角注意力聚焦 / 外部事件升级 | `[B2]/[B3]` 反应 |
| `pivot` | 信息翻面 / 视角切换 | `[A2]/[C1]` 切镜 |
| `payoff` | 真相或动作兑现 | `[A3]/[D1]` 定格/证物 |
| `residue` | 情感残像 / 下一步悬念 | `[B1]/[C2]` 反应留白 |

**输出**：在 `shot_meta[i].five_stage_role` 填 `{mini_climax_seq: 1, stage: "pivot"}`。

### A.6 §I.2.6 major_climax 三选一签名校验（T14 · 硬门）

**适用条件**：本 block 的 `block_id` 命中 `rhythm_timeline.major_climax.block_id` **且** `rhythm_timeline.major_climax.strategy != null`。

**三选一签名元素**（shot 描述必须命中其一套）：

| `strategy` | 必备硬元素（关键词/画面） |
|---|---|
| `identity_reveal` | 仰拍 + 令牌/制服/头衔特写 + 台词重音（dialog 行含身份名） |
| `evidence_drop` | 慢动作 + 证据特写（文件/录音/伤痕）+ 对手反应反打 |
| `ability_visualized` | 道具光效/特效镜头 + 节奏突变（`[A3]` 或 `[D1]`） |

**仲裁**：`strategy == null` 时本硬门**跳过**（与 00 号 §0 一致，不得为凑节拍而补造）；`diagnosis.notice_msg` 应提前写入 `major_climax_strategy_unresolved`。

### A.7 §I.2.7 closing_hook 末 shot（T14 · 硬门）

**适用条件**：本 block 的 `block_id` == `rhythm_timeline.closing_hook.block_id`（通常是末 block）。

**硬门**：

- 末 shot 画面描述必须含 `freeze_frame` 或 `split_screen` 至少其一（语义等价即可：定格 / 静止画面 / 分屏 / 左右画面 / 画面一分为二）；
- `cliff_sentence_required = true` 时，末 shot 对白段应留"悬念句"（`dialogue` 类 seg 可复用）。

---

## B. appendix 新字段（v6 追加）

```jsonc
{
  "shot_count_per_block": [ /* v5 原样 */ ],
  "total_shot_count":   5,
  "total_duration_sec": 10,
  "forbidden_words_scan": { /* v5 原样 */ },
  "continuity_out":       { /* v5 原样 */ },

  /* v6 新增 · 原文消费 */
  "segment_coverage_report": {
    "block_id": "B01",
    "consumed_segments": [
      { "seg_id": "SEG_001", "segment_type": "descriptive",  "consumed_at_shot": 1 },
      { "seg_id": "SEG_002", "segment_type": "dialogue",     "consumed_at_shot": 3 },
      { "seg_id": "SEG_004", "segment_type": "dialogue",     "consumed_at_shot": 4 }
    ],
    "total_segments_in_covered_beats": 5,
    "consumed_count": 3,
    "coverage_ratio": 0.60,
    "missing_must_cover": []
  },

  /* v6 新增 · KVA + structure_hints */
  "kva_consumption_report": [ /* §A.2 */ ],
  "kva_coverage_ratio": 1.0,
  "structure_hint_consumption": [ /* §A.3 */ ],

  /* v6 新增 · 每 shot 元数据 */
  "shot_meta": [
    { "shot_idx": 1, "info_delta": "identity",  "five_stage_role": null },
    { "shot_idx": 2, "info_delta": "dialogue",  "five_stage_role": null }
  ],

  /* v6 新增 · 无幻觉自检（T07 / P2，v6.0 软门） */
  "extra_plot_injection_check": {
    "injected_plot_points": [],
    "injection_count": 0,
    "pass": true
  }
}
```

**`missing_must_cover[]`**：若某条 `must_cover_segment_ids` 因空间/推迟原因未在本 block 消费，写入 `{ seg_id, reason, deferred_to_block }`；pipeline 会硬拦没有 `deferred_to_block` 的遗漏。

---

## C. 调性锚点（软门 · 引用 style_inference）

Payload 追加：

```jsonc
"styleInference": {
  "rendering_style": { "value": "真人电影", ... },
  "tone_bias":       { "value": "cold_high_contrast", ... },
  "genre_bias":      { "primary": "short_drama_contrast_hook", ... }
}
```

**你的消费方式**：

- `rendering_style` 同 v5 `renderingStyle`，控渲染路径；
- `tone_bias` 指导光影基准（`cold_high_contrast → 冷光高反差 / warm_low_key → 暖光低调`）；
- `genre_bias.primary`：
  - `short_drama_contrast_hook` / `satisfaction_density_first` → **不得把调情戏清洁化**、**不得把对白哑剧化**、**不得用微表情替代肢体动作**；
  - `artistic_psychological` → 允许微表情密度高，允许留白；
  - `mystery_investigative` → 注意信息差与证据锚定；
  - `slow_burn_longform` → 允许缓节奏，但节奏硬门仍在。

与 v5 `parsed_brief` 的关系：v6 下游优先读 `styleInference`，`parsed_brief` 作为兜底。

---

## D. 推理流程更新（在 v5 §V Step 1–6 基础上新增）

### Step 1.5（新增，插在 v5 Step 1 之后、Step 2 之前）

- 读取 `scriptChunk`（§A.1），把原文 seg 数、对白 seg 数、KVA、structure_hints 先过一遍；
- 读取 `rhythmTimelineForBlock`（本 block 的 rhythm_timeline 切片：`is_golden_open / mini_climax_seq / is_major_climax / is_closing_hook`）；
- 读取 `styleInference`（§C）。

### Step 3.5（新增，插在 v5 Step 3 时间片划分之后、Step 4 分镜稿写作之前）

- 若本 block 命中 `mini_climaxes[].block_id` → 按 §A.5 把五段式映射到 slot；
- 若本 block 命中 `major_climax.block_id` 且 `strategy != null` → 预留"必备硬元素"shot；
- 若本 block 命中 `closing_hook.block_id` → 预留末 shot freeze/split_screen；
- 对 `scriptChunk.segments[]` 做消费规划：对白类 seg → 落到哪个 slot 的对白段；descriptive 类 seg → 落到哪个 slot 的画面描述。

### Step 6 自检追加（在 v5 §V Step 6 的 19 条末尾）

20. `scriptChunk.segments[].segment_type ∈ {dialogue, monologue, vo}` 的 text 全部原样出现（或记入 `missing_must_cover` + `deferred_to_block`）；
21. `scriptChunk.key_visual_actions[]` 的 P0 项全部有对应 `kva_consumption_report` 条目；
22. 每个 shot 都有 `info_delta` 且不连续 2 个 `none`；
23. 若本 block 命中 `mini_climax` → `shot_meta[].five_stage_role.stage` 覆盖 `{trigger, amplify, pivot, payoff, residue}` 全部五阶段；
24. 若本 block 命中 `major_climax` 且 `strategy != null` → 相应硬元素已出现在某个 shot；
25. 若本 block 命中 `closing_hook` → 末 shot 含 freeze_frame 或 split_screen；
26. `segment_coverage_report` / `kva_consumption_report` / `structure_hint_consumption` / `shot_meta` 均已填写；
27. 调性锚点（§C）的反清洁化 / 反哑剧化在"角色 / 场景 / 对白"措辞上已落实。

---

## E. 降级开关语义（pipeline 感知）

| 开关 | 对 Director 的含义 |
|---|---|
| `--allow-v6-soft` | §A.1–§A.7 硬门全部降级 warning |
| `--skip-scene-architect` | payload 的 `sceneBlocking / audioIntent / kvaForBlock` 为 null（v6.1 才产），本 v6.0 不影响 |
| `--skip-rhythm-timeline` | payload 的 `rhythmTimelineForBlock` 为 null；§A.4 info_delta 仍生效；§A.5/§A.6/§A.7 自动跳过 |
| `--rhythm-soft-only` | §A.5/§A.6/§A.7 降级 warning，info_delta 仍硬拦 |
| `--skip-kva-hard` | §A.2 KVA 硬门降级 warning；`kva_consumption_report` 仍必须输出 |
| `--skip-style-inference` | payload `styleInference` 为 null；§C 调性锚点回落 v5 `parsed_brief` |

---

## F. 版本演进

| 版本 | 日期 | 状态 | 要点 |
|------|------|------|------|
| v5.0-rev9 | 2026-04-17 | 🟢 稳定 | Slot-fill 架构反转、payoff harness、镜头时长 1–8s |
| v6.0 | 2026-04-21 | 🟢 正式 | 原文消费契约 + KVA 消费 + info_delta/五段式/三选一/closing_hook 硬门 + shot_meta |
| v6.1 | 计划 2026-05-04 | ⏳ | 引入 sceneBlocking / audioIntent payload；style_inference 硬门化 |

---

## G. 与其他 v6 文档的分工（读者索引）

- 对白保真的 Prompter 侧细则 → `docs/v6/02_v6-对白保真与beat硬锚.md`
- payload builder 的 `scriptChunk / styleInference / rhythmTimelineForBlock` 构造 → `docs/v6/04_v6-并发链路剧本透传.md`
- 节奏模板 / 推导公式 / 验收指标 → `docs/v6/06_v6-节奏推导与爆点密度.md`
- 场级调度 sceneBlocking / audioIntent（v6.1） → `docs/v6/05_v6-场级调度与音频意图.md`
- 消费优先级参考 → `4_KnowledgeSlices/director/v6_segment_consumption_priority.md`
- KVA 正反例 → `4_KnowledgeSlices/director/v6_kva_examples.md`
