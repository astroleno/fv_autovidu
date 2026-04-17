# subtext_and_signals

<!-- 消费者：EditMap · 静态挂载（不走 injection_map）· v5.0 -->
<!-- 脱敏：通用编剧方法论本地化改写，不引用任何外部源 -->

## 目的

两件事：
1. **视听化识别**——剧本情感 / 意图是否可被摄影机拍出（Show Don't Tell）。不可拍 = 哑 block。
2. **爽点触发信号识别**——把情节信号映射到 `satisfaction_motif × trigger`，填 `satisfaction_points[]` 与 `block_index[i].routing.satisfaction`。

爽点漏报 → Director 没反打素材；爽点主体错判 → 全片情感线崩塌。

## 受控词表

- `satisfaction_motif`：`status_reversal / control / exclusive_favor / instant_justice`（`07 §五`）
- `satisfaction_trigger`：按 motif 分桶（`07 §五`）
- `trigger.protagonist_role ∈ {actor, observer}`

## Show Don't Tell · 三条红线

1. ❌ 写心理描写（"他觉得 / 她意识到"）——进不了 Director 分镜。
2. ✅ 情感必须可被**看见 / 听见**（动作 / 台词 / 物件）。
3. ✅ 对话遵循冰山原则；直白对话 → 标 `on_the_nose_risk`。

**简易校验**：删光台词观众还懂大概发生了什么吗？懂 → 达标；不懂 → 该 block 依赖台词解释。

## 爽点信号 → `motif × trigger` 映射

> **前置**：执行主体必须是**主角 / 我方**；否则不登记（见下方反例表）。

| 剧情信号 | `motif` | `trigger` |
|---|---|---|
| 被贬低者公开反杀 / 被羞辱者反制 | `status_reversal` | `public_humiliation_reverse` |
| 丢失的资源 / 关系 / 身份被归还 | `status_reversal` | `resource_deprivation_return` |
| 主角利用规则漏洞 / 程序正义碾压 | `control` | `rule_exploitation` |
| 主角划清人际 / 道德边界（拒绝 / 拒付） | `control` | `boundary_setting` |
| 主角独享资源 / 知情权 / 情感偏爱 | `exclusive_favor` | `info_gap_control` |
| 权威公开站队主角 | `exclusive_favor` | `authority_endorsement` |
| 恶行者 ≤3 shot 内付出**物化**代价 | `instant_justice` | `cost_materialized` |
| 主角见证他人反击（主角不出手） | `instant_justice` | `cost_materialized`（role=observer） |

## 主体反例（严禁登记为主角爽点）

| 错误情形 | 正确处理 |
|---|---|
| 反派长辈偏爱反派 | 不记爽点；可进 `proof_ladder`（反派筹码） |
| 主角当众被羞辱、无力反击 | 不记；进 `status_curve.position = down` |
| 主角忍气吞声进敌营 | 不记；这是压迫 block，不是 control |
| 主角敌人受挫但主角没做事 | 可选记 + `role = observer` |

## 一句话红线

**若登记了 `satisfaction_points`，则 `status_curve[i].protagonist.position ≥ mid` 且 `delta_from_prev ∈ {up, up_steep}`**。不一致 = 主体或结果误判，回头重审。

## 密度下限

- 8–10 block 剧本，`satisfaction_points ≥ 2`；低于 2 条在 `diagnosis.notes` 写理由（如 `low_sugar_suspense_focused`）。
- payoff block（倒数第 2-3 个）几乎必有爽点；没有 → 应明确是"纯悬念剧"。

## 反例

- ❌ 反派得意 / 反派被偏爱登记为主角爽点
- ❌ "主角将会反击"（预期）登记为已兑现（兑现必须**发生在本 block 内**）
- ❌ 单 block ≥ 2 条爽点（每 block ≤ 1）
- ❌ 同一 motif 在剧本中出现 ≥ 4 次（疲劳）
