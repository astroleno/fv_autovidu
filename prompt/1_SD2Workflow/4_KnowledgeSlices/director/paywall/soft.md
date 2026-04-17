# paywall.soft

<!-- 消费者：Director -->
<!-- 注入条件：`block_index[i].routing.paywall_level == "soft"` 时注入；默认 `none` 不注入 -->
<!-- 版本：v5.0（T12 新增） -->
<!-- 脱敏声明：源自参考源 C 的用户历程转化阶段理念，重写为三级脚手架（本片：soft）。 -->

## 1. 目的

当 **末 block** 命中 `paywall_level == "soft"`（适用于情感向 / 生活向 / 非悬疑题材）时，指导 Director 把末 block 的 CTA / 悬念尾做成"留白式" 定格 + 未答之问。**避免**情感向作品强塞时间截止与付费 CTA 文案，破坏观看情绪。

## 2. 注入触发条件

```yaml
- slice_id: paywall.soft
  path: director/paywall/soft.md
  max_tokens: 480
  priority: 70
  match:
    paywall_level: "soft"
```

## 3. 受控词表引用

- `paywall_level`: `soft`
- `shot_code`: 常用 `D1 / B1 / B4`（定格海报 / 主体特写 / 沉默停顿）
- `status_position`: `up / mid / down`（与 `status_curve` 联动）

## 4. 内容骨架

### 4.1 soft 的三要素

| 要素 | 必要性 | 实施 |
|------|------|------|
| **末镜头定格** | 必须 | 最后 1 个时间片使用 `[D1]` 定格海报感画面，时长 1–2s |
| **未答之问** | 必须 | `[DIALOG]` 段含一句开放式疑问句或 `<silent>` 但画面留下疑问载体（一只未接的电话 / 未签的文件 / 未说完的话） |
| **情绪停留** | 必须 | 倒数 2 个时间片内，至少 1 个 `[B1]` 或 `[B4]`，让观众停在情绪里 |

### 4.2 soft 的三禁止

- ❌ 不出现时间截止视觉元素（计时器 / 倒计时 / 日历）。
- ❌ 不出现硬性 CTA 文案（"下一集见"/"点击继续"）。
- ❌ 不出现反转人物登场（那是 `final_cliff` 的位置，见 `paywall/final_cliff.md`）。

### 4.3 与 `status_curve` 的联动

- 末 block 末尾 `status_position` 可以停在 `up` / `mid` / `down` 任一位置。
- **建议**：不要与上一块保持同向完全平行，至少 `status_delta != 0`，让留白有方向感。

### 4.4 与 `info_gap_ledger` 的联动（T08）

- soft 级别**不强制**保留 `audience.hidden_from_audience[]`；未答之问的载体多来自**角色之间**的信息差而非**观众**的信息差。

## 5. Director/Prompter 如何消费

- **Director**：末 block 的最后 1 条时间片写明 `[D1]`、第二到最后 1 条至少有 `[B1]` 或 `[B4]`，将 4.1 三要素落到 markdown；可在 `continuity_out.notes` 记录"soft paywall"。
- **Prompter**：
  - 末 shot 的 `[FRAME]` 必须含"定格 / 海报感 / 静止 / 停"等关键词（软门匹配词之一）。
  - `[DIALOG]` 若为 `<silent>` 需在 `[FRAME]` 段补画面提示（如"未接来电屏幕亮起"）。
  - `[BGM]` 可取 `bond / suspense / none`，禁具名。

## 6. 反例（禁止的写法）

- ❌ soft 级末镜头放爆炸 / 撞车类 `A1` 冲击帧（与 soft 气质不符）。
- ❌ `[DIALOG]` 给观众完整答案（"原来一切都是他安排的"——这是 hard/final_cliff 才揭示）。
- ❌ 在 `[FRAME]` 写"画面快速缩放 + 时间倒计时 + 大字 CTA"（结构越界）。
