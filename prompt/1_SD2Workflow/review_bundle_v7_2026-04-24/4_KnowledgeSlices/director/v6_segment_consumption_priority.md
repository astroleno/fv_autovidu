# v6 · segment 消费优先级与规划表（Director 知识切片）

> 无条件注入 · 给 Director 判断"本 block 先消费哪些 seg、后消费哪些"的参考表。
> 上游依赖：EditMap v6 `block_index[i].covered_segment_ids[]` + Normalizer v2 `beat_ledger[].segments[]`。

---

## 1 · 优先级梯度（越靠上越先消费）

| 层级 | 类型 | 说明 | 硬门 |
|---|---|---|---|
| P0-A | `segment_type == dialogue / monologue / vo` + 属于 `must_cover_segment_ids` | 对白/独白/旁白原文 | 本 block 必须 1:1 消费；不可推迟 |
| P0-B | `priority == P0` 的 KVA | 标志性动作（高跟鞋登场、令牌掏出、分屏触发等） | 本 block 必须被某 shot 1:1 消费 |
| P0-C | `structure_hints` 中 `split_screen / freeze_frame` | 不可替代的构图锚 | 本 block 必须消费 |
| P1-A | 其他 `dialogue / monologue / vo` | 非必 cover 的对白 | 能消费就消费；否则推 deferred |
| P1-B | `priority == P1` 的 KVA | 可推迟的视觉动作 | 允许推迟到下一 block，但必须标注 |
| P1-C | `segment_type == descriptive` 且承载关键信息点 | 地点/道具/人物状态 | 必须至少 1 个 shot 承接语义 |
| P2-A | 其他 `descriptive` | 氛围/背景描写 | 允许多 seg 压缩成一个 shot 的画面描述 |

## 2 · 规划步骤（推荐顺序）

1. **先锁节奏锚点**：是否命中 golden_open / mini_climax / major_climax / closing_hook；若命中，先按 v6 §A.5/§A.6/§A.7 预留对应 slot。
2. **填 P0-A + P0-B + P0-C**：把 P0 级 seg/KVA/structure_hint 按出现顺序分配到 slot。对白落对白段，动作落画面描述。
3. **填 P1**：P1-A 对白如果装不下，写 `missing_must_cover[].deferred_to_block`；P1-B KVA 同理。
4. **P2 合并**：多条 descriptive 合并成一个 shot 的画面描述长句。
5. **空隙检查**：若 slot 过多而 seg 少（`target_shot_count_range` 偏大），允许一个 seg 拆成两个 shot（如"高跟鞋特写"+"平视脚步"）。

## 3 · 典型冲突仲裁

| 冲突 | 仲裁 |
|---|---|
| P0 KVA 与节奏锚点都要求同一 slot | 合并：该 slot 同时承担 KVA + 节奏锚点（如 `[A1]` 同时是 golden_open 且是"高跟鞋登场"） |
| 对白 seg 总时长 > block `target_shot_count_range × 平均 shot 时长` | 写 `overflow_policy: push_to_next_block`，并在 `missing_must_cover` 标注 |
| 多条对白 seg 属同一说话人连续语 | 允许合并到同一 shot 的对白段（多行，保留每行原文） |
| `descriptive` seg 与 KVA `summary` 语义重复 | 以 KVA 为准，descriptive seg 视为已消费 |

## 4 · 禁止模式（违反将触发铁律 12/13 硬门失败）

- 对白 seg 被改写成同义句；
- 对白 seg 被合并成"若干台词表达冲突"的概述；
- P0 KVA 被"情感特写"替代；
- split_screen / freeze_frame 被"快速剪切"替代。

## 5 · 与 slot 数的关系

本切片只指导**哪些 seg 先落**，不改变 `target_shot_count_range` 与 `v5Meta.shotSlots` 的锁定。若觉得 slot 数不合理 → 让 EditMap / Scene Architect 改上游，不在 Director 内扩 slot。
