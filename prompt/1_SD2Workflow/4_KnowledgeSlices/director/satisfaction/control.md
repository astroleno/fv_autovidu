# satisfaction.control

<!-- 消费者：Director -->
<!-- 注入条件：`block_index[i].routing.satisfaction[]` 含 `control` 时注入 -->
<!-- 版本：v5.0（T05 新增） -->
<!-- 脱敏声明：源自参考源 C 的爽点三层模型，术语重写为 motif/trigger/payoff。 -->

## 1. 目的

当本 block 的 `routing.satisfaction` 含 `control`（掌控）时，给 Director 提供该母题的 **触发器设计** 与 **兑现画面** 指南。掌控的情绪重心是"主角为自己设定边界、对外抢回节奏"。

## 2. 注入触发条件

```yaml
- slice_id: satisfaction.control
  path: director/satisfaction/control.md
  max_tokens: 300
  priority: 30
  match:
    satisfaction:
      any_of: ["control"]
```

## 3. 受控词表引用

- `satisfaction_motif`: `control`
- `satisfaction_trigger`: `["boundary_setting","rule_exploitation","info_gap_control"]`
- `status_position`: `up / mid / down`
- `shot_code_category`: `B_emotion`、`A_event`

## 4. 内容骨架

### 4.1 母题定义

**掌控**：主角在场景中 **设定规则 / 掌管节奏 / 收回自主权** 的一次可视事件。与 `status_reversal` 不同：掌控不一定要翻盘，关键是"主角重新成为信息或节奏的主导者"。

### 4.2 触发器样板（从下列里选 1 个）

1. **`boundary_setting`**：主角明确说出"到此为止 / 这是底线"并有相应肢体动作（如伸手 / 切断 / 关门）。
2. **`rule_exploitation`**：主角引用规则 / 合同 / 程序反制对手，对手无法反驳。
3. **`info_gap_control`**：主角选择"告诉一部分 / 保留一部分"，把信息权握在手里。

### 4.3 兑现画面要求（至少命中 2 项）

- 主角的手 / 肢体主导动作特写（`A3 证据特写` 或 `B1 主体特写`）。
- 主角打破对话节奏的一次 **沉默停顿**（`B4`），对手微微后仰 / 僵住。
- 景别从"主角被动反应"切到"主角主动输出"（平视或略低机位）。
- 道具 / 规则文件 / 空间界面作为"权柄"出现（门、桌沿、合同、公告）。

### 4.4 与其他字段联动

- 兑现 block 的 `status_curve.protagonist.position` 建议 `mid` 或 `up`。
- 常与 `psychology_group == "retention"`（留住观众）+ `psychology_effect == "authority_bias"` 搭配。
- 可与 `T08 info_gap_ledger` 的 `hidden_from_audience[]` 联动：主角掌控的部分信息对观众也保留。

## 5. Director/Prompter 如何消费

- **Director**：时间片序列中必须有一个"主角先沉默再出手"的拍点，避免把掌控写成连珠炮台词。
- **Prompter**：不直接消费。

## 6. 反例（禁止的写法）

- ❌ 主角靠大声喊叫表达掌控（声浪 != 掌控）。
- ❌ 所有掌控动作堆在一个 2s 快切（没有停顿就无法感知"节奏被夺回"）。
- ❌ 把 `control` 放在 Hook 组（Hook 需要先失去掌控）。
