# Stage 0 · 时长引擎 · 参数与公式规范 v1.0

**状态：🔒 Schema 冻结同步（2026-04-17）**
**定位：为 `fv_autovidu/scripts/sd2_pipeline/stage0/normalizer_duration_engine.mjs` 与 `normalizer_timeline_engine.mjs` 提供唯一合同**
**与 01_schema.json 的关系**：本文件定义 `temporal_model.beats[].screen_time_sec.breakdown` 各字段的**计算来源**与**参数默认值**；schema 只约束 I/O 形状，不约束算法。
**与 00 计划的关系**：展开 §3.4 时长估算公式 + §十二 步骤 2 参数锁定；不得与 00 计划冲突，冲突时以 00 计划为准。

---

## 一、设计原则（与 00 §二 对齐）

1. **确定性先行**：时长累加、双时间轴、drift_ratio 完全由代码产出；LLM 不参与数字计算。
2. **可审计**：每个 beat 的 `screen_time_sec` 必须可以由 `breakdown` 五项反推出来，误差 ≤ 0.01s（浮点容差）。
3. **参数可覆盖**：下方"参数表"所有默认值允许在 pipeline 层 runtime override（如题材偏慢可把 `chinese_chars_per_sec` 降到 3.0），但不允许改公式结构。
4. **不做 snap**：4–15s 窗口聚合是 EditMap 的职责，Stage 0 只给 `est / min / max` 连续估算。
5. **LLM 只给"语义信号"**：ScriptNormalizer 的 LLM 返回 `dialogue_char_count / action_verb_count / reaction_subject / has_interaction / is_hard_cut`，代码引擎据此算时长。

---

## 二、核心公式

### 2.1 单 beat 时长（屏幕时长 · 秒）

```
prelude_sec       = clamp(PRELUDE_MIN + interaction_penalty, PRELUDE_MIN, PRELUDE_MAX)
dialogue_sec      = dialogue_char_count / CHINESE_CHARS_PER_SEC
action_sec        = action_verb_count × ACTION_VERB_SEC + (has_interaction ? INTERACTION_BONUS_SEC : 0)
reaction_buffer   = reaction_subject != null
                    ? clamp(REACTION_MIN, REACTION_MIN, REACTION_MAX)
                    : 0
transition_cost   = is_hard_cut ? TRANSITION_HARD_CUT_SEC : 0

est = prelude_sec + dialogue_sec + action_sec + reaction_buffer + transition_cost
min = est × MIN_RATIO
max = est × MAX_RATIO
```

**严格约束**：
- 所有分项 ≥ 0，浮点保留 2 位小数（`Math.round(x * 100) / 100`）。
- `est ≥ min` 且 `est ≤ max` 必须恒成立；若舍入误差导致越界，以 `est` 为准夹紧 `min/max`。
- `prelude_sec` 的 `interaction_penalty` 仅在 `has_interaction=true` 时加 0.2s（解决"两人刚进画面"的空镜头），总值仍 clamp 在 `[PRELUDE_MIN, PRELUDE_MAX]`。

### 2.2 全集累计与 drift_ratio

```
episodes_estimated_screen_sec = Σ beats[*].screen_time_sec.est
drift_ratio = | episodes_estimated_screen_sec - episodes_target_screen_sec |
              / episodes_target_screen_sec
```

- `episodes_target_screen_sec` = pipeline 层透传的 `episodeDuration`。
- `drift_ratio > DRIFT_ALERT_THRESHOLD` → 引擎在返回值里置位 `_warnings.drift_exceeded=true`（不中断流程，交给 pipeline 决策是否兜底）。

### 2.3 双时间轴

- `display_order`：与 `beat_ledger` 的数组顺序一致（LLM 已按观众视角排好）。
- `story_order`：由 LLM 给出（见下文 LLM 契约）；缺省时 `story_order = display_order`。
- `story_elapsed_sec`：LLM 给出剧情内流逝秒数；`time_mode ∈ {flashback, dream, parallel}` 时允许为 0 或 null；`ellipsis` 时可以 > 60s。
- `time_mode` 缺省 = `"present"`（D3 默认）。

**双轴正交性校验**（引擎层 assert，不通过则进 `_warnings`）：
- `display_order` 必须是从 0 连续递增的整数序列，不得有空洞。
- `story_order` 允许乱序，但集合必须与 `display_order` 集合相等（互为置换）。

---

## 三、参数表（🔒 Phase 1 默认值 · 允许 runtime override）

| 参数符号 | 默认值 | 含义 | 覆盖建议 |
|----------|-------|------|---------|
| `CHINESE_CHARS_PER_SEC` | **3.5** | 中文对白字/秒基准（D6 默认） | 老年/情感戏 3.0；综艺/快节奏 4.0 |
| `PRELUDE_MIN` | **0.5** | 每 beat 前置起拍最小秒数 | 卡点剪辑可 0.3 |
| `PRELUDE_MAX` | **1.0** | 每 beat 前置起拍最大秒数 | 长镜头可放到 1.5 |
| `ACTION_VERB_SEC` | **0.8** | 每个动作动词占用秒 | 武戏 1.2；纯信息戏 0.5 |
| `INTERACTION_BONUS_SEC` | **1.0** | 双方互动额外占用 | 默认不改 |
| `REACTION_MIN` | **1.5** | 反应主体存在时的反应缓冲下限 | 情感戏 2.0 |
| `REACTION_MAX` | **2.0** | 反应缓冲上限 | 情感戏 3.0 |
| `TRANSITION_HARD_CUT_SEC` | **1.0** | 跨场次硬切的过渡成本 | 柔切 0.5 |
| `MIN_RATIO` | **0.85** | est → min 的收缩系数 | 不建议改 |
| `MAX_RATIO` | **1.2** | est → max 的扩张系数 | 不建议改 |
| `DRIFT_ALERT_THRESHOLD` | **0.1** | drift_ratio 告警阈 | 短剧 0.08；长剧 0.15 |

**参数接口约定**（供 `normalizer_duration_engine.mjs` 对齐）：

```ts
type DurationEngineParams = {
  chinese_chars_per_sec: number;
  prelude_min_sec: number;
  prelude_max_sec: number;
  action_verb_sec: number;
  interaction_bonus_sec: number;
  reaction_min_sec: number;
  reaction_max_sec: number;
  transition_hard_cut_sec: number;
  min_ratio: number;
  max_ratio: number;
  drift_alert_threshold: number;
};
```

> **硬约束**：禁止 TypeScript 代码使用 `any` 类型（沿用用户规则）；参数结构体必须完整列名，不能用 `Record<string, any>` 糊过去。

---

## 四、LLM → 引擎 的最小信号集

ScriptNormalizer 的 LLM 只需对每条 beat 返回下述 7 个语义信号，时长全部由代码算：

| 字段 | 类型 | 来源 | 必填 |
|------|------|------|-----|
| `dialogue_char_count` | integer ≥ 0 | 统计 beat 内对白总字符数（不计标点） | ✅ |
| `action_verb_count` | integer ≥ 0 | 统计核心动词数（如"冷冷地说""低头""转身"各算 1） | ✅ |
| `reaction_subject` | CHAR_ID \| null | 反应主体，无则 null | ✅（允许 null） |
| `has_interaction` | boolean | 是否为多人互动（≥ 2 个 participants 且有你来我往） | ✅ |
| `is_hard_cut` | boolean | 与前一 beat 是否跨场次硬切 | ✅ |
| `story_order` | integer ≥ 0 | 故事真实顺序；缺省 = display_order | ⚠️ 可选 |
| `time_mode` | enum | present / flashback / dream / parallel / ellipsis；缺省 = present | ⚠️ 可选 |

> **注意**：`has_interaction` / `is_hard_cut` 是 LLM 可靠判断的语义信号，不是时长。LLM 不得返回任何秒数字段。

---

## 五、已知偏差场景表（Golden 回归对齐项）

以下场景是时长引擎的**系统性偏差源**，Golden × 3 必须至少各覆盖一例，`drift_ratio` 超阈时优先检查这些场景。

| 场景 | 典型偏差方向 | 偏差幅度（估） | 缓解方向 |
|------|-------------|--------------|---------|
| **长镜头留白**（1 beat 5s 纯空镜 + 零对白） | 严重**低估**（公式算出 <1s） | -60% ~ -80% | LLM 给 `beat_type_hint="silence"` 时，引擎加 `silence_bonus = 3.0s`（v1.1 补丁预留） |
| **纯动作戏**（武戏 / 追逐 / 破门） | **低估** | -20% ~ -40% | 题材先验：若 `genre_hint="action"` 则 `ACTION_VERB_SEC` override 为 1.2 |
| **多人抢话 / 重叠对白** | **高估**（字数线性累加忽略叠话） | +15% ~ +25% | `has_interaction=true` 且 `participants ≥ 3` 时，`dialogue_sec *= 0.85` |
| **特写 / 情感凝视** | **低估** | -30% | 当 `reaction_subject != null` 且 `modality="internal"` 时，`REACTION_MAX` 提升到 3.0 |
| **回忆/蒙太奇组合**（跨 `time_mode`） | 不影响 screen_time，但影响 `block_suggestion` | — | 引擎在 `block_suggestion` 生成时跳过 `time_mode != "present"` 的跨模式聚合 |
| **超短对白 "嗯" "好"** | **高估**（prelude + reaction 垫过真实时长） | +100% 以上 | `dialogue_char_count ≤ 2` 且 `action_verb_count = 0` 时，`prelude_sec` clamp 到 `PRELUDE_MIN` 且 `reaction_buffer *= 0.5` |

> **实施方式**：上述六条缓解策略在 v1.0 **不内置**，由 Golden 回归报告（`05_regression_report.md`）对比 `leji-v5d` 基线后再决定是否升级到 v1.1。Phase 1 只锁"最小可工作引擎"。

---

## 六、边界 case 与错误处理

### 6.1 输入异常

| 场景 | 引擎行为 |
|------|---------|
| `dialogue_char_count < 0` 或非整数 | 抛 `RangeError`，pipeline 捕获后按 §九 失败兜底（不阻塞 EditMap） |
| `reaction_subject` 不在 `character_registry` 中 | 记 `_warnings.orphan_reaction_subject`，仍按 `reaction_subject != null` 计算 |
| `is_hard_cut` 但 `scene_timeline.is_continuous_from_prev=true` | 记 `_warnings.cut_vs_scene_inconsistent`，优先信 `is_hard_cut`（以 beat 为粒度） |
| `story_order` 集合 ≠ `display_order` 集合 | 记 `_warnings.order_permutation_broken`，退化为 `story_order = display_order` |
| `episode_duration_sec` 缺失或为 0 | 跳过 `drift_ratio` 计算，置 `drift_ratio = 0`，记 `_warnings.no_target_duration` |

### 6.2 浮点与舍入

- 所有分项在累加前先保留 2 位小数。
- `est / min / max` 最终输出也保留 2 位小数。
- 浮点比较使用 `Math.abs(a - b) < 1e-2` 作为一致性断言阈值。

### 6.3 输出自检（引擎返回前必过）

```
assert beats.every(b => b.screen_time_sec.min <= b.screen_time_sec.est <= b.screen_time_sec.max)
assert beats.every(b => sum(Object.values(b.screen_time_sec.breakdown)) ≈ b.screen_time_sec.est, tol=1e-2)
assert new Set(beats.map(b => b.display_order)).size === beats.length
assert new Set(beats.map(b => b.story_order)).size === beats.length
assert beats.every(b => VALID_TIME_MODES.has(b.time_mode ?? 'present'))
```

断言失败抛 `DurationEngineConsistencyError`，pipeline 层走 §九 失败兜底。

---

## 七、单元测试最小用例（≥ 80% 覆盖率要求）

`fv_autovidu` 侧的 `normalizer_duration_engine.spec.mjs` 至少覆盖下述 10 组 input→expected：

| # | 输入语义 | 关键信号 | 期望 est（秒） | 说明 |
|---|---------|---------|--------------|------|
| U1 | 纯 1 字对白 "好" | chars=1, verbs=0, reaction=null, interaction=false, hard_cut=false | 0.5 + 0.29 ≈ **0.79** | 最小值下界 |
| U2 | 9 字对白 + 1 动词 + 反应 | chars=9, verbs=1, reaction=X, interaction=false, hard_cut=false | 0.5 + 2.57 + 0.8 + 1.5 = **5.37** | 计划正文示例 4.2 附近 |
| U3 | 长独白 50 字 | chars=50, verbs=0, reaction=null, interaction=false, hard_cut=false | 0.5 + 14.29 = **14.79** | 触及 4–15s 窗口上限 |
| U4 | 多人互动 | chars=20, verbs=2, reaction=Y, interaction=true, hard_cut=false | 0.7 + 5.71 + 2.6 + 1.5 = **10.51** | prelude +0.2 互动罚时 |
| U5 | 跨场硬切 | chars=10, verbs=1, reaction=null, interaction=false, hard_cut=true | 0.5 + 2.86 + 0.8 + 0 + 1.0 = **5.16** | transition_cost 生效 |
| U6 | 纯动作戏 3 动词 | chars=0, verbs=3, reaction=Y, interaction=true, hard_cut=false | 0.7 + 0 + 3.4 + 1.5 = **5.6** | action_sec 为主 |
| U7 | 空 beat | chars=0, verbs=0, reaction=null, interaction=false, hard_cut=false | **0.5** | 只有 prelude |
| U8 | min/max 边界 | 同 U2 | min=0.85×5.37=**4.56**, max=1.2×5.37=**6.44** | 收/扩系数 |
| U9 | drift_ratio 正向 | target=120, estimated=132 | drift=**0.1** | 恰在阈值 |
| U10 | drift_ratio 超阈 | target=120, estimated=140 | drift=**0.167**, warn | 告警置位 |

---

## 八、版本演进

| 版本 | 日期 | 变更要点 |
|------|------|---------|
| v1.0 | 2026-04-17 | 初稿：锁定公式结构 + 11 参数 + 10 单测 + 5 类偏差场景 |
| v1.1（预留） | TBD | 若 Golden 回归报告要求，追加 silence_bonus / 题材先验 override |
| v1.2（预留） | TBD | 若 Phase 2 升格 `entity_state_ledger`，引擎可能新增 state_transition 对时长的微扰项 |

---

## 九、与 00 计划的引用锚点

- 公式来源：`00_ScriptNormalizer-v1-计划.md` §3.4 时长估算公式（代码层，不交给 LLM）
- 参数默认值：同文件 §十二 步骤 2 + §十 D6
- 失败兜底：同文件 §九 风险表最后一行 · Stage 0 调用失败
- 施工顺序：同文件 §六 Phase 1 施工顺序红线 ②
- 仓库分工：同文件 §十三（本文件归 `feeling_video_prompt`，引擎实现归 `fv_autovidu`）
