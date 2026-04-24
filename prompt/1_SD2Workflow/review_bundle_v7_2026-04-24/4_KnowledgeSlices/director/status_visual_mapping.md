# status_visual_mapping

<!-- 消费者：Director -->
<!-- 注入条件：always（每次 Director 调用都注入） -->
<!-- 版本：v5.0（T03 新增） -->
<!-- 脱敏声明：源自参考源 C 的"地位跷跷板"视觉化理念，术语与字段重写为 v5 canonical。 -->

## 1. 目的

把 EditMap 的 `meta.status_curve[]`（地位跷跷板）的位置值（`up / mid / down`）翻译为 Director 分镜级的 **景别 / 机位 / 光影 / 构图** 倾向。Director 每组在"调度前置分析"阶段读取本切片，再结合 `structure_constraints`（硬约束）、`shot_codes/*`（语汇）落笔。

## 2. 注入触发条件

`injection_map.yaml v2.0`：

```yaml
- slice_id: status_visual_mapping
  path: director/status_visual_mapping.md
  max_tokens: 500
  priority: 15      # always，在 structure_constraints 之后、conditional 之前
```

Director 每次调用必带。payload 包含本 block 对应的 `meta.status_curve[i]`（含 `protagonist.position` / `antagonists[].position` / `delta_from_prev`）。

## 3. 受控词表引用

- `status_position`: `["up","mid","down"]`（见 `07_v5-schema-冻结.md §五`）
- `status_delta`: `["up","up_steep","down","down_deeper","stable"]`
- 景别枚举：`全景 / 中景 / 近景 / 特写 / 大特写`

## 4. 内容骨架

### 4.1 位置 → 视觉基线

| position | 景别基线 | 机位 | 光 | 构图 | 禁忌 |
|----------|---------|------|----|----|------|
| `up` | 中景 / 近景 | 平视 or 略低 | 顺光为主，暖色偏主光 | 人物居中，占画面 ≥ 60% | 不要俯拍压低；不要逆光剪影 |
| `mid` | 中景 / 中全景 | 平视 | 中性光 | 三分法平衡 | 不要极端角度 |
| `down` | 近景 / 特写 | 俯拍 or 略高 | 逆光 / 顶光压暗 | 人物偏下 / 偏画面边缘 | 不要仰拍抬高；不要正面顺光美化 |

> 本表只给"基线"。若本 block 的 `routing.shot_hint[]` 命中具体大类（A/B/C/D），最终景别以镜头编码切片为准；本切片用来**限定方向**，不限定具体编号。

### 4.2 `delta_from_prev` → 转变镜头建议

| delta | 推荐转变手段 | 主角表现 | 对手表现 |
|-------|------------|---------|---------|
| `up` / `up_steep` | 主角反打 + 慢推近 | 景别从近 → 特写，暖光补上 | 对手景别从近 → 中，被动反应镜 |
| `down` / `down_deeper` | 主角被多人 / 环境包围镜 | 主角占比骤降，顶光压暗 | 对手景别拉近，控制画面中心 |
| `stable` | 平衡切镜，景别差 ≤ 1 档 | — | — |

### 4.3 与 `emotion_loops` 五阶段的协同

| loop stage | 建议 position 落点 |
|-----------|-------------------|
| `hook` | 主角一般 `down` 或 `mid`（先陷入） |
| `pressure` | 主角 `down`，对手 `up` |
| `lock` | 主角 `down_deeper`（动弹不得的一刻） |
| `payoff` | 主角至少 `mid`，优先 `up` |
| `suspense` | 主角 `mid` + 新的 up/down 种子 |

## 5. Director/Prompter 如何消费

- **Director**：在【调度前置分析】的"权力关系 → 光影基准"环节，按本切片挑基线；与 `structure_constraints` 的硬时长约束、`shot_codes/*` 的镜头编号共同构成本 block 的视觉设计。
- **Prompter**：不直接消费本切片；通过 Director 分镜稿里的景别 / 机位 / 光影描写间接落地。

## 6. 反例（禁止的写法）

- ❌ `down` 却用仰拍 + 暖色顺光（把失势角色拍得像胜利者）。
- ❌ `up` 却用大俯拍 + 逆光（把胜者拍得狼狈），与 `payoff` 场景语义冲突。
- ❌ 连续 3 个 block 的 `delta_from_prev == stable` 但同景别（观众感知"没事发生"）。
- ❌ 把 `status_curve` 与 `rhythm_tier`（节奏档位）混为一谈：position 描述权力，tier 描述情绪烈度，两个维度独立。
