# satisfaction.exclusive_favor

<!-- 消费者：Director -->
<!-- 注入条件：`block_index[i].routing.satisfaction[]` 含 `exclusive_favor` 时注入 -->
<!-- 版本：v5.0（T05 新增） -->
<!-- 脱敏声明：源自参考源 C 的爽点三层模型，术语重写为 motif/trigger/payoff。 -->

## 1. 目的

当本 block 的 `routing.satisfaction` 含 `exclusive_favor`（独享偏爱）时，给 Director 提供该母题的 **触发器** 与 **兑现画面** 指南。本母题在甜宠 / 恋爱 / 职场守护类题材中为主兑现形态。

## 2. 注入触发条件

```yaml
- slice_id: satisfaction.exclusive_favor
  path: director/satisfaction/exclusive_favor.md
  max_tokens: 300
  priority: 30
  match:
    satisfaction:
      any_of: ["exclusive_favor"]
```

## 3. 受控词表引用

- `satisfaction_motif`: `exclusive_favor`
- `satisfaction_trigger`: `["public_humiliation_reverse","authority_endorsement","cost_materialized"]`
- `status_position`: `up / mid / down`
- `shot_code_category`: `B_emotion`、`D_welfare`

## 4. 内容骨架

### 4.1 母题定义

**独享偏爱**：一位具备 **选择权 / 资源 / 权威** 的角色，在公开或半公开场合、有多位候选对象时，明确将关注 / 资源 / 立场给予主角一人。可视性核心是"众人可见的唯一指向"。

### 4.2 触发器样板（从下列里选 1 个）

1. **`authority_endorsement`**：权威 / 上位者越过流程直接点名主角。
2. **`cost_materialized`**：支付者愿意为主角支付一个可见 / 可衡量的代价（时间、金钱、人情）。
3. **`public_humiliation_reverse`**：主角刚被贬低，施爱者立刻用一次公开偏爱反写。

### 4.3 兑现画面要求（至少命中 2 项）

- "众人在场 + 指向主角"的 `A4 反应连拍`（至少 2 位旁观者反应镜）。
- 施爱角色的 **选择动作特写**（`A3` 或 `B1`）：如手牵到主角而非他人、目光越过众人。
- 主角的 `B1 主体特写` 反应（不要露过多笑意，留 50% 的未消化感 → 让观众替 TA 消化）。
- 若题材允许，可加 1 个 `D1 定格海报` 或 `D4 特效强调`。

### 4.4 与其他字段联动

- 兑现 block 的 `status_curve.protagonist.position` 建议 `up` 或 `mid`。
- 常与 `psychology_group == "bonding"` + `psychology_effect ∈ {scarcity, reciprocity}` 搭配。
- `routing.paywall_level == "soft"` 时常见（情感向末组）。

## 5. Director/Prompter 如何消费

- **Director**：镜头序列里至少 1 次"施爱者的选择动作"与"2 个他者的反应"并置；避免让偏爱仅体现于对白。
- **Prompter**：不直接消费。

## 6. 反例（禁止的写法）

- ❌ 偏爱表达只在对白里说"你最特别"，没有任何视觉证据。
- ❌ 主角反应过满（全程笑到合不拢嘴），留不出观众代入空间。
- ❌ 没有任何旁观者反应镜（独享偏爱 = 众人可见的唯一指向，至少要有"众人"）。
