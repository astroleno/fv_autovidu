# psychology.retention

<!-- 消费者：Director -->
<!-- 注入条件：派生字段 `routing.psychology_group == "retention"` 时注入 -->
<!-- 版本：v5.0（T06 新增） -->
<!-- 脱敏声明：源自参考源 C 的"心理学六功能组"研究包，术语与列举已重写。 -->

## 1. 目的

当本 block 的功能组是 **retention（留住观众 / 压不住划走）** 时，给 Director 2–3 种心理学效应的落点，用于中段 block：观众已经看了一会儿，此时最怕"节奏塌"导致划走。

## 2. 注入触发条件

```yaml
- slice_id: psychology.retention
  path: director/psychology/retention.md
  max_tokens: 360
  priority: 40
  match:
    psychology_group:
      any_of: ["retention"]
```

## 3. 受控词表引用

- `psychology_group`: `retention`
- `psychology_effect`: `zeigarnik` / `anchoring` / `authority_bias` / `scarcity`
- `shot_code_category`: `B_emotion`、`A_event`、`C_transition`

## 4. 内容骨架

### 4.1 组任务

在叙事中段维持"下一拍即将发生"的预期；任何 block 不应让观众"松一口气"。关键动作：**新信息注入** + **老悬念延长**。

### 4.2 武器 1：`zeigarnik`（未完成张力延长）

- **在 block 里怎么拍**：Hook 或前组已经种下的悬念（某个未解决的问题），本 block 推进半步 + 制造新半步悬念。
- **镜头落点**：`A2` 确认镜 + `B4` 沉默停顿。
- **画面写法**：把"答案"的一半给出来，另一半以新问题接上。

### 4.3 武器 2：`anchoring`（锚定）

- **在 block 里怎么拍**：把一个可视"参考锚"放进画面，用于后续 block 的对比（计时器、日历、血量条、账面数字）。
- **镜头落点**：`A3` 证据特写 2–3s。
- **画面写法**：锚点只给 1 次，不要反复打。

### 4.4 武器 3：`authority_bias`（权威偏好）

- **在 block 里怎么拍**：让权威角色 / 权威符号进入画面，为"接下来发生的事"增加权重。
- **镜头落点**：`B1` 主体特写（权威角色）或 `A3` 证据特写（印章 / 制服 / 徽章）。
- **画面写法**：权威不一定要说话，进入画面即可。

### 4.5 组合建议

Retention 组常见组合：`zeigarnik + anchoring`。严禁用 `scarcity` + `authority_bias` 同时出现（画面会挤）。

## 5. Director/Prompter 如何消费

- **Director**：本 block 必须留 1 次 `B4` 或 `C4` 的停顿 / 声切，让观众"抓到新节点"；不要用 4 个连续推进镜头。
- **Prompter**：依赖 Director 分镜稿。

## 6. 反例（禁止的写法）

- ❌ 只是重复前组信息（观众感知"没进展"）。
- ❌ 一口气抛 3 个新悬念（过载）。
- ❌ 把锚点反复塞进每个时间片（弱化效果）。
