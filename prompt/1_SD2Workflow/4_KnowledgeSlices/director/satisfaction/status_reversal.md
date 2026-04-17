# satisfaction.status_reversal

<!-- 消费者：Director -->
<!-- 注入条件：`block_index[i].routing.satisfaction[]` 含 `status_reversal` 时注入 -->
<!-- 版本：v5.0（T05 新增） -->
<!-- 脱敏声明：源自参考源 C 的爽点三层模型，术语重写为 motif/trigger/payoff。 -->

## 1. 目的

当本 block 的 `routing.satisfaction` 含 `status_reversal`（地位反转）时，给 Director 提供该母题的 **触发器设计** 与 **兑现画面** 指南，确保 Director 的分镜稿在对应 block 中"反转"能被观众明确感知。

## 2. 注入触发条件

`injection_map.yaml v2.0`：

```yaml
- slice_id: satisfaction.status_reversal
  path: director/satisfaction/status_reversal.md
  max_tokens: 300
  priority: 30
  match:
    satisfaction:
      any_of: ["status_reversal"]
```

仅在本 block 的 `routing.satisfaction[]` 命中 `status_reversal` 时注入（通常为爽点兑现 block）。

## 3. 受控词表引用

- `satisfaction_motif`: `status_reversal`（见 `07_v5-schema-冻结.md §五`）
- `satisfaction_trigger`: `["public_humiliation_reverse","resource_deprivation_return","rule_exploitation","authority_endorsement"]`
- `status_position`: `["up","mid","down"]`
- `shot_code_category`: `A_event`、`B_emotion`

## 4. 内容骨架

### 4.1 母题定义

**地位反转**：主角从低位（`down`）跃升至高位（`up` 或 `mid`）的一次可视事件。必须满足两条可观察特征：

- 触发前，`status_curve` 中 protagonist 为 `down`；兑现后转为 `mid` 或 `up`（`delta_from_prev ∈ {up, up_steep}`）。
- 对手的权威源被削弱或转移（证据、规则、权威、资源之一）。

### 4.2 触发器样板（从下列里选 1 个）

1. **`public_humiliation_reverse`**：主角曾在公众场合被羞辱，同一公众场合新的证据翻案。
2. **`resource_deprivation_return`**：被剥夺的资源（钥匙、签章、身份）回流到主角手中。
3. **`rule_exploitation`**：主角使用对手自己定下的规则反制对手。
4. **`authority_endorsement`**：新的高权威角色入场，公开为主角背书。

### 4.3 兑现画面要求（至少命中 2 项）

- 主角反打镜（`B2` 眼神反打）或慢推近（`B3`）。
- 对手的反应连拍镜（`A4`）：至少 2 人 / 2 拍。
- 证据 / 道具的确认特写（`A3`）作为"反转凭据"。
- 景别从"主角小 / 对手大" 翻转到"主角大 / 对手小"。

### 4.4 与其他字段联动

- 兑现 block 的 `status_curve.protagonist.position` 必须是 `mid` 或 `up`（与 T03 联动）。
- 建议 `routing.shot_hint[]` 含 `A_event` + `B_emotion`。
- 若同期触发 `T08.proof_ladder`，对应 block 的 `level` 通常跳到 `testimony` 或 `self_confession`。

## 5. Director/Prompter 如何消费

- **Director**：在时间片序列中至少安排 1 个反打 / 反应连拍 + 1 个确认特写；景别按 4.3 翻转。
- **Prompter**：不直接消费，依赖 Director 分镜稿。

## 6. 反例（禁止的写法）

- ❌ 兑现 block 的主角依然占画面 < 40%（视觉上没翻）。
- ❌ 反转仅靠台词宣称，没有反打或反应连拍。
- ❌ 把 `status_reversal` 放在 Hook 组（Hook 应先把主角置于低位）。
