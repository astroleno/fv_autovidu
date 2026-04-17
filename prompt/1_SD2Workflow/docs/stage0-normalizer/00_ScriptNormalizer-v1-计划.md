# Stage 0 · ScriptNormalizer 前置归一化预处理 · v1 计划

**状态：🔒 LOCKED v1.2（2026-04-17）· 开工期间本 plan 不再改，只补 01-05 配套文件**
**日期：2026-04-17**
**定位：SD2Workflow v5 的 _上游_ 新增层，不改 v5 合同，只做"事实归一化"**
**与 v5 关系：正交升级，v5 的 07_schema 保持冻结；本层产物作为 EditMap 的附加输入**
**与 editmap/ 方法论切片关系：严格正交（见 §5.4）；Stage 0 不干预 `call_editmap_sd2_v5.mjs` 的 editmap/ 静态拼接**
**开工前必读**：§5.5 directorBrief 归属约定（强制） + §六 施工顺序红线 + §十二 本周开工清单 + §十三 仓库分工

**版本日志**：
- v1.0（2026-04-17）初稿
- v1.1（2026-04-17）补 §5.4（与 editmap/ 切片正交性）+ §5.5（directorBrief 归属）+ §十二 开工清单
- 🔒 v1.2（2026-04-17）LOCK：补 §七 分数公式细节、§六 ⑤ EditMap 改动精确措辞、§九 Stage 0 失败兜底、§十一 回归基线 = leji-v5d、附录 A required 矩阵、§十三 仓库分工

---

## 零、输入剧本类型（默认 C · 混合，未覆盖即按此执行）

> 上游输入的 `scriptContent` 按以下三类分模式处理；**默认按 C · 混合推进**，由 §七 代码层启发式规则在运行时自动切换 `mode`。

| 类别 | 特征 | 对 Stage 0 的影响 |
|------|------|-----------------|
| **A · 标准短剧台本** | 规整的「场次号 / 人物名：对白 / (动作)」结构，指代明确 | 规则解析能覆盖 70%+，LLM 只做少量歧义消解，Stage 0 可偏"轻量+确定性" |
| **B · 小说式/散文化剧情稿** | 指代松（"她 / 那女人 / 夫人"混用）、时间表达模糊（"过了一会儿"）、场景切换隐式 | 必须大量依赖 LLM 做指代消解与分段，Stage 0 需要更强的歧义告警与人工复核回路 |
| **C · 混合**（大多数项目的真实情况） | 两种都有，不同剧本差异大 | Stage 0 需要**分模式适配**：规则先行 + LLM 兜底 + 自动检测剧本"松紧度"自适应切换 |

**默认锁定**：C · 混合 + §七 松紧度自适应（P0 能力）。若仅跑标准台本（A）且明确不要兜底，可在开工前把范围压到"轻量模式 only"，预计节省 2 天工作量。

---

## 一、为什么要做（问题根因）

### 1.1 现状问题

读完 `EditMap-SD2 v5` 与整条数据流后，**v5 EditMap 在同一次 LLM 调用里同时承担了以下 7 件事**：

1. 时长拆分预推理（§0 Step 0.1–0.6）
2. 人物指代消解（"她/夫人/总裁"→ bible CHAR_ID）
3. 资产锚定（assetManifest → `present_asset_ids`）
4. 叙事 beat 划分（Hook / Setup / … / Cliff）
5. 路由标签生成（`routing.structural/satisfaction/psychology/…`）
6. 心理学 / 状态曲线 / 信息差账本（v5 新增 meta.*）
7. 付费脚手架（paywall_scaffolding）

→ **负担过重，所以一致性漂移和时间轴误差是必然的**。v2 时期的 `asset_timeline` 本质是这个问题的早期信号。

### 1.2 根因一句话

> **v5 把"事实归一化"和"导演化拆解"塞在同一个模型调用里。LLM 在做算术（时长累加）、做身份识别（角色）、做叙事判断（beat/爽点）三件性质截然不同的事，它们应当被分层。**

### 1.3 Stage 0 要解决 _哪五件事_（克制范围）

**只做、且只做这五件事**（不做"大而全的剧本知识图谱"）：

1. **人物指代统一**：所有出场人物绑定唯一 `CHAR_ID`，合并别名/代词
2. **Beat 切分**：按"可独立标注的最小叙事单元"切分为 `beat_ledger`
3. **双时间轴**：`display_order` vs `story_order` + `screen_time_sec` vs `story_elapsed`
4. **状态账本**：角色 / 道具 / 场景的可追踪状态变化
5. **歧义告警**：任何 Stage 0 无法确定的条目都显式报出来，而不是猜

---

## 二、设计原则

1. **事实归一化 ≠ 导演化拆解**：Stage 0 不回答"怎么拍"，只回答"剧本里到底发生了什么 / 谁参与 / 持续多久"。
2. **不改 v5 合同**（Phase 1 红线）：07_schema 冻结不动，EditMap v5 只是**额外接收**一个 `normalizedScriptPackage`。下游 Director/Prompter 零感知。
3. **LLM + 代码分工**：
   - 时长累加、双时间轴计算 → **纯代码**（确定性，不交给 LLM）
   - 指代消解、beat 语义判断 → **LLM**
   - 角色别名合并 → **Bible alias 表优先，LLM 兜底代词**
4. **歧义优于臆测**：任何不确定都进 `ambiguity_report`，不允许 Stage 0 "编平"歧义。
5. **可审计可回归**：Stage 0 输出必须 JSON-schema 可校验，且能单独回归测试（golden script → 期望 normalizedScriptPackage）。
6. **每份新增文件 ≤ 400 行，box-sizing: border-box 仅限有 CSS 时**（沿用用户规则）。
7. **与 editmap/ 方法论切片严格正交**（v5 架构红线）：Stage 0 不产路由标签、不干预 EditMap system prompt 构建、不试图以「简单判断前置」让 editmap/ 切片改走 `injection_map.yaml` 路由。详细边界见 §5.4；挂载机制见 `prompt/1_SD2Workflow/docs/v5/08_v5-编剧方法论切片.md`。

---

## 三、事实包五类内容 `normalizedScriptPackage`

### 3.1 `character_registry` —— 角色唯一性

**解决**："她 / 夫人 / 母亲 / 总裁"到底是谁；阵营与默认状态。

**字段草案**：

```jsonc
"character_registry": {
  "CHAR_SU": {
    "canonical_name": "苏无名",
    "bible_ref": "CHAR_SU",              // 回指 0_BibleSchema.characters[].id
    "aliases_in_script": ["苏大人","神探","苏兄"],
    "pronoun_bindings": [                // 代词消解的证据链
      { "seg_id": "SEG_003", "token": "他", "confidence": 0.92, "rationale": "前一句主语为苏无名" }
    ],
    "faction": "protagonist",            // protagonist / antagonist / neutral / unknown
    "relations": [
      { "to": "CHAR_LI", "type": "ally", "source": "bible" },
      { "to": "CHAR_WANG", "type": "rival", "source": "script_inferred", "evidence_seg": "SEG_010" }
    ],
    "first_seen_seg": "SEG_001",
    "present_in_segs": ["SEG_001","SEG_003","SEG_007",...],
    "default_state": {                   // 初始出场状态；后续由 state_ledger 驱动变化
      "outfit_tag": "Formal",
      "injury_tag": "None",
      "position_on_status_curve_hint": "mid"   // 仅提示，不是 v5 status_curve 的真值
    }
  }
}
```

### 3.2 `scene_timeline` —— 场次顺序与连续性

**解决**：同一空间是否"连续场"；转场是真转场还是同一场不同机位。

```jsonc
"scene_timeline": [
  {
    "scene_id": "SC_01",
    "scene_run_id": "S1",                // 沿用 v5 scene_run_id 语义
    "place": "苏府书房",
    "time_of_day": "night",
    "is_continuous_from_prev": false,
    "seg_range": ["SEG_001","SEG_012"],
    "cum_screen_start": 0.0,
    "cum_screen_end": 38.4,
    "story_time_start_iso": null,        // 剧情内时间（可选，不要求全填）
    "story_time_mode": "present"         // present / flashback / dream / parallel / ellipsis
  }
]
```

### 3.3 `beat_ledger` —— 叙事单元账本

**解决**：给 EditMap 一份"已经切好的、带 raw_excerpt 和参与方"的最小叙事单元表。EditMap 的职责从"切"变成"聚合 + 导演化标注"。

```jsonc
"beat_ledger": [
  {
    "beat_id": "BT_001",
    "scene_id": "SC_01",
    "raw_excerpt": "苏大人冷冷地说：'你昨夜去哪了？' 李默低头，不答。",
    "segments": ["SEG_001","SEG_002"],   // 可由多个原子 segment 聚合
    "participants": ["CHAR_SU","CHAR_LI"],
    "core_action": {
      "actor": "CHAR_SU",
      "verb": "质问",
      "object": "CHAR_LI",
      "modality": "verbal"               // verbal / physical / internal
    },
    "reaction_subject": "CHAR_LI",
    "mandatory_on_screen": ["CHAR_SU","CHAR_LI"],  // 这一 beat 哪些角色必须出镜
    "dialogue_char_count": 9,
    "action_verb_count": 2,
    "beat_type_hint": "confrontation",   // 仅 hint，最终归类仍由 EditMap 决定
    "ambiguity_flags": []                // 命中歧义则引用 ambiguity_report 的 id
  }
]
```

> **重要边界**：`beat_type_hint` 只给提示，不替 EditMap 决定 `structural_tags` / `routing.structural`。v5 合同不受影响。

### 3.4 `temporal_model` —— 双时间轴（核心创新）

**这是解决"时间轴理解"痛点的命门**。LLM 最容易混淆"剧情里过了多久"和"屏幕上演了多久"，必须显式拆开。

```jsonc
"temporal_model": {
  "episodes_target_screen_sec": 120,
  "episodes_estimated_screen_sec": 118.4,
  "drift_ratio": 0.013,                  // |estimated - target| / target，超过阈值报警
  "beats": [
    {
      "beat_id": "BT_001",
      "display_order": 1,                // 观众看到的顺序
      "story_order":   1,                // 故事真实发生顺序（回忆/倒叙可不同）
      "screen_time_sec": {
        "est":   4.2,                    // 估算值
        "min":   3.5,
        "max":   5.5,
        "breakdown": {                   // 代码层可审计的估算拆解
          "prelude_sec":  0.6,
          "dialogue_sec": 2.1,           // 中文 9 字 / 3.5 字每秒 ≈ 2.57s，取区间
          "action_sec":   1.0,
          "reaction_buffer_sec": 1.5,
          "transition_cost_sec": 0.0
        }
      },
      "story_elapsed_sec": 30,           // 剧情内部流逝（可为 0 / null）
      "time_mode": "present"             // present / flashback / dream / parallel / ellipsis
    },
    {
      "beat_id": "BT_002",
      "display_order": 2,
      "story_order":   0,                // 早于故事起点 → 回忆
      "screen_time_sec": { "est": 6.0, "min": 5.0, "max": 7.0, "breakdown": {...} },
      "story_elapsed_sec": 0,
      "time_mode": "flashback"
    }
  ],
  "block_suggestion": [                  // 建议聚合方案（EditMap 可采纳可重排）
    {
      "block_hint_id": "BH_01",
      "beats": ["BT_001","BT_002"],
      "sum_screen_sec": 10.2,
      "in_4_15s_window": true,
      "scene_continuous": true
    }
  ]
}
```

**时长估算公式（代码层，不交给 LLM）**：

```
prelude_sec       = 0.5 ~ 1.0           // 固定前置
dialogue_sec      = char_count / 3.5    // 中文默认 3.5 字/秒
action_sec        = verb_count * 0.8 + (has_interaction ? 1.0 : 0)
reaction_buffer   = 1.5 ~ 2.0 if 有反应主体 else 0
transition_cost   = 1.0 if 跨场次硬切 else 0
est = prelude + dialogue + action + reaction + transition
min = est * 0.85, max = est * 1.2
然后 snap 到 v5 的 4–15s 桶（由 EditMap 做聚合，不在 Stage 0 snap）
```

### 3.5 `state_ledger` —— 状态账本（v2 `asset_timeline` 的泛化版）

**解决**：谁在第几 beat 换装 / 受伤 / 拿到物件 / 离场 / 环境变乱。

```jsonc
"state_ledger": {
  "character_states": [
    {
      "char_id": "CHAR_SU",
      "transitions": [
        { "from_beat": "BT_000", "to_beat": "BT_005",
          "field": "outfit_tag",
          "old": "Formal", "new": "Casual",
          "evidence_seg": "SEG_007",
          "confidence": 0.9 }
      ]
    }
  ],
  "prop_states": [
    {
      "prop_id": "PROP_POCKET_WATCH",
      "canonical_name": "银色怀表",
      "first_seen_beat": "BT_003",
      "holdings": [
        { "from_beat": "BT_003", "to_beat": "BT_009",
          "holder": "CHAR_SU", "status": "In_Hand" },
        { "from_beat": "BT_010", "to_beat": null,
          "holder": null, "status": "In_Scene", "location_hint": "桌上" }
      ]
    }
  ],
  "scene_states": [
    {
      "scene_id": "SC_02",
      "chaos_transitions": [
        { "at_beat": "BT_012", "from": "Orderly", "to": "Messy",
          "evidence_seg": "SEG_020" }
      ]
    }
  ]
}
```

### 3.6 `ambiguity_report` —— 歧义告警（配角）

**设计哲学**：Stage 0 只要有一点不确定，就不要编，全部吐到这里。

```jsonc
"ambiguity_report": [
  {
    "id": "AMB_001",
    "type": "pronoun_resolution",
    "seg_id": "SEG_015",
    "detail": "「她低头不语」，上下文同时有 CHAR_LI 与 CHAR_WANG 为女性候选",
    "candidates": ["CHAR_LI","CHAR_WANG"],
    "picked": "CHAR_LI",
    "confidence": 0.55,
    "suggest_human_review": true
  },
  {
    "id": "AMB_002",
    "type": "time_mode_uncertain",
    "beat_id": "BT_007",
    "detail": "「那一年，她还小」疑似 flashback，但无明确时间锚点",
    "picked": "flashback",
    "confidence": 0.7,
    "suggest_human_review": false
  }
]
```

---

## 四、双时间轴建模详解（单独一节，因为这是痛点的命门）

### 4.1 为什么要双轴

LLM 常把这三种时间搅在一起：

| 时间概念 | 现象 | 错误例子 |
|----------|------|---------|
| **屏幕时长** | 这一段在成片里占几秒 | LLM 估"主角哭了三年"→ 10s ❌（屏幕只演 3s） |
| **剧情内时间** | 故事世界里过了多久 | LLM 估"吃饭场景" → 1 小时 ❌（屏幕只 5s） |
| **叙事顺序** | 观众看到的顺序 vs 故事真实顺序 | 回忆 / 梦境 / 平行叙事错标为当前时间 ❌ |

### 4.2 双轴的正交性

```
                story_order  →  1  2  3  4  5  6
                display_order → 3  1  2  5  4  6    (观众看到的顺序)

                time_mode:     flashback  present  present  dream  present  present
                screen_time:   6s         4s       5s       3s     5s       6s
                story_elapsed: 0          5s       30s      0      2min     5s
```

这样 EditMap 拿到的是"已经正交展开"的时间，不用自己在 prompt 里推理"这段是回忆吗、那屏幕时长就是屏幕时长不是故事时长哦"。

### 4.3 与 v5 现有 `block_index.duration` 的关系

- `beat_ledger[].screen_time_sec.est` **累加** → EditMap 聚合后 → `block_index[i].duration`
- v5 §0 的 "时长拆分预推理"职责从"让 LLM 数字数"降级为"校验 Stage 0 给的估算是否合理 + 做 4–15s snap"
- **合同不动**：`block_index[i].duration` 字段、单位、范围完全不变
- **新增可选链接字段**（放在 EditMap 输出 meta 里，不改 07_schema 硬字段）：
  `meta.normalizer_ref = { package_id, beat_id_to_block_map }` → 让后期审计可以追溯

---

## 五、合同影响面 · 与 v5 的严格隔离

| 维度 | v5 现状 | Stage 0 Phase 1 | Stage 0 Phase 2（可选） |
|------|---------|---------------|---------------------|
| EditMap 输入 | scriptContent + assetManifest + episodeDuration | **追加** normalizedScriptPackage | 同 Phase 1 |
| EditMap 输出 schema | 07_schema 冻结 | **完全不变** | 可选：把 state_ledger 升格为 entity_state_ledger |
| **EditMap system prompt**（`editmap/` 编剧方法论切片 × 6） | 由 `call_editmap_sd2_v5.mjs` 静态拼接（见 `docs/v5/08_v5-编剧方法论切片.md`） | **完全不变**（Stage 0 与 editmap/ 切片严格正交） | **仍完全不变**（editmap/ 永不进 injection_map，见 §5.4） |
| Director / Prompter | 不感知 Stage 0 | **不感知** | 可选：读取 character_registry 做指代校验 |
| injection_map.yaml | v2.0 | **不变** | 可选：追加 Stage0 触发条件 |
| CI 挡板 | H1–H5 | **不变** | Phase 2 可新增 H6 `normalizer_package_valid`（软门）|

**Phase 1 = 只加不改**。任何下游消费者若不读 `normalizedScriptPackage`，行为与今天完全一致。

### 5.4 Stage 0 与 editmap/ 切片的正交性（重要边界）

> **核心结论：Stage 0 不会、不应、也永远不试图替代 editmap/ 切片的「方法论静态挂载」机制。**

| 维度 | Stage 0（ScriptNormalizer） | `editmap/` 切片（编剧方法论） |
|------|---------------------------|------------------------------|
| 回答的问题 | 剧本里**发生了什么**（事实层） | 怎么从发生的事里**提炼叙事结构**（方法论层） |
| 产物性质 | 数据（`normalizedScriptPackage`） | system prompt 常量（编剧认知框架） |
| 消费路径 | 作为 EditMap 的**输入数据**合流 | 由 `call_editmap_sd2_v5.mjs` 在构建 system prompt 时**静态拼接** |
| 是否走 injection_map | 否（Stage 0 不产路由标签） | 否（EditMap 本身是路由器，不能被自己路由） |
| Phase 1 是否能减少 editmap/ 切片加载量 | **否** | — |
| Phase 2 是否能让 editmap/ 走 routing | **否**（架构红线） | — |

**为什么即便 Stage 0 做了「简单判断前置」（如 `time_mode / tightness_score`）也不能让 editmap/ 切片变成 routing 加载**：

1. editmap/ 切片内容是**元认知框架**（「什么是戏剧动作」「什么是 Show Don't Tell」），不是「已知事实」的描述；
2. EditMap 要做的 routing 判断（`routing.satisfaction / structural / psychology`）**以 editmap/ 切片的信号映射表为依据**——任何让 editmap/ 走 routing 的方案，都会形成「要识别才能加载，要加载才能识别」的死循环；
3. 即使 Stage 0 前置给出 `genre_hint = "mystery"`，也仍然**需要** `proof_and_info_gap.md` 完整在视野里（悬疑剧对 `proof_ladder.retracted` 的处理规则就在这份切片），不能被 routing 掉。

**Phase 1 协同落地方式**：

- Stage 0 产出 `beat_ledger` → EditMap 读入后**可以直接聚合成 block**，不再在 LLM 里做「切 beat」这件事；
- editmap/ 切片提供「这些 beat 该怎么聚合 + 怎么打 routing 标签」的方法论；
- **两者在 EditMap 里汇合**：Stage 0 的输出进 `user message`（作为数据），editmap/ 切片进 `system message`（作为方法论）——各走各的通道，永不交叉。

详细挂载机制见 `prompt/1_SD2Workflow/docs/v5/08_v5-编剧方法论切片.md`。

### 5.5 directorBrief 归属约定（Phase 1 强制 · 不可协商）

> **核心结论：`directorBrief` 主解析入口保留在 EditMap（维持 v5 §输入来源现状），Stage 0 只允许"旁读"其中的剧本元信息白名单。**

**判定原则**：`directorBrief` 本质是「导演意图」，而 Stage 0 的设计红线是「事实归一化 ≠ 导演化拆解」（§二.1）。把 brief 主解析下沉到 Stage 0 会同时违反三条红线——§二.1 职责定义、§五 Phase 1 合同隔离、§5.4 与 editmap/ 切片的正交性。

**directorBrief 字段归属对照表**：

| directorBrief 字段 | 性质 | 归属层 | 产出路径 |
|---|---|---|---|
| `aspectRatio`（9:16 / 16:9） | 导演意图 · 视觉 | **EditMap**（现状不变） | `meta.video.aspect_ratio` |
| `renderingStyle` / `artStyle` / 色调 | 导演意图 · 视觉 | **EditMap**（现状不变） | `meta.parsed_brief.*` |
| 爽点偏好 / paywallPreference | 导演意图 · 叙事策略 | **EditMap**（现状不变） | `meta.paywall_scaffolding.*` |
| `shotHint` / 镜头级暗示 | 导演意图 · 拍摄 | **EditMap**（现状不变） | `block_index[i].routing.shot_hint` |
| `genre`（悬疑 / 情感 / 电商 / 长剧） | **剧本元信息** | **EditMap 主解析 + Stage 0 旁读** | EditMap 写 `meta.video.genre_hint`；Stage 0 读作 §七 题材先验 |
| `scriptTypeHint`（A / B / C / auto） | **剧本元信息** | **Stage 0 可直接 override `mode`** | 跳过 §七 启发式检测，直接落到 `mode` |

**Stage 0 读取规则（白名单，其他字段一律忽略）**：

```
允许读取：directorBrief.genre
          directorBrief.scriptTypeHint
禁止读取：directorBrief.aspectRatio
          directorBrief.renderingStyle
          directorBrief.paywallPreference
          directorBrief.shotHint
          以及未列入白名单的任何其他字段
```

**pipeline 协作约定**（落到 `scripts/sd2_pipeline/call_script_normalizer.mjs` —— Phase 1 新建）：

1. Stage 0 的输入由 pipeline 层**单独组装**：`{ scriptContent, assetManifest, episodeDuration, briefWhitelist: { genre?, scriptTypeHint? } }`；
2. **不得**把 EditMap 的 `meta.parsed_brief` 反向回灌给 Stage 0（防止形成"EditMap→Stage 0"反向依赖）；
3. `briefWhitelist` 为空时，Stage 0 行为退化为纯启发式（§七 全量生效），不得报错。

**Schema 层强制**：`normalizedScriptPackage.schema.json` 的 `input_echo` 段必须只记录上述白名单字段，CI 可扫描 schema 防止越界。

---

## 六、分两步落地

### Phase 1 · 只加不改（建议 1 周，低风险）

**目标**：Stage 0 产出 `normalizedScriptPackage`，EditMap v5 多吃一个输入字段，其余一切不动。

**施工顺序红线（不可颠倒 · 违反必返工）**：

```
① Schema 冻结（合同先锁）
   ↓
② 代码引擎（duration + timeline 确定性部分先锁）
   ↓
③ Prompt 骨架（只承担 LLM 能做的 5 件事，先占位不定稿）
   ↓
④ Golden × 3（用真实剧本反推 Prompt 需要补什么）
   ↓
⑤ Prompt 定稿 + 回归对齐（EditMap 吃附加输入，对比 v4 基线 drift_ratio）
```

**为什么不能"先写 Prompt 再对齐"**：Prompt 里如果承担了时长累加，LLM 每次会漂一点，没有代码锚校准就只能反复改 Prompt——等同于回到 v5 EditMap "一个调用做 7 件事"的老问题（§一.1）。**时长/时间轴必须代码先行，Prompt 只做 LLM 擅长的语义判断**。

**交付物（按施工顺序排列 · 仓库分工见 §十三）**：

| 顺序 | 交付物 | 仓库 | 路径 | 内容 |
|------|-------|------|------|------|
| ① | `01_schema.json` | `feeling_video_prompt` | `prompt/1_SD2Workflow/docs/stage0-normalizer/01_schema.json` | `normalizedScriptPackage` 完整 JSON Schema，按附录 A 展开 |
| ② | `02_duration_engine_spec.md` | `feeling_video_prompt` | `prompt/1_SD2Workflow/docs/stage0-normalizer/02_duration_engine_spec.md` | 时长引擎公式、参数表、边界 case |
| ② | `normalizer_duration_engine.mjs` | `fv_autovidu` | `scripts/sd2_pipeline/stage0/` | 纯代码时长引擎（字数/动词/反应缓冲 → est / min / max） |
| ② | `normalizer_timeline_engine.mjs` | `fv_autovidu` | `scripts/sd2_pipeline/stage0/` | 双时间轴累加与 `drift_ratio` 计算 |
| ② | `call_script_normalizer.mjs` | `fv_autovidu` | `scripts/sd2_pipeline/` | pipeline 调度层（brief 白名单注入、mode 切换、产物落盘） |
| ③ | `ScriptNormalizer-v1.md`（骨架） | `feeling_video_prompt` | `prompt/1_SD2Workflow/0_ScriptNormalizer/` | LLM 端指令骨架，只列 I/O 契约与"5 件事"边界，不写推理细节 |
| ③ | `03_ambiguity_rubric.md` | `feeling_video_prompt` | `prompt/1_SD2Workflow/docs/stage0-normalizer/` | 哪些情况必须进 `ambiguity_report` 的清单 |
| ④ | Golden × 3 | `feeling_video_prompt` | `prompt/1_SD2Workflow/docs/stage0-normalizer/04_golden_samples/` | 标准台本 / 小说稿 / 混合稿 各 1，含期望输出 |
| ⑤ | `ScriptNormalizer-v1.md`（定稿） | `feeling_video_prompt` | 同上 | 吸收 Golden 回归结果后的正式版 |
| ⑤ | **EditMap v5 prompt 最小改动** | `feeling_video_prompt` | `1_EditMap-SD2/1_EditMap-SD2-v5.md §0 输入来源` | 见下方"⑤ EditMap 改动精确措辞"，整段追加 |

**⑤ EditMap 改动精确措辞（整段追加，不删不改既有内容）**：

在 `1_EditMap-SD2-v5.md` 的 `§0 输入来源` 小节末尾追加一个子小节：

```markdown
### 0.X（新增）Stage 0 附加输入 · normalizedScriptPackage（可选）

**何时触发**：pipeline 检测到 user message 中含 `normalizedScriptPackage` 对象时启用，否则按原逻辑执行（向后兼容）。

**如何使用**：
- `normalizedScriptPackage.beat_ledger[]` 作为 block 切分的**推荐切点**，但不是硬约束——`beat_type_hint` 只是提示，最终 `block_index[]` 切分以你（EditMap）的方法论判断为准（详见下方 editmap/ 方法论切片）。
- `normalizedScriptPackage.character_registry` 作为人物指代消解的**真值**，直接使用其 `CHAR_ID` 与 `canonical_name`，不再在 `scriptContent` 上重新做消代解。
- `normalizedScriptPackage.temporal_model.beats[].screen_time_sec` 作为时长估算的**基线**，你只需做 4-15s 聚合与微调，不再做字符数累加。
- `normalizedScriptPackage.state_ledger` 作为 `present_asset_ids` / 道具持有关系的**检索表**。

**冲突仲裁原则**：
- `scriptContent` 原文 vs `normalizedScriptPackage` 产物：**原文为准**（Stage 0 是参考，不是真值）。
- `normalizedScriptPackage.ambiguity_report[]` 中 `suggest_human_review=true` 的条目：视为"未消解"，回退到原文推理。

**追溯登记**：若采用了 `normalizedScriptPackage`，在 `meta.normalizer_ref = { package_id, beat_id_to_block_map }` 登记（软字段，07_schema 无此硬字段）。
```

> **注意**：以上追加内容**不引用** editmap/ 方法论切片中的任何判定规则，与 editmap/ 静态挂载路径完全正交（见 §5.4）。

**红线（Phase 1 禁止做的事）**：

- ❌ 改 07_schema
- ❌ 改 injection_map
- ❌ 改 Director / Prompter 任何 prompt
- ❌ 改 editmap/ 6 份切片（Stage 0 与 editmap/ 严格正交，见 §5.4）
- ❌ 在 Stage 0 里做"导演化判断"（镜头 / 运镜 / 光影）
- ❌ 在 Stage 0 里输出 routing 标签
- ❌ 让 LLM 做时长累加（必须代码）
- ❌ 颠倒施工顺序：在 Schema + 引擎确定前先把 Prompt 定稿

### Phase 2 · 正式升格（v5.2 或 v6，看 Phase 1 灰度结果）

**目标**：将验证通过的字段升级为一等公民。

| 候选升格项 | 动作 |
|-----------|------|
| `character_registry` | 升格为 `meta.character_registry`（硬字段），Director 可直取 |
| `state_ledger` | 泛化 v2 `asset_timeline` 为 `entity_state_ledger`，ScriptSupervisor 直接消费 |
| `temporal_model.beats[].time_mode` | 纳入 07_schema 的 `meta.time_modes[]` 软字段 |
| `ambiguity_report` | CI 挡板新增 `ambiguity_severity_gate`（高置信度歧义阻塞产出） |

Phase 2 前置条件：Phase 1 至少跑过 10 部剧本、3 个题材回归，漂移指标稳定。

---

## 七、剧本松紧度自适应（针对 §零的 C · 混合场景）

**启发式检测规则（代码层 · 分母/分子口径固化）**：

```
输入：scriptContent（string）
预处理：按 /\n\s*\n/ 分段 → sections[]；按 /\n/ 分行 → lines[]

规则                                           分子                                                分母            阈值
--------------------------------------------   -------------------------------------------        -----------    ----
R+1 场次标题显式（≥ 80% 段落）                 match(/(场[一二三四五六七八九十\d]+|SC_\d+|第\d+场)/).length   sections.length    ≥ 0.80
R+2 「角色名：对白」模式（≥ 60% 对白行）        match(/^\s*[^\s：]{1,8}[：:]\s*\S/m).length       对白候选行数    ≥ 0.60
R+3 动作括号标注（≥ 30% 动作）                 match(/\(.+?\)/).length                            动作候选行数    ≥ 0.30
R-1 代词密度 ≥ 0.4                              match(/(他|她|它|他们|她们|那人|那女人|那男人)/).length   全文人称词总数   ≥ 0.40
R-2 时间模糊表达 ≥ 3 处                         match(/(过了一会儿|良久|很久以后|没多久|忽然间)/).length   —（绝对值）    ≥ 3
R-3 场景切换自然语言暗示                         sections.length - R+1 命中数                       sections.length    ≥ 0.40

计算：tightness_score = Σ(命中的 ±1)，范围 [-3, +3]

对白候选行数 = lines 中含 [：:] 且前缀不含标点 / 数字的行数
动作候选行数 = lines.length - 对白候选行数 - 空行数
```

- `tightness_score ≥ 2` → `mode = "lightweight"`：规则解析器 70% + LLM 兜底
- `0 ≤ score ≤ 1` → `mode = "standard"`（默认）
- `score < 0` → `mode = "heavy"`：LLM 为主，强制每 beat 生成 ambiguity 复查

**若 `directorBrief.scriptTypeHint ∈ {A, B, C}`（见 §5.5 白名单）**：优先 override 启发式，映射为 `A → lightweight / B → heavy / C → standard`；`auto` 或缺省时走启发式。

**这一项建议作为 Phase 1 的 P0 能力**，否则对小说稿会表现崩塌。

---

## 八、替代方案与取舍

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A · 本计划（Stage 0 前置层）** | 可审计、不破坏 v5、双轴解决核心痛点 | 多一次 LLM 调用、多一个产物维护 | ✅ 推荐 |
| B · 轻量：只在 EditMap prompt 里加"先内部归一化"步骤 | 0 新文件、最快 | 不可审计、漂移依旧、加重 EditMap 负担 | ❌ 不推荐 |
| C · 混合：规则解析器 + LLM 消歧，不分层产物 | 工程感最强 | 前期工程成本高、调试面大 | ⚠️ 长期方向，但不是第一步 |

> **本计划 = A，但内部引擎偏向 C**（时长/时间轴靠代码，指代/beat 靠 LLM）。

---

## 九、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Stage 0 的 LLM 对小说稿指代消解仍不准 | `character_registry` 污染下游 | 必须走 `ambiguity_report` 显式告警 + 剧本松紧度检测 → 重型模式强制每 beat 复查 |
| 时长引擎对"留白/长镜头"估偏低 | `drift_ratio` > 10% | 引擎暴露参数（字/秒系数、留白加成），golden sample 回归校准；EditMap 端保留 override 权利 |
| Stage 0 + EditMap 双 LLM 调用增加成本 | Token 成本 ~+30% | 仅对高价值项目启用；或在 Phase 2 把 Stage 0 的部分推理迁到代码 |
| 与 v2 `asset_timeline` 语义重叠 | 两个账本并存 | Phase 2 正式合并为 `entity_state_ledger`；Phase 1 期间 v2 账本继续存在，Stage 0 产物仅作参考 |
| Bible alias 表不全 | 别名合并失败 | Stage 0 输出 `character_registry[*].aliases_in_script` 回写建议给 Bible 维护者 |
| **Stage 0 调用失败（LLM 超时 / schema 校验失败 / ajv 报错）** | **EditMap 拿不到 normalizedScriptPackage** | **pipeline 层（`call_script_normalizer.mjs`）捕获异常后**：①记录 `stage0_status = "failed"` + 失败原因到 pipeline 日志；②**不阻塞 EditMap 调用**，直接跳过 Stage 0 附加输入；③EditMap 按既有 v5 行为执行（等价于 Phase 1 未启用 Stage 0 时的基线）。这是 Phase 1 "只加不改" 红线的必然要求。 |
| Schema 升级（v1.0 → v1.x）向后不兼容 | 已有产物无法被新版消费 | `normalizer_version` 硬字段常量化（附录 A）；EditMap 只读 v1.x 系列，主版本跳跃（v2）必须在 v5.2+ 独立 PR |

---

## 十、决策点与默认值（已锁 · 覆盖前按此执行）

> **用法**：所有决策点已按"推荐默认值"锁定，**未覆盖即按默认开工**。开工前若要覆盖任何一项，在对应行的"覆盖记录"列标注姓名/日期/结论即可。标注 🔴 的 3 项是"若要变更必须在 Schema 冻结前完成"——动它们要返工。

| # | 决策点 | 🔒 默认值（生效） | 备选 | 影响面 | 覆盖截止 | 覆盖记录 |
|---|--------|----------------|------|-------|---------|---------|
| 🔴 D1 | 输入剧本类型（§零） | **C · 混合** | A 标准 / B 小说 | §七 是否启用、`mode` 枚举是否全量 | Schema 冻结前 | — |
| 🔴 D2 | Phase 1 是否包含 §七剧本松紧度自适应 | **是（P0）** | 否（仅标准模式，工作量 -2 天） | `01_schema.json` 的 `mode` 字段、`tightness_score` 字段 | Schema 冻结前 | — |
| D3 | `temporal_model.beats[].time_mode` 必填/可选 | **可选**（不确定时 `present`） | 必填（不确定进 `ambiguity_report`） | Schema required 数组 | 引擎开工前 | — |
| D4 | `state_ledger` 范围 | **全量**（人物 + 道具 + 场景） | 仅人物（最小可行） | Schema 复杂度、引擎实现量 | 引擎开工前 | — |
| 🔴 D5 | EditMap 如何消费 Stage 0 产物 | **作为参考**，原文与产物冲突时以原文为准 | 视为真值（EditMap 不得翻案） | EditMap prompt 钩子措辞、是否需要 CI 挡板 | Schema 冻结前 | — |
| D6 | 时长引擎的"中文字/秒"基准 | **3.5 字/秒** | 3.0（偏慢）/ 4.0（偏快） | `duration_engine` 参数默认值（可在 runtime override） | 引擎开工前 | — |
| D7 | Stage 0 是否提取 `shot_hint` 视觉母题 | **否**（坚守"不做导演化"） | 是（违反 §二设计原则） | 触发返工：违反架构红线 | 永不开放 | — |
| D8 | Phase 2 升格范围（§六） | **character_registry + state_ledger** | 仅 character_registry | Phase 2 范围（不影响 Phase 1） | Phase 1 灰度结束前 | — |

**硬性边界**：D7 无论何时都保持"否"，覆盖即触发 §二 设计原则重评审，不在本计划范围内。

---

## 十一、交付时间线（与 §六 施工顺序一一对应）

| 顺序 | 阶段 | 工作量 | 产出 | 前置 | 完成标志 |
|-----|------|--------|------|------|---------|
| ① | Schema 冻结 | 0.5 天 | `01_schema.json`（完整） | D1/D2/D5 未覆盖 = 采用默认值 | schema 本地 `ajv` 校验 3 份手写样例通过 |
| ② | 代码引擎 | 2 天 | `normalizer_duration_engine.mjs` + `normalizer_timeline_engine.mjs` + `call_script_normalizer.mjs` + `02_duration_engine_spec.md` | Schema 冻结 | 纯代码单元测试覆盖率 ≥ 80%，`drift_ratio` 对手写样例 ≤ 5% |
| ③ | Prompt 骨架 | 1 天 | `ScriptNormalizer-v1.md`（骨架版） + `03_ambiguity_rubric.md` | 引擎 | I/O 契约对齐 Schema；Prompt 不含任何时长累加指令 |
| ④ | Golden × 3 | 1.5 天 | `04_golden_samples/` 下标准/小说/混合各 1 份 + 期望输出 JSON | Prompt 骨架 | 3 份样例均能跑通端到端（允许 `ambiguity_report` 非空） |
| ⑤ | Prompt 定稿 + 回归 | 1 天 | Prompt 定稿 + EditMap v5 `§0 输入来源` 整段追加（见 §六 ⑤）+ 回归报告 | Golden | **对比基线 = `leji-v5d`**（editmap/ 切片升级后 v5.0 GA 首版，见 `docs/v5/06_v5-验收清单与回归基线.md §十一`）：`block_index[].duration` 误差 ≤ 基线 5%、`drift_ratio` ≤ 10%、D1–D8 指标不回退 |
| — | Phase 1 GA | — | Stage 0 可选开关（默认关闭），白名单灰度 2 周 | 回归通过 | 灰度期 `ambiguity_report` 高置信度歧义率 < 10% |
| — | Phase 2 | +3 天（独立 PR） | 升格 schema + injection_map 追加 | Phase 1 灰度 2 周稳定 | 按 §六 Phase 2 升格表执行 |

**总工作量**：Phase 1 ≈ 6 天（不含灰度）。若覆盖 D2=否（不做松紧度自适应），压缩到 ≈ 4 天。

---

## 十二、本周开工清单（最小可启动集）

> 不需要等所有决策拍板，下面 4 步按默认值即可今天启动，拍板后再微调参数。

### 步骤 0：Lock 本 plan（5 分钟 · 必须先做）

- [x] 标题状态 → 🔒 LOCKED v1.2（已完成）
- [ ] 开工期间本文件**只追加"版本日志"行**，不改正文；需要修改时另开 v1.3 增量文档
- [ ] 本 plan 的变更若影响 D1 / D2 / D5 三项 🔴 决策 → 返工触发条件（Schema 需重冻结）

### 步骤 1：冻结 Schema 骨架（今天 · 0.5 天）

- [ ] 按附录 A 展开，在 `prompt/1_SD2Workflow/docs/stage0-normalizer/` 下新建 `01_schema.json`
- [ ] 顶层 required 字段按默认值锁定：`package_id / source_script_hash / character_registry / scene_timeline / beat_ledger / temporal_model / state_ledger`
- [ ] `state_ledger` 含 `character_states / prop_states / scene_states` 三段（D4 默认全量）
- [ ] `mode` 枚举 = `["lightweight","standard","heavy"]`（D2 默认带松紧度）
- [ ] `input_echo.brief_whitelist` 只允许 `genre / scriptTypeHint` 两个字段（§5.5 强制）
- [ ] 本地用 `ajv` 校验 3 份手写 minimal / typical / stress 样例通过

### 步骤 2：锁定引擎参数文档（今天 · 0.5 天）

- [ ] 新建 `02_duration_engine_spec.md`，把 §3.4 的公式搬出来并列参数表：
  - `chinese_chars_per_sec = 3.5`（D6 默认）
  - `prelude_sec_min = 0.5`、`prelude_sec_max = 1.0`
  - `reaction_buffer_sec_min = 1.5`、`reaction_buffer_sec_max = 2.0`
  - `min_ratio = 0.85`、`max_ratio = 1.2`（est → min/max）
  - `drift_alert_threshold = 0.1`（触发告警）
- [ ] 列一张"已知偏差场景表"：长镜头留白 / 纯动作戏 / 多人台词抢话——后续 golden 回归时对齐

### 步骤 3：占位 Prompt 骨架（本周 · 0.5 天，**不定稿**）

- [ ] 在 `prompt/1_SD2Workflow/0_ScriptNormalizer/` 下新建 `ScriptNormalizer-v1.md`（骨架）
- [ ] 只写 3 段：
  - `## 输入契约`：照搬 §5.5 白名单
  - `## 输出契约`：指向 `01_schema.json`
  - `## 职责边界（5 件事）`：照搬 §一.3
- [ ] **禁止写入**：时长计算指令、beat 切分具体规则、routing 标签——这些由引擎或 Golden 回归后再补
- [ ] 文件头加"WIP · 待 Golden 回归后定稿"标签

### 步骤 4：在 EditMap v5 预留 brief 白名单读取点（本周 · 0.25 天）

> 这步只动 pipeline 侧（`scripts/sd2_pipeline/call_editmap_sd2_v5.mjs`），EditMap prompt 一字不改。

- [ ] pipeline 层组装 Stage 0 输入时，从 `directorBrief` 提取白名单字段：
  ```js
  const briefWhitelist = {
    genre: directorBrief?.genre,
    scriptTypeHint: directorBrief?.scriptTypeHint
  };
  ```
- [ ] 禁止把 `meta.parsed_brief` 反向回灌给 Stage 0（§5.5 强制）

### 开工前需要的 3 个确认（若默认值全接受可跳过）

只有下面 3 项**在 Schema 冻结后变更需要返工**，其他 5 项开工后仍可覆盖：

1. 🔴 D1 输入剧本类型（默认 C · 混合）——你们的实际输入是 A / B / C？
2. 🔴 D2 是否带 §七 松紧度自适应（默认 是）——要不要压到 4 天范围？
3. 🔴 D5 EditMap 如何消费 Stage 0 产物（默认 作为参考）——是否改为"真值"？

以上 3 项都按默认就行？那就今天可以从步骤 1 开工。

---

## 十三、仓库分工（开工前必读）

本 plan 的交付物跨两个仓库，按职责拆分如下——**严禁混放**：

| 仓库 | 内容 | 典型产物 |
|------|------|---------|
| **`feeling_video_prompt`**（本仓库） | **提示词 + 合同 + 规范 + schema + golden** | 本 plan、`01_schema.json`、`02_duration_engine_spec.md`、`03_ambiguity_rubric.md`、`ScriptNormalizer-v1.md`、`04_golden_samples/`、EditMap v5 prompt 改动 |
| **`fv_autovidu`**（胶水代码仓库） | **pipeline 调度代码 + 引擎实现** | `call_script_normalizer.mjs`、`normalizer_duration_engine.mjs`、`normalizer_timeline_engine.mjs`、CI 脚本、ajv 校验代码 |

**同步流程**（与 editmap/ 切片的两库同步惯例一致）：
1. `feeling_video_prompt` 先完成步骤 1-4（Schema / 引擎规格 / Prompt 骨架 / Golden）；
2. 同步到 `fv_autovidu`，由胶水代码消费（引擎实现 / pipeline 接入）；
3. Golden 回归在 `fv_autovidu` 跑，回归报告写回 `feeling_video_prompt/prompt/1_SD2Workflow/docs/stage0-normalizer/05_regression_report.md`；
4. Prompt 定稿在 `feeling_video_prompt`，再次同步到 `fv_autovidu`。

**红线**：`feeling_video_prompt` 不应出现 `.mjs` 引擎实现；`fv_autovidu` 不应出现 Prompt `.md` 主文件（只允许同步副本用于胶水代码 `fs.readFileSync`）。

---

## 附录 A · `normalizedScriptPackage` JSON Schema 草案（精简版）

> 完整 schema 在 Phase 1 开工时单独建文件（`prompt/1_SD2Workflow/docs/stage0-normalizer/01_schema.json`），本处列顶层骨架 + **子字段 required 矩阵**用于 Schema 冻结时对照。

### A.1 顶层骨架



```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "normalizedScriptPackage",
  "type": "object",
  "required": [
    "package_id", "source_script_hash", "input_echo",
    "character_registry", "scene_timeline",
    "beat_ledger", "temporal_model", "state_ledger"
  ],
  "properties": {
    "package_id":         { "type": "string", "pattern": "^NSP_[A-Za-z0-9_]+$" },
    "source_script_hash": { "type": "string" },
    "tightness_score":    { "type": "integer", "minimum": -3, "maximum": 3 },
    "mode":               { "enum": ["lightweight","standard","heavy"] },

    "input_echo": {                      // §5.5 强制：仅记录 brief 白名单字段
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "brief_whitelist": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "genre":          { "type": "string" },
            "scriptTypeHint": { "enum": ["A","B","C","auto"] }
          }
        },
        "episode_duration_sec": { "type": "number" }
      }
    },

    "character_registry": { "type": "object", "additionalProperties": { /* §3.1 */ } },
    "scene_timeline":     { "type": "array",  "items":                { /* §3.2 */ } },
    "beat_ledger":        { "type": "array",  "items":                { /* §3.3 */ } },
    "temporal_model":     { "type": "object",                         /* §3.4 */  },
    "state_ledger":       { "type": "object",                         /* §3.5 */  },
    "ambiguity_report":   { "type": "array",  "items":                { /* §3.6 */ } },

    "meta": {
      "generated_at": { "type": "string", "format": "date-time" },
      "normalizer_version": { "const": "v1.0" },
      "bible_ref":   { "type": "string" }
    }
  }
}
```

### A.2 子字段 required 矩阵（Schema 冻结前必须对齐）

| 父字段 | 子字段 | 类型 | 是否 required | 备注 |
|--------|--------|------|-------------|------|
| `character_registry.*` | `canonical_name` | string | ✅ | 全片一致 |
| `character_registry.*` | `bible_ref` | string | ✅ | 空值允许（新角色未入 Bible） |
| `character_registry.*` | `aliases_in_script` | string[] | ✅ | 允许 `[]` |
| `character_registry.*` | `pronoun_bindings` | object[] | ⚠️ 条件 | 仅 `mode != lightweight` 时必填 |
| `character_registry.*` | `faction` | enum | ✅ | `protagonist / antagonist / neutral / unknown` |
| `character_registry.*` | `first_seen_seg` | string | ✅ | |
| `character_registry.*` | `present_in_segs` | string[] | ✅ | 允许 `[]` |
| `character_registry.*` | `default_state` | object | ⚠️ 可选 | 缺省由 EditMap 推断 |
| `scene_timeline[]` | `scene_id / scene_run_id / place / seg_range / cum_screen_start / cum_screen_end` | — | ✅ | |
| `scene_timeline[]` | `time_of_day / is_continuous_from_prev / story_time_mode` | — | ✅ | |
| `scene_timeline[]` | `story_time_start_iso` | string\|null | ⚠️ 可选 | |
| `beat_ledger[]` | `beat_id / scene_id / raw_excerpt / segments / participants / core_action / dialogue_char_count / action_verb_count` | — | ✅ | `dialogue_char_count` / `action_verb_count` 驱动 duration_engine |
| `beat_ledger[]` | `reaction_subject / mandatory_on_screen / beat_type_hint / ambiguity_flags` | — | ⚠️ 可选 | |
| `beat_ledger[].core_action` | `actor / verb / object / modality` | — | ✅ | `modality ∈ {verbal, physical, internal}` |
| `temporal_model` | `episodes_target_screen_sec / episodes_estimated_screen_sec / drift_ratio / beats / block_suggestion` | — | ✅ | |
| `temporal_model.beats[]` | `beat_id / display_order / story_order / screen_time_sec` | — | ✅ | |
| `temporal_model.beats[]` | `story_elapsed_sec` | number\|null | ⚠️ 可选 | |
| `temporal_model.beats[]` | `time_mode` | enum | ⚠️ 可选（默认 `present`，见 D3） | |
| `temporal_model.beats[].screen_time_sec` | `est / min / max / breakdown` | — | ✅ | `breakdown` 为代码可审计字段 |
| `state_ledger` | `character_states / prop_states / scene_states` | — | ✅（D4 全量） | 允许各自 `[]` |
| `ambiguity_report[]` | `id / type / detail / picked / confidence` | — | ✅ | |
| `ambiguity_report[]` | `seg_id / beat_id / candidates / suggest_human_review` | — | ⚠️ 条件 | 至少提供 `seg_id` 或 `beat_id` 之一 |
| 顶层 | `tightness_score` | integer | ⚠️ 条件 | `mode != lightweight_override` 时必填 |
| 顶层 | `mode` | enum | ✅ | `lightweight / standard / heavy`（D2 默认带 3 值） |

**Schema 冻结判定**：`ajv` 对下列 3 份手写样例全部通过方可冻结：
- `minimal.json`：单场、2 角色、3 beat、0 歧义
- `typical.json`：3 场、5 角色、12 beat、带 flashback 1 处、1 条 `suggest_human_review`
- `stress.json`：小说稿风格、代词密度 > 0.5、10+ beat、多条 `ambiguity_report`

---

## 下一步

**已进入可落地阶段**，默认路径如下（每步完成即勾选）：

- [ ] 确认 §十 🔴 D1 / D2 / D5 三项是否沿用默认（5 分钟对齐，不确认即按默认）
- [ ] **今天**：按 §十二 步骤 1–2 产出 `01_schema.json` + `02_duration_engine_spec.md`
- [ ] **本周**：按 §十二 步骤 3–4 产出 Prompt 骨架 + pipeline brief 白名单接入
- [ ] **下周**：按 §十一 ② → ⑤ 推进引擎实现 → Golden × 3 → 回归 → Prompt 定稿
- [ ] Phase 1 GA 灰度 2 周后评估 Phase 2 升格范围（§六 Phase 2 表格）

**本目录后续预计文件清单**：

| 文件 | 作用 | 何时产出 |
|------|------|---------|
| `01_schema.json` | 完整 JSON Schema | §十二 步骤 1（今天） |
| `02_duration_engine_spec.md` | 时长引擎公式与参数表 | §十二 步骤 2（今天） |
| `03_ambiguity_rubric.md` | 歧义告警细则 | §十一 ③（Prompt 骨架阶段） |
| `04_golden_samples/` | 3 份 golden（标准/小说/混合） | §十一 ④ |
| `05_regression_report.md` | v5 基线对比报告 | §十一 ⑤ |
