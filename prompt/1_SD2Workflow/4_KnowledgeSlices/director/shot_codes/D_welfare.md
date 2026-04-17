# shot_codes.D_welfare

<!-- 消费者：Director -->
<!-- 注入条件：`block_index[i].routing.shot_hint[]` 含 `D_welfare` 时注入 -->
<!-- 版本：v5.0（T07 新增） -->
<!-- 脱敏声明：源自参考源 C 的镜头大类理念，编号与字典为 v5 重建。 -->

## 1. 目的

当本 block 命中 **D 类（福利 / 炫技）** 时，给 Director 本大类 4 个具体编号的字典。D 类只在 **爽点兑现 / 末镜 / 角色高光** 时使用，不是常规 block 的标配。

## 2. 注入触发条件

```yaml
- slice_id: shot_codes.D_welfare
  path: director/shot_codes/D_welfare.md
  max_tokens: 240
  priority: 50
  match:
    shot_hint:
      any_of: ["D_welfare"]
```

## 3. 受控词表引用

- `shot_code_category`: `D_welfare`
- 编号：`D1 / D2 / D3 / D4`。

## 4. 内容骨架

### 4.1 4 个编号字典

| 编号 | 名称 | 语义 | 建议时长 | 典型景别 |
|------|------|------|---------|---------|
| `D1` | 定格海报 | 高光瞬间冻帧，海报感画面 | 1–2s | 中景 / 近景 |
| `D2` | 跟拍走位 | 追随主角连续位移 | 3–5s | 中景 |
| `D3` | 炫技运镜 | 较复杂运镜（弧线 / 升降 / 环绕） | 4–6s | 中 → 近 / 中 → 全景 |
| `D4` | 特效强调 | VFX 点缀（光斑 / 灰尘 / 粒子） | 2–3s | 近景 / 特写 |

### 4.2 Director 使用规范

- 每个时间片起始标记：例 `[D1] 中景，平视，固定——…`。
- 本 block 使用的编号写入 `continuity_out.shot_codes_used[]`。
- **竖屏（9:16）** 时：`D3` 禁用"360° 环绕" / 长横摇（见 `prompter/vertical_grammar.md §6`）。
- **每 block D 类编号合计 ≤ 1**（避免"糖分过高"）。

### 4.3 组合禁忌

- ❌ 多个 D 类连用（如 `D1 + D3 + D4`），观众出戏。
- ❌ 在非爽点 / 非末镜 / 非高光 block 使用 D 类。
- ❌ `D4` 反复使用相同 VFX（粒子 / 光斑）在整集里打散（观众审美疲劳）。

### 4.4 典型组合

- 爽点兑现：`A4 + D1`（反应连拍 + 定格海报）。
- 角色高光：`D2` 跟拍 + `B1` 主角特写。
- 末镜（final_cliff）：`A2` 反转入画 + `B1` 主角反应 + `D1` 冻帧。

## 5. Director/Prompter 如何消费

- **Director**：严控 D 类出现次数；优先用于 `satisfaction_motif != "none"` 的 block。
- **Prompter**：`[D1]` 提示 Prompter 在 `[FRAME]` 段明确"冻帧 / 海报感"；`[D4]` 在 `[SFX]` 段可补点 VFX 语气词。

## 6. 反例（禁止的写法）

- ❌ 日常对话 block 使用 `D3` 炫技运镜（不合时宜）。
- ❌ `D1` 时长超过 3s（定格过长 → 节奏塌）。
- ❌ `D4` VFX 描述写成"画面变得华丽"（无具体粒子 / 光斑 / 烟雾指向）。
