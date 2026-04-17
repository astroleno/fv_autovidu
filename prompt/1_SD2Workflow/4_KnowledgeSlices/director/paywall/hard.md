# paywall.hard

<!-- 消费者：Director -->
<!-- 注入条件：`block_index[i].routing.paywall_level == "hard"` 时注入 -->
<!-- 版本：v5.0（T12 新增） -->
<!-- 脱敏声明：源自参考源 C 的用户历程转化阶段理念，重写为三级脚手架（本片：hard）。 -->

## 1. 目的

当 **末 block** 命中 `paywall_level == "hard"`（适用于悬疑 / 情感高潮但未终局 / 需要强留存题材）时，指导 Director 把末 block 做成"证据 + 主角压近 + 时间截止"三件套，比 `soft` 更有留存驱动力，但比 `final_cliff` 克制，**不**强求反转。

## 2. 注入触发条件

```yaml
- slice_id: paywall.hard
  path: director/paywall/hard.md
  max_tokens: 480
  priority: 70
  match:
    paywall_level: "hard"
```

## 3. 受控词表引用

- `paywall_level`: `hard`
- `shot_code`: 常用 `A3 / B1 / D1`（证据特写 / 主体特写 / 定格海报）
- `status_position`: `up / mid / down`

## 4. 内容骨架

### 4.1 hard 的三件套

| 位置 | 要素 | 实施 |
|------|------|------|
| 倒数第 2 个时间片 | **关键证据入画** | `[A3]` 证据特写：物件 / 字迹 / 屏幕截图 / 指纹 等 2–4s |
| 末时间片 | **主角特写 + 时间截止视觉** | `[B1]` 主角特写（1–2s）+ 画面中出现计时器 / 日历 / 门关闭 / 倒数等**视觉元素**（不是硬字幕 CTA） |
| 末时间片收尾 | **定格** | `[D1]` 最后 1–2s 定格海报感画面 |

### 4.2 hard 的细则

- 主角在本末 block 的 `shot_ratio_actual` 不应低于 target（见 T09），建议 ≥ 0.50。
- `[DIALOG]` 段可以有一句短对白提示"信息差"（如"原来…是你…？"），但**不给完整答案**。
- CTA 文案允许但不强制：若有，以 `[FRAME]` 内"画面右下角出现一行小字"形式描述，而非硬切字幕板。

### 4.3 与 `status_curve` 的联动

- **强烈建议**末 block 末尾 `status_delta != 0`，让"证据 + 时间压迫"形成明确的权力/情绪走向变化。
- 若题材压抑：`status_position -> down`，配合 `[B1]` 主角压抑表情。

### 4.4 与 `info_gap_ledger` 的联动（T08）

- **必须**保留 ≥ 1 条 `audience.hidden_from_audience` 或 `audience.knows` 尚未覆盖 `protagonist.knows` 的差项。
- 典型实现：证据特写里出现的字 / 物，观众 **看到但未理解** 其全部含义。

## 5. Director/Prompter 如何消费

- **Director**：末 block 中最后 2–3 个时间片严格按 4.1 安排，可在 `continuity_out.notes` 标注"hard paywall"。
- **Prompter**：
  - 倒数第 2 shot 的 `[FRAME]` 含"特写 / 证据 / 物件"类关键词。
  - 末 shot 的 `[FRAME]` 含"计时器 / 日历 / 倒数 / 门关闭 / 定格"任 1 项 + "主角特写"类关键词（软门匹配词 ≥ 2）。
  - `[BGM]` 可取 `tension / suspense`，禁具名。

## 6. 反例（禁止的写法）

- ❌ hard 末 shot 画面转向反转人物（那是 `final_cliff`）。
- ❌ 证据特写没有任何主角反应衔接（观众不知道怎么看待该证据）。
- ❌ `[FRAME]` 写"画面直接黑屏 + 大字 CTA"（过度硬切，视觉跌落）。
- ❌ 给观众揭晓证据的**完整**语义（那样就没有留存驱动力）。
