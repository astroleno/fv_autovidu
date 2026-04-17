# avsplit_template

<!-- 消费者：Prompter -->
<!-- 注入条件：always（所有画幅、所有 block 都注入） -->
<!-- 版本：v5.0（T11 新增，硬门支撑切片） -->
<!-- 脱敏声明：源自参考源 B 的声画分离理念，重写为我们的四段切。 -->

## 1. 目的

统一 Prompter 输出 `sd2_prompt` 中每个 shot 的声画排版，**将画面 / 对白 / 环境音 / 情绪音乐** 强制拆为四段：`[FRAME] / [DIALOG] / [SFX] / [BGM]`。好处：

1. 下游 SD2 合成端可按段识别、独立分轨；
2. 审计 / 复查 / CI 正则校验便捷；
3. 防止 Prompter 把"钢琴 + 弦乐 + 艺术家 A"这种侵权敏感描述混入画面段。

**本切片配套硬门**：`avsplit_format_check`（四段齐）+ `bgm_no_name_check`（BGM 不含具名词）。

## 2. 注入触发条件

```yaml
- slice_id: avsplit_template
  path: prompter/avsplit_template.md
  max_tokens: 700
  priority: 95
  match: always
```

## 3. 受控词表引用

- `scene_bucket`: `dialogue / action / ambience / mixed`（决定各段落的详细度倾向，取值来源：`block_index[i].routing.scene_bucket` 或 `continuity_in.scene_bucket`）
- `[BGM]` 段受控情绪方向词：`tension / release / suspense / bond / none`（仅此 5 个合法值）
- 占位符：`<silent>`（`[DIALOG]` 段无对白时使用）

## 4. 内容骨架

### 4.1 四段切格式（硬模板）

每个 shot 的 `sd2_prompt` 字段必须 **按此顺序** 出现 4 行 / 4 段（若某段内容为空，使用占位符）：

```
[FRAME]  # 画面：主体 / 动作 / 景别 / 运镜 / 光 / 时长 timecode
[DIALOG] # 对白：原文；无对白写 <silent>
[SFX]    # 环境音 + 点效：空间感（混响 / 湿度 / 距离）+ 事件音（脚步 / 物件碰撞 / 电子提示）
[BGM]    # 情绪方向：仅 {tension, release, suspense, bond, none} 5 选 1；不指定具体曲 / 乐器 / 艺术家
```

**硬规则**（全部是硬门）：

1. **四段必须出现**（含占位符），顺序固定；缺段或乱序 → `avsplit_format_check = false`，整集 retry。
2. **`[DIALOG]` 只允许原剧本对白**；若改写 / 扩写 / 翻译 → 违反 EditMap 对白保留契约。
3. **`[BGM]` 禁具名**：不得出现具体曲名 / 演唱者 / 乐团 / 艺术家 / 乐器品牌；只允许受控方向词（含 `none`）。违反 → `bgm_no_name_check = false`。
4. **`[FRAME]` 第一行** 写时长 timecode（如 `[00:03–00:06]`），同一 shot 内不重复写 timecode。

### 4.2 `scene_bucket` 分支

不同 bucket 下 4 段的**详细度倾向**不同（不改变硬模板）：

| `scene_bucket` | `[FRAME]` | `[DIALOG]` | `[SFX]` | `[BGM]` |
|----------------|-----------|------------|--------|---------|
| `dialogue` | 中 | **详**（原文保留） | 弱化（呼吸 / 翻纸 / 衣料） | 方向词，不需详写 |
| `action` | **详** | 常 `<silent>` 或短句 | **详**（击打 / 摔 / 撞 / 破碎） | 方向词 |
| `ambience` | **详** | 常 `<silent>` | **详**（空间 / 湿度 / 自然音） | 方向词 |
| `mixed` | 按主导 bucket 详写 | 次要 bucket 简写 | 次要 bucket 简写 | 方向词 |

### 4.3 推荐写法范例（仅示例，非具名 IP）

**dialogue bucket（对话主导）**：

```
[FRAME] [00:00–00:04] 近景，平视，固定——A 女低头，手指在桌面无意识敲击。
[DIALOG] A 女：「你真的觉得……我是多虑了？」
[SFX] 室内，低混响；键盘敲击声微弱；远处空调嗡鸣。
[BGM] suspense
```

**action bucket（动作主导）**：

```
[FRAME] [00:05–00:08] 中景，仰视，手持微晃——B 男推开门，冲入走廊。
[DIALOG] <silent>
[SFX] 金属门把快速旋转；脚步疾走；走廊空旷回声；心跳声放大。
[BGM] tension
```

**ambience bucket（氛围主导）**：

```
[FRAME] [00:09–00:13] 大全景，俯视，缓推——A 女独自站在高层落地窗前，城市夜景灯光。
[DIALOG] <silent>
[SFX] 玻璃外高空风声低频；室内空调白噪音；远处车流若隐若现。
[BGM] bond
```

### 4.4 与 `vertical_grammar.md` 联动（9:16）

- 竖屏时 `[FRAME]` 段需体现竖屏三带构图与安全区；禁词（横摇 / 90° 旋转 / 5 人横排 / 360° 环绕）同样在 `[FRAME]` 段生效。
- `[DIALOG] / [SFX] / [BGM]` 三段与画幅无关，格式完全相同。

### 4.5 与 `shot_codes` 的协同

- `[FRAME]` 段允许在首行 timecode 后紧跟 `[CODE]` 标签（如 `[00:03–00:06] [A2] …`），由 Director 产出；Prompter 保留不删，便于下游审计。

## 5. Director/Prompter 如何消费

- **Director**：markdown 不需要按四段写；但镜头描述应**清晰区分"画面 / 对白 / 声音"**，便于 Prompter 编译。
- **Prompter**：
  - 将 Director 产出的每个 shot 编译为严格四段；对缺失项主动补占位符（`<silent>` / `none`）。
  - 若 `[BGM]` 段候选词超出受控 5 词表，替换为最接近的受控方向词，并在 `validation_report.notes` 记录替换。
  - 每 shot 提交前自检 `avsplit_format_check`（四段齐 + 顺序正确 + 占位符合法）。

## 6. 反例（禁止的写法）

- ❌ 对白 / 音效 / BGM 混写一段：`[SCENE] 她说"…"，窗外有风声，背景音乐紧张`。
- ❌ `[BGM]` 段写"钢琴 + 弦乐 + 艺术家 A" / "肖邦某夜曲" / "电子合成器 风格 B"（违反 `bgm_no_name_check`）。
- ❌ `[DIALOG]` 段加入场景描述（如"她低声说——背景是雨夜"）。
- ❌ 段序错乱：`[FRAME] / [SFX] / [DIALOG] / [BGM]`（硬门要求固定顺序）。
- ❌ 缺段（如无 `[BGM]` 行）：`bgm_no_name_check` 前置条件失败。
- ❌ `[FRAME]` 段每行都重复 timecode（只首行一次）。
