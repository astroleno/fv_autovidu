# two_track_pacing

<!-- 消费者：EditMap · 静态挂载（不走 injection_map）· v5.0 -->
<!-- 脱敏：通用编剧方法论本地化改写，不引用任何外部源 -->

## 目的

双轨节奏判定：**外部情节**（事件密度 / 冲突强度 / 信息量）与**内在情感**（角色情感波动）是两条平行轨道，可同步可错位。错位本身是强大叙事工具。EditMap 必须同时识别两轨，才能填精 `emotion_loops` 的 5 阶段（hook / pressure / lock / payoff / suspense）。

## 受控词表

- `emotion_loops[].stages`：`hook / pressure / lock / payoff / suspense`（`07 §五`）
- `emotion_loops[].completeness ∈ {full, partial, missing}`
- `diagnosis.notes` 关键词：`pacing_flat / pacing_double_low / pacing_double_high / pacing_monotone_up / pacing_monotone_down`

## 两条轨道

| 轨道 | 维度 | 紧 / 重（高位） | 松 / 轻（低位） |
|---|---|---|---|
| **外部情节** | 事件密度 + 冲突 + 信息量 | 高密度事件、快剪、追逐、对峙、揭露 | 日常、独处、过渡、沉默 |
| **内在情感** | 角色情感 + 观众投入 | 告白、背叛、失去、恐惧、狂喜 | 调侃、闲聊、安静陪伴 |

**经验法则**：高强度情节后要"呼吸"让观众消化；持续紧张 → 麻木；持续松弛 → 走神。

## 四种错位组合（节奏表达力来源）

| 外部 | 内在 | 效果 | 对应 `emotion_loops.stages` |
|---|---|---|---|
| **松** | **重** | 越平静情感越重（离别前最后一餐） | `lock` / `pressure` 尾段 |
| **紧** | **轻** | 紧张被轻盈包裹（追逐配喜剧音乐） | `hook` / `suspense` 缓冲 |
| **紧** | **重** | 全片顶点（终极对峙） | `payoff` 核心 |
| **松** | **轻** | 纯呼吸（高潮前后过渡） | 相邻 loop 之间过渡 |

两轨完全同步（都紧或都松） → 登记 `pacing_flat`，提示 Director 考虑错位。

## 节奏禁忌（三条）

给每 block 内部打两个 0-3 分（`external_intensity / emotional_intensity`，推理用不必输出），检查：

1. **两条线长时间同时低位** → `pacing_double_low`
2. **两条线长时间同时高位** → `pacing_double_high`（疲劳，高潮不特别）
3. **任一条线单调上升 / 下降无回落** → `pacing_monotone_up / down`

## 与 `emotion_loops` 阶段映射

| `stage` | 外部节奏 | 内在节奏 | 时长（子块内） |
|---|---|---|---|
| `hook` | 紧（或松→紧跳） | 中-重 | 0-3s |
| `pressure` | 中-紧 | 中-重 | 3-10s |
| `lock` | 中（或松） | 重 | 10-15s |
| `payoff` | 紧 | 重（释放） | 15-20s |
| `suspense` | 中（外松情感挂起） | 中 | 20s+ |

**完整性**：5 阶段齐全且时长达标 → `full`；缺 1-2 → `partial`；缺 3+ → `missing`。

## 跨 block loop 规则

- 一个 loop 可横跨 2-3 个连续 block（`span_blocks`）
- **首末 loop `completeness == "full"`**（硬要求）
- 中间 loop 可 `partial`；整体 full 占比 ≥ 60%（S1 软门）

## 反例

- ❌ 所有 block 都"外部紧 + 内在重"（2 分钟观众疲劳）
- ❌ `emotion_loops.length == 1`（= 没有节奏起伏）
- ❌ 首 / 末 loop `completeness == "partial"`（违反硬要求）
- ❌ `stage = hook` 放到非 loop 首 block（hook 只在每 loop 第一 block）
