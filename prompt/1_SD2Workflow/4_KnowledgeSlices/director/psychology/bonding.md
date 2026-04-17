# psychology.bonding

<!-- 消费者：Director -->
<!-- 注入条件：派生字段 `routing.psychology_group == "bonding"` 时注入 -->
<!-- 版本：v5.0（T06 新增） -->
<!-- 脱敏声明：源自参考源 C 的"心理学六功能组"研究包，术语与列举已重写。 -->

## 1. 目的

当本 block 的功能组是 **bonding（情感联结 / 共情）** 时，给 Director 2–3 种心理学效应的落点，用于"观众和主角站在同一边"的 block。常见于被误解 / 被辜负 / 被保护等情感节点。

## 2. 注入触发条件

```yaml
- slice_id: psychology.bonding
  path: director/psychology/bonding.md
  max_tokens: 360
  priority: 40
  match:
    psychology_group:
      any_of: ["bonding"]
```

## 3. 受控词表引用

- `psychology_group`: `bonding`
- `psychology_effect`: `reciprocity` / `social_proof` / `scarcity` / `peak_end`
- `shot_code_category`: `B_emotion`、`A_event`

## 4. 内容骨架

### 4.1 组任务

让观众从"观看"转为"代入"。核心手段是给主角一个 **可见的代价 / 付出 / 选择**，让观众愿意替 TA 说话。

### 4.2 武器 1：`reciprocity`（互惠感）

- **在 block 里怎么拍**：主角为配角做一件"超过对方付出"的事（让步、保护、牺牲时间 / 资源）。
- **镜头落点**：`B3` 呼吸拉近（主角不说话的付出瞬间）+ `A3` 证据特写（可见的物件 / 动作）。
- **画面写法**：主角的代价要"看得见"（掏钱、伸手挡、背过身转移注意力）。

### 4.3 武器 2：`social_proof`（社会认同）

- **在 block 里怎么拍**：让多位旁观者 / 同伴对主角做出 **一致的"站边"反应**（赞同、侧耳倾听、挪出座位）。
- **镜头落点**：`A4` 反应连拍。
- **画面写法**：反应不一定要说话，眼神与姿态即可。

### 4.4 武器 3：`scarcity`（稀缺）

- **在 block 里怎么拍**：让主角获得的"理解 / 善意"显得稀少（只有一个人懂 TA、只有一盏灯是开着的、仅剩一次机会）。
- **镜头落点**：`B4` 沉默停顿 + `B1` 主体特写。
- **画面写法**：通过 **环境对比**（其他人都在另一方向）放大稀缺感。

### 4.5 组合建议

Bonding 组常见组合：`reciprocity + social_proof`（主角付出 + 旁观者站边）。避免一次性堆满"稀缺 + 反应连拍 + 主角牺牲"三重效应，会显得用力过猛。

## 5. Director/Prompter 如何消费

- **Director**：本 block 至少 1 个情绪主体沉默时间片（`【密写】`），Prompter 会据此加厚微表情；与 `status_visual_mapping` 协同，position 可为 `mid` 或 `down`。
- **Prompter**：依赖 Director 分镜稿；`【密写】` 段按铁律规范加厚描写。

## 6. 反例（禁止的写法）

- ❌ 主角苦情独白（台词越满，共情越弱）。
- ❌ 多个旁观者反应镜头给了"同情"却没有 **站边动作**（眼神而非行动）。
- ❌ 把 bonding 放在纯动作爆发段（观众没时间共情）。
