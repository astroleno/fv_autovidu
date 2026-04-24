# character_want_need

<!-- 消费者：EditMap · 静态挂载（不走 injection_map）· v5.0 -->
<!-- 脱敏：通用编剧方法论本地化改写，不引用任何外部源 -->

## 目的

人物立体化判定：**Want（外在目标）· Need（内在缺口）· 弧光（A→B 不可逆变化）· 矛盾性**。四者共同决定 `psychology_plan.group / effects`、`status_curve.protagonist` 的主体指向、`satisfaction_points` 的兑现时机。缺了这层，心理学组和爽点兑现会失去主角参照。

## 受控词表

- `psychology_plan[].group`：见 `07 §五` + `psychology_group_synonym_map`（允许自由扩展）
- `status_curve[].protagonist.id`：**全片唯一且一致**
- `satisfaction_points[].motif`：见 `07 §五 satisfaction_motif`

## Want vs Need

| 维度 | Want（外在） | Need（内在） |
|---|---|---|
| 角色是否自知 | 知道、主动追求 | 不知道、看不见 |
| 驱动层级 | 本 block 目标 | 全片弧光方向 |
| 与 `delta_from_prev` | 直接原因 | 深层成因 |
| 对应 `satisfaction_motif` | `control / exclusive_favor` | `status_reversal` |

**张力公式**：Want 与 Need 的张力 = 弧光发动机。主角开头追 Want，payoff 要么得到 Need（正向弧光），要么拒绝 Need（悲剧 / 反弧光）。

## 弧光 = A → B 不可逆变化

- **短剧**：一次跳跃，通常在倒数第 2 个 block 完成。
- **长剧**：多次"伪变化"直到真转变。
- 识别不到 A、B 差异 → `diagnosis.notes` 登记 `no_character_arc`。

## 矛盾性（立体最低门槛）

至少一层**外在 vs 内在**的矛盾：

| 外在 | 内在 |
|---|---|
| 自信 / 强势 | 自卑 / 恐惧 |
| 冷漠 / 疏离 | 渴望连接 |
| 顺从 / 弱小 | 掌控 / 复仇 |
| 笑容 / 和善 | 算计 / 利用 |

矛盾性让潜台词有空间（见 `subtext_and_signals`），让 `psychology_plan.effects` 可同时挂多个不冲突效应（如 `masking` + `information_asymmetry`）。

## 主角识别规则

- 主角 = `status_curve[i].protagonist.id`，**全片唯一且一致**（多主角剧本需声明主视角代入方）。
- 主角物理缺席时仍按"主角视角观察"判 `delta_from_prev`——**不把对手得意当 `up`**。
- 主角为见证者 → `satisfaction_points` 可记，但 `trigger.protagonist_role = "observer"`。

## 反例

- ❌ `protagonist.id` 在不同 block 换人
- ❌ 把反派得意 / 反派被偏爱登记为主角 `satisfaction_points`
- ❌ `psychology_plan.effects` 全片清一色单效应（= 没识别矛盾性）
- ❌ `diagnosis.notes` 写长篇人物分析而非关键词
