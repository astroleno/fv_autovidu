# satisfaction.instant_justice

<!-- 消费者：Director -->
<!-- 注入条件：`block_index[i].routing.satisfaction[]` 含 `instant_justice` 时注入 -->
<!-- 版本：v5.0（T05 新增） -->
<!-- 脱敏声明：源自参考源 C 的爽点三层模型，术语重写为 motif/trigger/payoff。 -->

## 1. 目的

当本 block 的 `routing.satisfaction` 含 `instant_justice`（即时正义）时，给 Director 提供该母题的 **触发器** 与 **兑现画面** 指南。本母题在复仇 / 反杀 / 公开打脸类 block 中为主兑现形态。

## 2. 注入触发条件

```yaml
- slice_id: satisfaction.instant_justice
  path: director/satisfaction/instant_justice.md
  max_tokens: 300
  priority: 30
  match:
    satisfaction:
      any_of: ["instant_justice"]
```

## 3. 受控词表引用

- `satisfaction_motif`: `instant_justice`
- `satisfaction_trigger`: `["public_humiliation_reverse","rule_exploitation","authority_endorsement","cost_materialized"]`
- `status_position`: `up / mid / down`
- `shot_code_category`: `A_event`、`B_emotion`

## 4. 内容骨架

### 4.1 母题定义

**即时正义**：恶行发生后 **短时间内**（通常同一 block 或相邻 block）在 **对应场景** 得到可视化的报应 / 惩罚 / 代价。关键是"场景同构"与"时间贴近"，不是长线复仇。

### 4.2 触发器样板（从下列里选 1 个）

1. **`public_humiliation_reverse`**：在恶行发生的同一观众面前施以惩罚。
2. **`rule_exploitation`**：借对手自定的规则把惩罚合法化（"按公司规定"、"按规则"）。
3. **`authority_endorsement`**：权威入场宣布惩罚决定。
4. **`cost_materialized`**：对手承担可见代价（失去工作、名声、物证、关系）。

### 4.3 兑现画面要求（至少命中 2 项）

- **旁观者反应连拍**（`A4`）：先观众震惊，后主角反应。
- 对手的 **失控特写**（`B1`）：喉结、手抖、嘴唇颤动之一。
- 代价可视化 `A3`：文件盖章、工卡收回、名牌摘下、座位被收。
- 景别压迫：对手从中景 → 近景 → 特写，占画面递减 ≥ 15%。

### 4.4 与其他字段联动

- 兑现 block 的 `status_curve.protagonist.position` 通常为 `up`；对手从 `up` → `down`。
- 常与 `psychology_group == "payoff"` + `psychology_effect ∈ {inequity_aversion, negative_bias}` 搭配。
- 常与 `T08 proof_ladder` 的 `level == testimony / self_confession` 联动。

## 5. Director/Prompter 如何消费

- **Director**：在 4–8s 内完成"惩罚施加 → 对手反应 → 观众反应"的三拍；避免拖到相邻 block。
- **Prompter**：不直接消费。

## 6. 反例（禁止的写法）

- ❌ 惩罚隔 1 集才到（不是即时，属于长线复仇）。
- ❌ 只有主角笑容 + 对手受挫台词，没有代价可视化。
- ❌ 没有任何旁观者反应镜（"即时正义"必须被多人见证）。
