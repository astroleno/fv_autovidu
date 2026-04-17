# psychology.relationship

<!-- 消费者：Director -->
<!-- 注入条件：派生字段 `routing.psychology_group == "relationship"` 时注入 -->
<!-- 版本：v5.0（T06 新增） -->
<!-- 脱敏声明：源自参考源 C 的"心理学六功能组"研究包，术语与列举已重写。 -->

## 1. 目的

当本 block 的功能组是 **relationship（人物关系张力）** 时，给 Director 2–3 种心理学效应的落点。常见于两人冲突 / 权力拉扯 / 暧昧推进的 block。

## 2. 注入触发条件

```yaml
- slice_id: psychology.relationship
  path: director/psychology/relationship.md
  max_tokens: 360
  priority: 40
  match:
    psychology_group:
      any_of: ["relationship"]
```

## 3. 受控词表引用

- `psychology_group`: `relationship`
- `psychology_effect`: `anchoring` / `cognitive_dissonance` / `reciprocity` / `sunk_cost`
- `shot_code_category`: `B_emotion`、`A_event`

## 4. 内容骨架

### 4.1 组任务

在 2 人或 3 人之间建立 **可被观众感知的张力差**。核心是"谁在让步 / 谁在拒绝 / 谁在挑衅"三件事之一。

### 4.2 武器 1：`anchoring`（关系锚点）

- **在 block 里怎么拍**：设一个 **可重复出现的关系标记**（戒指、名牌、合照、一句口头禅），在本 block 让它第一次/再次出现。
- **镜头落点**：`A3` 证据特写 + `B1` 主体特写（角色对它的反应）。
- **画面写法**：锚点不解释，只被看见。

### 4.3 武器 2：`cognitive_dissonance`（立场冲突）

- **在 block 里怎么拍**：让一方说出与过去立场相反的话；让另一方的表情显示"察觉到了"。
- **镜头落点**：`B2` 眼神反打。
- **画面写法**：反打至少 3s，不要快切跳过。

### 4.4 武器 3：`sunk_cost`（沉没成本）

- **在 block 里怎么拍**：让一方提及 **过去已付出的代价**（时间 / 关系 / 机会），以此为由拒绝改变当下立场。
- **镜头落点**：`B3` 呼吸拉近。
- **画面写法**：不要用闪回堆砌过去，用一个道具或一句短台词带出。

### 4.5 组合建议

Relationship 组常见组合：`anchoring + cognitive_dissonance`。暧昧向题材可用 `reciprocity + anchoring`（互惠 + 关系锚点）。

## 5. Director/Prompter 如何消费

- **Director**：本 block 至少 1 次 `B2` 眼神反打，位置不晚于 block 中段；与 T07 shot_codes 的 B 类切片联动。
- **Prompter**：依赖 Director 分镜稿。

## 6. 反例（禁止的写法）

- ❌ 通篇快切，不给任何反打留足时间。
- ❌ 关系锚点靠台词反复提（应是一个可视物件）。
- ❌ 沉没成本通过闪回整段展开（拖节奏；用一个道具 + 一句短台词替代）。
