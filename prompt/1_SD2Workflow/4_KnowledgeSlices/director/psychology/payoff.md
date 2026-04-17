# psychology.payoff

<!-- 消费者：Director -->
<!-- 注入条件：派生字段 `routing.psychology_group == "payoff"` 时注入 -->
<!-- 版本：v5.0（T06 新增） -->
<!-- 脱敏声明：源自参考源 C 的"心理学六功能组"研究包，术语与列举已重写。 -->

## 1. 目的

当本 block 的功能组是 **payoff（兑现 / 爽点释放）** 时，给 Director 2–3 种心理学效应的落点，帮助"爽点"从情绪层面被观众切实感知。通常与 T05 爽点母题切片同时命中。

## 2. 注入触发条件

```yaml
- slice_id: psychology.payoff
  path: director/psychology/payoff.md
  max_tokens: 360
  priority: 40
  match:
    psychology_group:
      any_of: ["payoff"]
```

## 3. 受控词表引用

- `psychology_group`: `payoff`
- `psychology_effect`: `peak_end` / `inequity_aversion` / `cognitive_dissonance` / `negative_bias`
- `shot_code_category`: `A_event`、`B_emotion`、`D_welfare`

## 4. 内容骨架

### 4.1 组任务

把积蓄的张力在 4–10s 内释放；让观众体验"终于等到 / 果然如此 / 不公终被纠正"的情绪峰值。与 T05 爽点母题协同。

### 4.2 武器 1：`peak_end`（峰终体验）

- **在 block 里怎么拍**：本 block 的高峰必须在 **倒数第 2 个时间片** 到达；末时间片收束而不再继续冲。
- **镜头落点**：倒数第 2 片用 `A4` 反应连拍 或 `B2` 眼神反打；末片用 `B1` 主体特写。
- **画面写法**：高峰有 **可见反应**（多人惊、主角眼含情绪、代价可视）。

### 4.3 武器 2：`inequity_aversion`（不公厌恶的回填）

- **在 block 里怎么拍**：让之前受到不公的一方（通常是主角）在本 block 得到 **可衡量的补偿**（哪怕是象征性的）。
- **镜头落点**：`A3` 证据特写（补偿物）+ `A4` 反应连拍。
- **画面写法**：补偿具象到"一件可看见的事"（签字、交还、道歉镜头）。

### 4.4 武器 3：`cognitive_dissonance`（认知失调的消解）

- **在 block 里怎么拍**：对手之前坚持的立场在本 block 被自己或权威推翻；让观众看到对手"脸上崩"的一刻。
- **镜头落点**：`B1` 主体特写（对手）+ `C1` 硬切。
- **画面写法**：立场崩塌的特写要留 2–3s，不要一闪而过。

### 4.5 组合建议

Payoff 组常见组合：`peak_end + inequity_aversion`（爽点兑现 + 补偿可视）。末 block 若为 `paywall_level == "final_cliff"`，应把峰值推迟到 T12 脚手架再完整释放。

## 5. Director/Prompter 如何消费

- **Director**：末时间片避免继续加码，留出"收束"的空间；与 `status_visual_mapping` 的 `up` 基线一致。
- **Prompter**：依赖 Director 分镜稿。

## 6. 反例（禁止的写法）

- ❌ 爽点兑现只靠主角一句话宣告（没有画面反应）。
- ❌ 在末时间片继续推进（破坏 `peak_end`）。
- ❌ 补偿抽象（"你以后会得到回报"），没有可视物件。
