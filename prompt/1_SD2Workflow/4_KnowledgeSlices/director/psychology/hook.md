# psychology.hook

<!-- 消费者：Director -->
<!-- 注入条件：派生字段 `routing.psychology_group == "hook"` 时注入 -->
<!-- 版本：v5.0（T06 新增） -->
<!-- 脱敏声明：源自参考源 C 的"心理学六功能组"研究包，全部术语与列举重写为 v5 受控词。 -->

## 1. 目的

当本 block 的功能组是 **hook（开场钩子 / 抓眼球）** 时，给 Director 提供 2–3 种心理学效应的 **使用方式与画面落点**，帮助在前 3–8s 内把观众"黏"住。不抄原文，只讲"在 block 里怎么拍"。

## 2. 注入触发条件

`injection_map.yaml v2.0`：

```yaml
- slice_id: psychology.hook
  path: director/psychology/hook.md
  max_tokens: 360
  priority: 40
  match:
    psychology_group:
      any_of: ["hook"]
```

> `psychology_group` 由编排层从 `meta.psychology_plan[block_id].group` 派生，LLM 无感知。

## 3. 受控词表引用

- `psychology_group`: `hook`
- `psychology_effect`: `loss_aversion` / `negative_bias` / `zeigarnik` / `cognitive_dissonance`
- `shot_code_category`: `A_event`、`B_emotion`

## 4. 内容骨架

### 4.1 组任务

前 3s 把异常 / 冲突 / 悬念抛到画面；前 8s 让观众在心里产生 **"接下来会发生什么"** 的紧张感。严禁先铺垫人设或交代背景。

### 4.2 武器 1：`loss_aversion`（损失厌恶）

- **在 block 里怎么拍**：让观众在第 1 秒先看到"主角已经有的东西 / 身份"正在被夺走的瞬间（钥匙被收、工卡被撕、名字被划掉）。
- **镜头落点**：`A1` 冲击帧 1–2s + `A3` 证据特写 2–3s。
- **画面写法**：镜头锁定"失去的那一刻"的物件，不解释原因。

### 4.3 武器 2：`negative_bias`（负面偏好）

- **在 block 里怎么拍**：以"负面事件 / 表情 / 道具"为第一画面，激活观众的风险感受通道。
- **镜头落点**：`B1` 主体特写（负面微表情）或 `A1` 冲击帧（坠落 / 打碎 / 裂开）。
- **画面写法**：避免"主角微笑 / 日常" 开场；选"主角已经陷入困境的那一秒"。

### 4.4 武器 3：`zeigarnik`（未完成张力）

- **在 block 里怎么拍**：主动把一个"动作 / 信息"切在 **未完成的半途**，让观众心里挂住（句子说一半、门开一半、信只读一行）。
- **镜头落点**：`B4` 沉默停顿 或 `C4` 声切。
- **画面写法**：声音或动作先行，画面滞后一拍结束。

### 4.5 组合建议

Hook 组常见组合：`loss_aversion + zeigarnik`（失去一样东西 + 切在半途）。同一 block 效应数 ≤ 2，避免信息过载。

## 5. Director/Prompter 如何消费

- **Director**：前 3s 的第一时间片必须映射到 4.2 / 4.3 / 4.4 之一；与 `status_visual_mapping` 的 `down` 基线一致。
- **Prompter**：依赖 Director 分镜稿，自身不直接消费。

## 6. 反例（禁止的写法）

- ❌ 前 3s 仍是环境建立 / 人设交代（钩子被稀释）。
- ❌ Hook 组同时堆 3–4 种心理效应（观众无法接住）。
- ❌ 钩子靠"旁白告诉观众会出事"（必须靠画面，不靠告知）。
