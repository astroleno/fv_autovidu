# SD2Workflow v5 · P1 任务清单（T05–T08）

**优先级：P1（Week 2 完成）**
**日期：2026-04-16**

P1 四项任务共同特征：**全部靠新切片 + 路由标签承载，不改核心流水线**。实施完成即形成「v5 内容方法论注入层」。

**v5 切片策略**：T05/T06/T07 全部**微切片化**（见 `02_` §四）：爽点 4 份、心理学 6 份、镜头编码 4 份，Director 按命中只注入相关的；总 token 仍在 `max_total_tokens_per_consumer.director = 3000` 内。

前置依赖：P0 完成（尤其 T02 schema 冻结、T03 `status_curve`）。字段契约以 `07_v5-schema-冻结.md` 为准。

---

## T05 · 爽点三层模型（母题 / 触发器 / 兑现）

### 背景
v4 能产出好看的分镜，但"爽"与"不爽"缺乏结构化拆解。v5 引入三层模型作为**内容塑形器**：母题（motif）是选型、触发器（trigger）是上下文设计、兑现（payoff）是视觉收束。

### 受控词
（重申 `01_` §4.3）

```
satisfaction_motif   : ["status_reversal","control","exclusive_favor","instant_justice","none"]
satisfaction_trigger : ["public_humiliation_reverse","resource_deprivation_return",
                        "rule_exploitation","boundary_setting","info_gap_control",
                        "authority_endorsement","cost_materialized","none"]
```

### 字段产出

- `meta.satisfaction_points[]`：见 `07_` §二。
- `block_index[i].routing.satisfaction[]`：0 或 1 个母题（v5 暂限 1）。

### 注入侧
- **4 份微切片**（见 `02_` §4.1）：
  `director/satisfaction/status_reversal.md` / `control.md` / `exclusive_favor.md` / `instant_justice.md`
- `injection_map v2.0` conditional 按命中注入，每份 ≤ 300 tokens。

### EditMap v5 prompt 钩子

```
# 第 2 步之后追加：爽点规划
- 判断本片是否存在爽点节拍（并非每片必须有）。
- 命中母题后，在对应 block 标记 satisfaction_points[i]。
- 爽点建议放在叙事中后段（避免 hook 直接爆兑现）；与 status_curve 的 up/down 翻转对齐。
- 若无合适爽点，filed="none" 并在 diagnosis.notes 解释题材原因（文艺/慢热/悬疑细雨等）。
```

### 与其他字段联动
- 爽点 block 的 `status_curve.protagonist.position`：兑现时必须 `"up"` 或 `"mid"`，不可继续 `"down"`。
- 爽点 block 的 `routing.shot_hint[]`：建议含 `A_event` + `B_emotion`（T07 联动）。

### 验收
- 路由 `satisfaction` 非空时，对应 `satisfaction/{motif}.md` 微切片被注入（在 `routing_trace.applied[]` 可见）。
- 兑现 block 的 Director 产出包含"反打 / 连续反应镜 / 确认镜"至少其一（抽样审）。

---

## T06 · 心理学武器库（六功能组）

### 背景
v4 的情绪调动靠 prompt 泛泛描述；v5 把心理学效应做成**模块化武器**，按 block 功能（Hook / Retention / Payoff / Bonding / Relationship / Conversion）挑 1–2 种效应组合。

### 受控词
```
psychology_group  : ["hook","retention","payoff","bonding","relationship","conversion"]
psychology_effect : ["loss_aversion","negative_bias","zeigarnik","cognitive_dissonance",
                     "peak_end","anchoring","inequity_aversion","sunk_cost",
                     "authority_bias","scarcity","social_proof","reciprocity"]
```

### 字段产出

- `meta.psychology_plan[]`：见 `07_` §二；每 block 最多 2 个 `effects`。
- `block_index[i].routing.psychology[]`：效应名（供记录/QA 用）。
- 编排层**派生** `routing.psychology_group`（见 `02_` §六）用于切片匹配，切片按 6 个功能组命中。

### 注入侧
- **6 份微切片**（见 `02_` §4.1）：
  `director/psychology/hook.md` / `retention.md` / `payoff.md` / `bonding.md` / `relationship.md` / `conversion.md`
- `injection_map v2.0` 条件注入 `psychology_group`（派生字段），每份 ≤ 360 tokens。

### 切片内容原则
- 每份切片按"功能组视角"组织：定义 + 2–3 个常用效应 × 在 block 里怎么体现 + 1–2 条禁忌（见 `02_` §7.2）。
- 不抄原文，全部用我们的术语；每行以动词开头（"放一个…"、"让镜头…"）。

### EditMap v5 prompt 钩子

```
# 第 3 步：心理学计划（v5 新增）
- 给每个 block 指派 group（6 个功能组之一）；
- 从 12 效应中挑 1–2 个与 group 搭配（见附录·组合建议）；
- 写入 `meta.psychology_plan[]` + 每个 block 的 `block_index[i].routing.psychology[]`（canonical schema，见 07）。
```

### 验收
- 每 block 至少 1 个 `group`；末 block 必须是 `conversion` 或 `payoff`。
- 路由 `psychology` 非空时，切片注入记录到 `routing_trace.applied[]`。

---

## T07 · 镜头编码手册（A/B/C/D 四类）

### 背景
v4 Director 分镜是自由文本，不利于下游审计/复用。v5 在 Director 产出中引入**轻量镜头编码**：不是强制 taxonomy，而是在每个 shot 旁边加 `[code]` 标签，便于 Prompter 选模板、便于 QA 统计。

### 编码字典（我们的版本，见 `02_` §5.4）

| 类 | 编号 | 语义 | 常见时长 |
|----|------|------|---------|
| A 事件 | A1 冲击帧 | 1 秒以内的视觉爆点 | 1–2s |
|       | A2 确认镜 | 关键信息首次披露 | 2–3s |
|       | A3 证据特写 | 物件/字幕/文件特写 | 2–4s |
|       | A4 反应连拍 | 2–3 个人连续反应 | 3–5s |
| B 情绪 | B1 主体特写 | 单人脸部/眼睛 | 2–4s |
|       | B2 眼神反打 | 两人对视 | 3–5s |
|       | B3 呼吸拉近 | 慢推近 | 3–5s |
|       | B4 沉默停顿 | 无对白停留 | 2–3s |
| C 转场 | C1 硬切 | 瞬切换景 | 即时 |
|       | C2 匹配剪 | 动作 / 形状匹配 | 即时 |
|       | C3 光切 | 光强/色变换切 | 1s |
|       | C4 声切 | 声音先行切 | 即时 |
| D 福利 | D1 定格海报 | 高光定格 | 1–2s |
|       | D2 跟拍走位 | 追随主角 | 3–5s |
|       | D3 炫技运镜 | 复杂运镜 | 4–6s |
|       | D4 特效强调 | VFX 点缀 | 2–3s |

### Director 侧消费（v5.0 **软门** · v5.1 升硬门）

- Director 产出的 markdown 每个镜头起行带 `[CODE]`，如：`[A2] 近景，主角右手把信封推过桌面，对手停顿。`
- 把本 block 使用的 code 列表写到 `continuity_out.shot_codes_used[]`（**LLM 自报字段**，见 `07_` §三）。
- **v5.0 只打 warning，不 CI 硬挡**。v5.1 加入 `shots_contract[]` 结构化产出后，升为硬门（精确计数每类 code 数量）。

### 切片（**4 份微切片**）
- `director/shot_codes/A_event.md` / `B_emotion.md` / `C_transition.md` / `D_welfare.md`（每份 ≤ 240 tokens）。
- `injection_map v2.0` 条件注入 `block_index[i].routing.shot_hint[]`（EditMap 只给大类 hint，Director 自选细分号）。

### EditMap v5 prompt 钩子

```
# 第 4 步：镜头大类 hint（v5 新增，可选）
- 给每个 block 标 shot_hint[]（大类：A_event / B_emotion / C_transition / D_welfare）；
- 不指派具体编号，具体 A1/B3 等由 Director 决定；
- 默认：hook block 含 A_event + B_emotion；payoff block 含 A_event + D_welfare。
```

### 验收
- 至少 70% block 的 Director 产出带 `[CODE]` 标签。
- `shot_codes_used[]` 出现且与 shot_hint 大类一致。
- 路由 `shot_hint` 非空时，对应 `shot_codes/{category}.md` 微切片被注入。

---

## T08 · 信息差账本 + 证据链阶梯

### 背景
悬疑类短剧的核心是"谁知道什么、证据到哪一级"。v5 让 EditMap 产出两本账：**信息差账本**（人物视角知识表）+ **证据链阶梯**（证据等级升级轨迹），供下游检查"不自觉剧透 / 证据跳档"。

### 字段契约（v5 修宽版，支持悬疑/反转）

#### 8.1 信息差账本（`actors_knowledge` 聚合）

为避免初版"audience 必须全知"的过严约束，v5 把信息差按 **block → actors** 的两层结构组织，并允许 audience 显式标记 `hidden_from_audience`（即"作者故意对观众隐藏"）。

结构以 `07_v5-schema-冻结.md` §二 `meta.info_gap_ledger[]` 为准。要点：

- 每 block 一条，内含 `actors_knowledge[]`。
- 可选 actor：`protagonist / antagonist_<name> / npc_<name> / audience`。
- 每 block 至少 1 个 `audience` 条目。
- `hidden_from_audience[]` 为"作者留白"清单，参与**弱覆盖规则**判定。

#### 8.2 证据链阶梯（允许回撤）

结构以 `07_` §二 `meta.proof_ladder[]` 为准。要点：

- `level ∈ proof_level`（见 `07_` §五）。
- 新增 `retracted: bool`（默认 false）+ `retract_reason`：**支持证人反水、反转、误证被推翻**。
- 单调性只对非 retracted 条目生效。

### 审计实现（软门 · normalize）

详见 `07_` §7.2 / §7.3：

```
diagnosis.info_gap_check（软门）:
  对每个 block：
    - 必须存在 actor == "audience" 条目；
    - 弱覆盖：audience.knows ∪ audience.hidden_from_audience ⊇ protagonist.knows；
    - 不要求覆盖 antagonist_* 的知识。
  违反 → warning，不 retry、不阻塞。

diagnosis.proof_ladder_check（软门）:
  - 先过滤 retracted == true 的条目；
  - 剩余集合按 block_id 顺序检查 level 单调不降；
  - 至少出现 2 个不同 level（不含被过滤的）；
  - meta.genre_hint == "non_mystery" 时可整块为空，check=true。
  违反 → warning，不 retry、不阻塞。
```

> **v5.0 两项都是软门**：保证悬疑/反转题材的写作自由度，不误杀"故意留白 / 证人反水"等合理结构。

### EditMap v5 prompt 钩子

```
# 第 5 步：信息差 / 证据链账本（v5 新增，悬疑/反转类必做，其他题材可跳过）

写入 meta.info_gap_ledger[]（每 block 一条，内含 actors_knowledge[]）：
- 至少列出 audience 条目；
- audience 可显式声明 hidden_from_audience[]（观众不知道、但作者承认存在的事实）；
- 观众对主角事实要求："knows ∪ hidden_from_audience ⊇ protagonist.knows"（弱覆盖）；
- 不要求观众覆盖对手视角。

写入 meta.proof_ladder[]：
- 证据条目带 level ∈ {rumor, physical, testimony, self_confession}；
- 可设 retracted: true（证人反水 / 误证被推翻），审计时自动忽略该条；
- 非悬疑向：整块可留空 []，diagnosis 标注 skipped。
```

### 与 T05/T06 联动
- 爽点 `status_reversal` 常与 `proof_ladder` 跳级对齐（兑现 block = testimony 或 self_confession 出场 block）。
- `psychology` 中 `zeigarnik`（蔡格尼克效应）与 `hidden_from_audience[]` 直接挂钩（留白 = zeigarnik 张力）。

### 验收
- 悬疑/反转题材回归剧本：`info_gap_check` / `proof_ladder_check` 的 warning 数 ≤ 2（**软门**）。
- 非悬疑题材：两项标 `skipped`，无 warning。
- 允许 `retracted: true` 出现；审计自动跳过，不视为回退。

---

## 二、P1 汇总：文件变动一览

| 文件 | 动作 | 任务 |
|------|------|------|
| `1_EditMap-SD2-v5.md` | 新增 Step 3 / 4 / 5 钩子（爽点 / 心理学 / 信息差） | T05/T06/T07/T08 |
| `4_KnowledgeSlices/director/satisfaction/{status_reversal,control,exclusive_favor,instant_justice}.md` | **新建 4 份微切片** | T05 |
| `4_KnowledgeSlices/director/psychology/{hook,retention,payoff,bonding,relationship,conversion}.md` | **新建 6 份微切片** | T06 |
| `4_KnowledgeSlices/director/shot_codes/{A_event,B_emotion,C_transition,D_welfare}.md` | **新建 4 份微切片** | T07 |
| `injection_map.yaml v2.0` | 新增 14 条 conditional 切片条目 + `psychology_group` 派生匹配 | T05/T06/T07 |
| `normalize_edit_map_sd2_v5.mjs` | 新增 `info_gap_check` / `proof_ladder_check`（软门，支持 `hidden_from_audience` + `retracted`） | T08 |
| `2_SD2Director-v5.md` | 加钩子：分镜行首使用 `[CODE]`；`continuity_out` 新增 `shot_codes_used[]`（v5.0 软字段） | T07 |
| `docs/v5/_traceability.yaml` | 14 条新切片登记来源代号 C | T05/T06/T07 |

---

## 三、P1 风险与缓解

| 风险 | 缓解 |
|------|------|
| 新增字段让 EditMap JSON 变大、解析概率下降 | 字段均为可空 `[]`；非悬疑可 skip；v5 prompt 里明确"简洁即可" |
| 心理学词表太多让 LLM 乱填 | prompt 给"组合建议表"；normalize 做白名单检查 |
| shot_code 全片分布不均衡（全是 A1） | 切片反例节写明"禁连续 3 个同编码"；Director 内部自检 |
| `proof_ladder` 和 `info_gap_ledger` 相互打架 | 规定：证据 level 提升必须伴随对应 actor.knows 增量 |

---

## 四、P1 成功基线（给 06_ 验收用）

- P1 完成后，3 个回归剧本中：
  - 至少 2 套 `satisfaction_points` 命中，且对应 Director 产出含反打/连拍；
  - 每 block 至少 1 个 `psychology_plan.group`，派生字段 `routing.psychology_group` 对齐切片注入；
  - 至少 70% block 的 Director 输出带 `[CODE]` 标记（v5.0 **软门**，只记统计，不阻塞）；
  - 悬疑回归剧本：`info_gap_check` / `proof_ladder_check` warning 数 ≤ 2（**软门**）；
  - 非悬疑剧本：两项标 `skipped`。

下一篇：`05_tasks_P2_竖屏与付费闭环.md`。
