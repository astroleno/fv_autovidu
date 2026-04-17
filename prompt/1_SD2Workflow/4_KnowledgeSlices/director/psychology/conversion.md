# psychology.conversion

<!-- 消费者：Director -->
<!-- 注入条件：派生字段 `routing.psychology_group == "conversion"` 时注入 -->
<!-- 版本：v5.0（T06 新增） -->
<!-- 脱敏声明：源自参考源 C 的"心理学六功能组"研究包，术语与列举已重写。 -->

## 1. 目的

当本 block 的功能组是 **conversion（转化 / 追更驱动）** 时，给 Director 2–3 种心理学效应的落点。通常是 **末 block**，与 T12 paywall 切片同时命中。

## 2. 注入触发条件

```yaml
- slice_id: psychology.conversion
  path: director/psychology/conversion.md
  max_tokens: 360
  priority: 40
  match:
    psychology_group:
      any_of: ["conversion"]
```

## 3. 受控词表引用

- `psychology_group`: `conversion`
- `psychology_effect`: `loss_aversion` / `scarcity` / `zeigarnik` / `cognitive_dissonance`
- `shot_code_category`: `B_emotion`、`A_event`、`D_welfare`

## 4. 内容骨架

### 4.1 组任务

让观众 **必须点下一集 / 必须付费解锁**。核心是"悬念尾 + 损失厌恶"的双重叠加，而不是单纯的情绪高点。

### 4.2 武器 1：`loss_aversion`（错过恐惧）

- **在 block 里怎么拍**：让 **新的威胁 / 人物 / 关键信息** 在末时间片的最后 1–2s 入画。
- **镜头落点**：`A2` 确认镜 或 `A1` 冲击帧（新角色 / 新物件入画） + `B1` 主角反应特写。
- **画面写法**：新元素"已经在这里"（不是"接下来会出现"），主角反应锁在冻帧里。

### 4.3 武器 2：`scarcity`（仅此一次）

- **在 block 里怎么拍**：让场景中出现 **唯一 / 限时** 的标记（门只剩一条缝、最后一班车、倒计时）。
- **镜头落点**：`A3` 证据特写（倒计时 / 门缝 / 印章过期）。
- **画面写法**：稀缺标记放在倒数第 2 时间片，给末时间片留出反应空间。

### 4.4 武器 3：`zeigarnik`（悬念尾 × 已知悬念 + 新悬念）

- **在 block 里怎么拍**：把前面 block 已建立的 1 个悬念 **继续悬** 着，同时抛出 **1 个新悬念**（身份反转 / 关系反转）。
- **镜头落点**：`D1` 定格海报 + `C4` 声切。
- **画面写法**：末时间片画面冻帧，声音提前切到下一拍，制造"未完"感。

### 4.5 组合建议

Conversion 组常见组合：`loss_aversion + zeigarnik`（新威胁 + 悬念未解）。与 T12 `paywall_level == "final_cliff"` 联动，确保 **反转人物入画 + 主角反应镜 + 冻帧** 三要素命中。

## 5. Director/Prompter 如何消费

- **Director**：末 block 末时间片必须冻帧或声切；与 `status_visual_mapping` 的 `delta_from_prev ∈ {up,down_deeper}` 一致，形成方向反转。
- **Prompter**：依赖 Director 分镜稿；末 block 的 `[FRAME]` 段体现冻帧 / 反转入画。

## 6. 反例（禁止的写法）

- ❌ 末时间片让主角"完全释然 / 笑着结束"（观众无动力追更）。
- ❌ 只有台词提悬念，没有视觉冻帧。
- ❌ 一次性抛 3 个新悬念（过载，观众不知道该记住什么）。
