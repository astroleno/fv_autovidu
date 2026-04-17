# dramatic_action

<!-- 消费者：EditMap · 静态挂载（不走 injection_map）· v5.0 -->
<!-- 脱敏：通用编剧方法论本地化改写，不引用任何外部源 -->

## 目的

给每个 block 做"戏剧动作合格判定"，驱动 `status_curve[i].delta_from_prev` 与 `diagnosis.notes`。没有戏剧动作的 block = 空转节拍，应合并或删除。

## 合格三问

戏剧动作 = **目标（Goal）+ 阻碍（Conflict）**。

1. 目标**有急切性**？（为何是现在、不是明天？）
2. 阻碍与目标**直接对抗**？（不是顺便的不顺利）
3. 删掉此冲突，本 block **是否瞬间塌缩**？

任一问过不了 → `diagnosis.notes` 登记 `weak_dramatic_action`。

## 动作结果 → delta_from_prev

| 本 block 结果 | delta |
|---|---|
| 主角达成目标（夺回 / 反杀 / 获得） | `up`；payoff block 用 `up_steep` |
| 主角受挫（失去 / 被压制 / 信息劣势） | `down`；连续下滑用 `down_deeper` |
| 表层无胜负但筹码 / 信息有结构性变化 | `stable`；首 block 默认 `stable` |

**关键**：情绪走向 ≠ delta。主角在哭但握了关键证据 → 仍是 `up`（看权力 / 筹码，不看情绪）。

## 结构性检查

- **三层汇聚**：block 级微动作 → 段落级动作（3-4 block）→ 全片动作（= `meta.logline`）。无法向上汇聚 = 游离块，合并或重写。
- **开场即态度**：首 block 不是角色第一天，而是张力最大截面；若首 block 只做设定交代、观众产生不了"怎么回事？" → 登记 `hook_missing`（详见 `hook_strategies`）。

## 反例

- ❌ 只写"A 在 X 做 Y"而无急切性
- ❌ 有目标无阻碍 / 阻碍不直接对抗
- ❌ 把情绪下沉当 delta=down
- ❌ `diagnosis.notes` 写散文而非关键词
