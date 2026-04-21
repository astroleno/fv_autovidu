# SD2 提示词编译器 · v6.0（v5 增量 · P0 硬路径）

> **状态：2026-04-21 草案**
> **继承关系**：本文件是 v5 的**增量**。v5 的 Role Definition / §0 强制红线 / §1 输入源 / §2 核心规则 / §3 口型契约 / §4 资产标签 / §5 Director [CODE] 透传 / §6 禁用词自查 全部**继续生效**；本 v6 只列**新增铁律（12/13/17/18/19）+ 新增自检字段 + 被更新的边界**。
> **触发原因**：v5 能产 JSON 但 ① 对白经常被改写或哑剧化，② KVA 没被消费到画面层，③ 信息密度 / 爆点节奏没有硬门，④ 段落（segment）层面没有覆盖度校验。v6 把这四点从"Director 产出校验"延伸到 Prompter 自身的输出自检。

---

## 本 v6 关键变更一览

| # | 变更点 | 章节 | 门级 |
|---|--------|------|------|
| 1 | **铁律 12**：对白保真（segment 原文 → prompt 对白 1:1） | §A.1 | **硬门** |
| 2 | **铁律 13**：KVA 可视化（P0 KVA → prompt 画面描述命中） | §A.2 | **硬门** |
| 3 | **铁律 17**：信息点密度（5s 滑窗 ≥ 1 非 none 的 info_delta） | §A.3 | **硬门** |
| 4 | **铁律 18**：五段式完整（mini_climax block 五阶段齐备） | §A.4 | **硬门** |
| 5 | **铁律 19**：三选一 + closing_hook 可视化签名 | §A.5 | **硬门** |
| 6 | output JSON 新增自检字段（`dialogue_fidelity_check / kva_visualization_check / rhythm_density_check / five_stage_check / climax_signature_check / segment_coverage_overall`） | §B | — |
| 7 | scriptChunk / kvaForBlock / rhythmTimelineForBlock 新 payload 消费说明 | §C | — |

---

## A. 五条新增铁律（插在 v5 §0 强制红线之后）

### A.1 铁律 12 · 对白保真（T01 · 硬门）

**规则**：Director 产出的 `appendix.segment_coverage_report.consumed_segments[]` 中 `segment_type ∈ {dialogue, monologue, vo}` 的 seg，其 `text` **必须 1:1** 出现在本 shot 对应 prompt 的"对白"字段（或段落内的对白行）。

**允许的微调**（不算违规）：
- 去除编剧批注（括号内情绪/动作提示）；
- 对齐 `speaker` 前缀为 canonical_name；
- `OS/VO` 类 seg 加音源标签（"画外音 OS："/"独白 VO："）并保持原文；
- 中英标点互换（，↔,）；
- **作者授权的压缩**（`match_mode == shortened_by_author_hint`）：当 Normalizer v2 在 seg 上附带 `author_hint.shortened_text`（来自剧本内"⚠️ 时长压缩建议 / 核心句 / 压缩为"等标记）时，允许用 `shortened_text` 替换 `raw_text`；其余部分作为 VO 背景淡出。

**禁止**：
- 同义改写（"你怎么来了"→"您怎么过来了"）；
- 合并多句为一句摘要（除非有 `author_hint.shortened_text`）；
- 改为 `<silent>` / 哑剧化；
- 把对白移到另一 shot（只能落在 Director 指派的 `consumed_at_shot`）。

**自检**（写入 output JSON）：

```jsonc
{
  "dialogue_fidelity_check": {
    "checked_segments": [
      {
        "seg_id": "SEG_002",
        "director_shot_idx": 3,
        "prompter_shot_idx": 3,
        "raw_text": "刚刚那人是谁啊？我怎么从来没在心外科见过？",
        "prompt_text": "刚刚那人是谁啊？我怎么从来没在心外科见过？",
        "match_mode": "exact",
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

`match_mode ∈ {exact, punctuation_only, annotation_stripped, shortened_by_author_hint}` 才算通过；`semantic_rewrite / summary_merged / silent_substitute` 即硬门失败。

**`shortened_by_author_hint` 的追加要求**：
- Normalizer v2 必须在对应 seg 上产出 `author_hint.shortened_text`（非空）；
- Prompter 输出的对白必须**精确匹配 `shortened_text`**（或其标点/批注微调版），否则降级为 `semantic_rewrite`；
- 被省略的部分允许作为 VO 背景淡出（但不要求落实到 prompt 文本）。

### A.2 铁律 13 · KVA 可视化（T03 · 硬门）

**规则**：Director `appendix.kva_consumption_report[]` 中 `priority: "P0"` 的 KVA，其 `verification` 字段在 prompt 对应 shot 的"画面描述 / 动作 / 构图"中**必须命中语义**。

**命中判定**（任一即可）：
1. `required_structure_hints[]` 中任一词（`low_angle / pan_up / close_up / freeze_frame / split_screen`）的中文语义出现；
2. `summary` 中的核心名词（"高跟鞋 / 令牌 / 分屏"）在 prompt 中出现；
3. 语义同族词（如 "特写镜头"="close_up"）。

**自检**：

```jsonc
{
  "kva_visualization_check": [
    {
      "kva_id": "KVA_001",
      "shot_idx": 1,
      "hit_elements": ["高跟鞋","低仰","镜头上移"],
      "required_hits_min": 1,
      "pass": true
    }
  ],
  "kva_coverage_ratio": 1.0
}
```

P0 KVA 未命中 → 硬门失败。P1 KVA 未命中 → warning，放入 `kva_visualization_check[].notice`。

### A.3 铁律 17 · 信息点密度（T15 · 硬门）

**规则**：以 Director 写入的 `shot_meta[].info_delta` 为源，构造 5 秒滑窗：
- 每个滑窗内必须至少 `rhythm_timeline.info_density_contract.min_info_points_per_5s` 个非 `none` 的 `info_delta`（默认 1）；
- 连续 2 个 `none` → 硬门失败；
- 整集 `none` 比例 ≤ `rhythm_timeline.info_density_contract.max_none_ratio`（不同 genre 模板为 0.10–0.30，见 `4_KnowledgeSlices/editmap/v6_rhythm_templates.md`）；
- `rhythm_timeline` 为 null 时（`--skip-rhythm-timeline`），退化为"整集 `none` 比例 ≤ 0.20"的默认阈值。

**自检**：

```jsonc
{
  "rhythm_density_check": {
    "window_sec": 5,
    "min_info_points_per_5s": 1,
    "max_none_ratio": 0.15,
    "violations": [],
    "none_ratio": 0.10,
    "pass": true
  }
}
```

**注**：Prompter 只校验、不改写；违规时本次任务失败、回滚到 Director 重产。

### A.4 铁律 18 · 五段式完整（T14 · 硬门）

**规则**：对所有 `rhythm_timeline.mini_climaxes[].block_id` 覆盖的 block，其 `shot_meta[].five_stage_role.stage` 必须完整覆盖 `{trigger, amplify, pivot, payoff, residue}`。

**自检**：

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

### A.5 铁律 19 · 三选一 + closing_hook 签名（T14 · 硬门）

**规则**：
- `major_climax.block_id` 覆盖的 block，若 `strategy != null`，对应 prompt shot 必须出现 §Director §A.6 三选一签名元素的中文语义命中（仰拍+头衔 / 慢动作+证据 / 道具光效+节奏突变）；
- `closing_hook.block_id` 覆盖的 block，末 shot prompt 必须含 `freeze_frame` 或 `split_screen` 的中文语义（定格 / 静止画面 / 分屏 / 画面一分为二）。

**自检**：

```jsonc
{
  "climax_signature_check": {
    "major_climax": {
      "applicable": true,
      "strategy": "identity_reveal",
      "shot_idx": 12,
      "hit_elements": ["仰拍","头衔特写","身份名台词重音"],
      "pass": true
    },
    "closing_hook": {
      "applicable": true,
      "shot_idx": 15,
      "hit_elements": ["画面一分为二","分屏"],
      "pass": true
    }
  }
}
```

`strategy == null` 时 `applicable: false, pass: true`（跳过）。

---

## B. output JSON 自检字段合并

在 v5 output 顶层追加以下字段（与 v5 字段并列）：

```jsonc
{
  /* v5 原样 */
  "shots": [ /* ... */ ],
  "global_prefix": "...",
  "global_suffix": "...",
  "forbidden_words_self_check": { /* ... */ },
  "director_code_passthrough_check": { /* ... */ },

  /* v6 新增 · 五铁律自检 */
  "dialogue_fidelity_check":  { /* §A.1 */ },
  "kva_visualization_check":  [ /* §A.2 */ ],
  "kva_coverage_ratio":       1.0,
  "rhythm_density_check":     { /* §A.3 */ },
  "five_stage_check":         [ /* §A.4 */ ],
  "climax_signature_check":   { /* §A.5 */ },

  /* v6 新增 · 段落覆盖总览（L2 / L3） */
  "segment_coverage_overall": {
    "total_segments":              18,
    "consumed_segments":           18,
    "coverage_ratio":              1.0,

    "dialogue_like_total":         7,
    "dialogue_like_consumed":      7,
    "dialogue_like_coverage":      1.0,

    "pass_l2": true,
    "pass_l3": true,
    "missing_segments": []
  }
}
```

**硬门阈值**（pipeline 会校验）：

| 字段 | 阈值 |
|---|---|
| `dialogue_fidelity_check.fidelity_ratio` | == 1.0 |
| `kva_coverage_ratio` | P0 == 1.0 |
| `rhythm_density_check.pass` | true |
| `five_stage_check[].pass` | 全 true |
| `climax_signature_check.major_climax.pass` | true（不适用时跳过） |
| `climax_signature_check.closing_hook.pass` | true |
| `segment_coverage_overall.coverage_ratio` | ≥ 0.90（L2 硬门，v6.0；v6.1 升到 0.95） |
| `segment_coverage_overall.dialogue_like_coverage` | == 1.0（L3 硬门） |

---

## C. 新 payload 消费说明

### C.1 `scriptChunk`（来自 v6 payload builder，见 04 号文档）

```jsonc
{
  "scriptChunk": {
    "block_id": "B01",
    "segments": [ /* 同 Director */ ],
    "key_visual_actions": [ /* 同 Director */ ],
    "structure_hints": [ /* 同 Director */ ]
  }
}
```

Prompter 侧作用：
- 用 `segments[]` 兜底校验 Director 的对白消费（保证没被 Director 悄悄改写）；
- 用 `key_visual_actions[].summary / required_structure_hints[]` 兜底校验 KVA 命中。

### C.2 `rhythmTimelineForBlock`

```jsonc
{
  "rhythmTimelineForBlock": {
    "is_golden_open": true,
    "mini_climax_seq": null,
    "is_major_climax": false,
    "is_closing_hook": false,
    "five_stage": null,
    "major_climax_strategy": null
  }
}
```

Prompter 侧作用：决定是否跳过 §A.4/§A.5 校验；`strategy == null` → §A.5 major_climax 跳过。

### C.3 `styleInference`

作用与 Director 一致（见 Director v6 §C）：Prompter 在措辞层面避免"清洁化 / 哑剧化 / 微表情替代肢体动作"。

---

## D. 与 v5 的兼容性

- 当 payload 未携带 v6 字段（即与旧 pipeline 对接）→ 五条新铁律**自动跳过**，退化为 v5 行为；
- 当 `--allow-v6-soft` 开启 → 五条铁律**降级为 warning**，仍输出自检字段但不拦 pipeline；
- `--rhythm-soft-only` → 铁律 17/18/19 降级 warning；铁律 12/13 仍硬拦；
- `--skip-rhythm-timeline` → `rhythmTimelineForBlock == null`，铁律 18/19 跳过，铁律 17 基于 `shot_meta.info_delta` 仍生效（`max_none_ratio` 默认 0.20）；
- `--skip-kva-hard` → 铁律 13 降级 warning；`kva_visualization_check` 仍必须输出；
- `--skip-style-inference` → Prompter 侧 §C.3 调性指引失效，其他铁律不受影响。

---

## E. 版本演进

| 版本 | 日期 | 状态 | 要点 |
|---|---|---|---|
| v5 | 2026-04-15 | 🟢 稳定 | 四段拆分 + 新硬门 + 竖屏语法 + Director [CODE] 透传 |
| v6.0 | 2026-04-21 | 🟢 正式 | 新增 5 条铁律（12/13/17/18/19）+ 6 个自检字段 + segment_coverage_overall |
| v6.1 | 计划 2026-05-04 | ⏳ | 铁律 14（风格反清洁化）/ 15（微表情去重）/ 16（构图硬锚） |

---

## F. 读者索引

- 对白保真 / beat 硬锚的管道级实现 → `docs/v6/02_v6-对白保真与beat硬锚.md`
- 风格锁定 / 反模板化（v6.1）→ `docs/v6/03_v6-风格锁定与反模板化.md`
- payload builder 与字段注入时机 → `docs/v6/04_v6-并发链路剧本透传.md`
- 节奏模板 / 五段式公式 / 三选一表 → `docs/v6/06_v6-节奏推导与爆点密度.md`
- Director 侧铁律 / shot_meta / appendix 字段 → `2_SD2Director/2_SD2Director-v6.md`
