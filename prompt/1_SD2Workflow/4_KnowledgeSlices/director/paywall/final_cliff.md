# paywall.final_cliff

<!-- 消费者：Director -->
<!-- 注入条件：`block_index[i].routing.paywall_level == "final_cliff"` 时注入 -->
<!-- 版本：v5.0（T12 新增） -->
<!-- 脱敏声明：源自参考源 C 的用户历程转化阶段理念，重写为三级脚手架（本片：final_cliff）。 -->

## 1. 目的

当 **末 block** 命中 `paywall_level == "final_cliff"`（适用于反转爆点 / 单集收官 / 电商长剧等强转化题材）时，指导 Director 把末 block 做成"反转入画 + 主角反应 + 冻帧 + CTA"四段式结构，最大化下一集 / 下一节点的留存与转化。

## 2. 注入触发条件

```yaml
- slice_id: paywall.final_cliff
  path: director/paywall/final_cliff.md
  max_tokens: 480
  priority: 70
  match:
    paywall_level: "final_cliff"
```

## 3. 受控词表引用

- `paywall_level`: `final_cliff`
- `shot_code`: 常用 `A2 / B1 / D1 / D4`（反转确认镜 / 主体特写 / 定格海报 / 特效强调）
- `status_position`: `up / mid / down`

## 4. 内容骨架

### 4.1 final_cliff 四件套

| 位置 | 要素 | 实施 |
|------|------|------|
| 倒数第 2 个时间片 | **反转人物登场** | `[A2]` 确认镜：反转人物入画（从主角背后 / 门口 / 电话那头 等），2–3s |
| 末时间片前段 | **主角反应镜** | `[B1]` 主角特写：瞳孔收缩 / 面色变化 / 手指僵住 等 2–3s |
| 末时间片尾段 | **冻帧** | `[D1]` 画面冻帧 1–2s，形成海报感 |
| 冻帧末（可选） | **CTA 文案接入** | `[FRAME]` 末行：画面右下或下方出现"下一集…"一行小字（不做全屏字幕板） |

### 4.2 final_cliff 的硬性约束

- **必须**在本 block 末尾出现一次 `status_curve` 方向反转（如 `up → down` 或 `down → up`），与 T03 `status_curve` 契约联动。
- 主角反应镜不得使用"笑容 / 轻松"等与反转不一致的表情（见反例）。
- 反转人物**不能**是本集已登场过且已明牌身份的"熟面孔对话对象"（没有反转量）。

### 4.3 与 `info_gap_ledger` 的联动（T08）

- **必须**保留 ≥ 1 条 `audience.hidden_from_audience[]`：反转人物的**动机**或**后续行动**对观众仍然未揭晓。
- 若反转人物"全部底牌"已在本集暴露，请降级为 `paywall_level = hard`。

### 4.4 与 `psychology_group` 的联动（T06）

- final_cliff 的末 block `psychology_group` 推荐为 `conversion`，将"损失厌恶 / 稀缺 / Zeigarnik"三件武器落到本末三件套上（见 `director/psychology/conversion.md`）。

## 5. Director/Prompter 如何消费

- **Director**：末 block 末 3–4 个时间片严格按 4.1 安排，可在 `continuity_out.notes` 标注"final_cliff paywall"。
- **Prompter**：
  - 倒数第 2 shot 的 `[FRAME]` 含"入画 / 出现 / 登场"类关键词 + `[A2]` 语义。
  - 末 shot 的 `[FRAME]` 含 "冻帧 / 定格 / 凝滞 / 静止"（任 1 项）+ "主角特写 / 瞳孔 / 反应"（任 1 项）（软门匹配 ≥ 2 项）。
  - CTA 文案只写作"下一集…"或等价开放式引导句；不写具名 / 付费价格 / 外部 URL。
  - `[BGM]` 可取 `suspense / tension / release`，禁具名。

## 6. 反例（禁止的写法）

- ❌ 反转入画后主角依旧笑脸 / 放松（情绪与画面不一致）。
- ❌ 反转人物是本集反复登场的"领导 / 搭档"且已亮牌（无反转量）。
- ❌ `[FRAME]` 写"全屏倒计时 + 大字付费 CTA + 外链"（破坏画面审美，违反脱敏规范）。
- ❌ 末 shot 没有冻帧，观众在动态中进入下一集引导（转化力骤降）。
- ❌ 本 block 没有 `status_curve` 反转（`final_cliff` 失去"反手一击"的核心）。
