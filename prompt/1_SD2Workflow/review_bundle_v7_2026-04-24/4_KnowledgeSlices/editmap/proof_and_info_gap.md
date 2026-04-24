# proof_and_info_gap

<!-- 消费者：EditMap · 静态挂载（不走 injection_map）· v5.0 -->
<!-- 脱敏：通用编剧方法论本地化改写，不引用任何外部源 -->

## 目的

两个结构化登记方法：
- **信息差账本（`info_gap_ledger`）**：每 block 登记"谁知道什么"。观众与主角 / 对手之间的信息差大小决定悬念张力。
- **证据链阶梯（`proof_ladder`）**：事件真相从"传闻"到"自证"分层登记，决定观众对"是不是真的"的信任度演化。

**信息差造悬念 · 证据链消悬念**。两者不完整，剧本会"流水账"或"哪里不对说不上来"。

## 受控词表

- `info_gap_ledger[].actor ∈ {"protagonist", "antagonist_<name>", "npc_<name>", "audience"}`（`07 §五`）
- `proof_level ∈ {"rumor", "physical", "testimony", "self_confession"}`（**严格词表**）
- `proof_ladder[].retracted ∈ {true, false}`（悬疑剧专用，允许证据被推翻）

## 信息差设计 · 观众视角优先

以**观众**为中心参照（不是主角）：

| 关系 | 谁知什么 | 张力来源 |
|---|---|---|
| **观众 = 主角** | 同步获取 | 代入感、共同探索 |
| **观众 > 主角** | 观众知道主角不知道的事 | 紧张（"快跑！"） |
| **观众 < 主角** | 主角知道但对观众隐瞒 | 反转 / 悬念最终揭晓 |
| **观众 > 对手** | 观众看穿反派、主角还不知 | 焦虑 + 期待反杀 |

`audience.hidden_from_audience[]` 是**设计工具**——悬疑 / 反转剧对观众隐藏主角信息是合法的，不是 bug。

## 弱覆盖规则（S2 软门 · 放宽版）

对每 block：

```
audience.knows ∪ audience.hidden_from_audience ⊇ protagonist.knows
```

即：**主角知道的所有信息，观众要么同步获得，要么被显式标记为"对观众隐藏"**。违反 → S2 告警 `info_gap_check_failed`。悬疑剧 `hidden_from_audience` 非空不视为违规。

## 证据链四级

| `level` | 语义 | 常见信号 | 信任度 |
|---|---|---|---|
| `rumor` | 传闻 / 道听途说 | "听说…"、二手信息 | 低 |
| `physical` | 物证 / 痕迹 | 照片、文件、录音、创伤、财物流向 | 中 |
| `testimony` | 直接证词 / 现场见证 | 目击者陈述、视频直接拍到 | 中-高 |
| `self_confession` | 当事人亲口承认 | 反派自曝动机、主角自证 | 高（顶级） |

## 单调上升（允许回撤）

**非 retracted 条目**的 `level` 序列必须单调不降：

```
B01 rumor → B03 physical → B05 testimony → B07 self_confession  ✅
B01 physical → B03 rumor                                        ❌（除非 B01 retracted）
```

**悬疑剧允许推翻**（`retracted: true` + `retract_reason`）。被推翻条目**不计入**单调性与覆盖率。

## 贯穿下限（S11 软门）

- **非悬疑剧**（`genre_hint ∉ {mystery, suspense}`）：
  - 有非 retracted 条目的 block 数 ≥ `0.6 × block_count`
  - 全片非 retracted 条目 `max_level ≥ testimony`
- **悬疑剧**：允许覆盖率 < 60%，但必须至少一次 `rumor → physical / testimony` 爬升（否则"纯雾里看花"观众弃剧）。
- **特例**：末 block 是 `final_cliff` 悬念尾不要求条目。

违反 → S11 告警 `proof_ladder_coverage_insufficient`。

## 双账本联动

- 信息差**解除**（audience 从不知到知）通常伴随 `proof_ladder` **爬升**。
- 最强反转：`hidden_from_audience` 某条被揭晓为 `self_confession`，同一 block 完成"观众秒懂前情 + 证据拉满"。

## 反例

- ❌ 用 `rumor / physical / testimony / self_confession` **之外**的自由词
- ❌ `proof_ladder` 整体单调下降（非悬疑剧）
- ❌ 悬疑剧为"让 check 过"把对观众隐藏的信息塞进 `audience.knows`（欺骗审计）
- ❌ `info_gap_ledger` 缺 `actor = "audience"` 条目
- ❌ `genre_hint = social_drama / realism` 但 `proof_ladder` 一条都没有
