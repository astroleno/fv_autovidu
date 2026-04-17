# SD2Workflow v5 · P2 任务清单（T09–T12）

**优先级：P2（Week 3 完成，可与 P1 并行）**
**日期：2026-04-16**

P2 四项任务共同特征：**Prompter / Director 侧精修**，偏向"临门一脚"的画面语法与转化闭环。前置依赖：T02（schema 冻结）、T03（status_curve）。字段契约以 `07_v5-schema-冻结.md` 为准。

> **v5.0 挡板分层提醒**
> - **硬门**：T11 的 `avsplit_format_check`（四段齐）+ `bgm_no_name_check`。
> - **软门（v5.0）**：T09 `protagonist_shot_ratio_check`（LLM 自估）、T10（Prompter 输出关键词检查）、T12 `paywall_scaffolding_check`（关键词检查）。
> - **v5.1 升级**：T07 `[CODE]` 标记 + T09 精确 `shot_ratio` 均依赖 **T00.5 `shots_contract[]`** 结构化输出，届时一并升为硬门。

---

## T09 · 主角主体性量化（`protagonist_shot_ratio`）

### 背景
v4 的分镜没有对"主角出现时长"做显式约束，部分 block 出现主角戏份过轻或全是对手镜头的情况。v5.0 用**量化目标 + LLM 自估软门**解决；v5.1 依赖 `shots_contract[]` 升为精确计数硬门。

> **v5.0 定位：软门（warning，不阻塞）**
> 原因：Director v5.0 仍输出 markdown，无法像素级或字段级精确计数主角出现时长。LLM 自估容许 ±0.05 容差。v5.1 结构化 `shots_contract[]` 后升硬门。

### 字段契约

- **EditMap 侧（目标值）**：`meta.protagonist_shot_ratio_target`，见 `07_` §二。默认 `overall=0.55 / per_block_min=0.30 / hook_block_min=0.50 / payoff_block_min=0.60`；题材可调。
- **Director 侧（v5.0 软字段）**：`continuity_out.protagonist_shot_ratio_actual`（number，**LLM 自估**）+ `protagonist_shot_ratio_check`（bool，LLM 自评），见 `07_` §三。

### 实施方式（零新切片，纯字段 + prompt 钩子）

- EditMap v5 prompt：

```
# 第 6 步：主角主体性目标（v5 新增）
- 根据题材设定 protagonist_shot_ratio_target.*；
- 对 payoff block 要求 per_block ≥ 0.60；hook block ≥ 0.50。
```

- Director v5 prompt 钩子：

```
# v5.0 新增（软字段）：
# 在每个 block 结束时，根据本 block 全部 shot 估算主角出镜时长占比，
# 写入 continuity_out.protagonist_shot_ratio_actual（0~1 浮点数，精度 0.01）；
# 若估值低于 target：追加 1 个 B1/B2 镜头（≤3s）自纠，重新估值一次；
# 仍低于 → 在 continuity_out.protagonist_shot_ratio_check=false，并写 warning。
```

### 验收（v5.0 软门）
- 每个 block 的 `continuity_out.protagonist_shot_ratio_actual` 存在、是 0–1 的 number。
- hook/payoff block 的 `check == false` 允许出现但需 warning 入 `routing_trace`。
- CI **不阻塞**。

### v5.1 升级预告
- 依赖 **T00.5 `shots_contract[]`**：Director 产出结构化 shot 清单（含 `shot_id / duration_sec / has_protagonist`）。
- 由 pipeline 精确加权计算 `protagonist_shot_ratio_actual_precise`。
- `protagonist_shot_ratio_check` 升为**硬门**（违反 retry）。

---

## T10 · 竖屏镜头语言字典

### 背景
v4 Prompter 仅有 `vertical_physical_rules`（铁律：不旋转、不画外动作等），缺少「竖屏特有的构图/机位/运镜」字典。v5 增切片 `vertical_grammar.md`，只在 `aspect_ratio=9:16` 时条件注入。

### 切片骨架（`prompter/vertical_grammar.md`）

```markdown
# vertical_grammar

<!-- 脱敏声明：本切片源自参考源 B 的竖屏短剧体系，经重写与词表对齐。 -->

## 1. 目的
补充竖屏（9:16）镜头语法，供 Prompter 在 SD2 三段式编译时参考。

## 2. 注入触发条件
match.aspect_ratio == "9:16"（取值来源：meta.video.aspect_ratio，见 07 §八）

## 3. 受控词表引用
position: up/mid/down（沿用 status_position）
shot_code: A*/B*/C*/D*（沿用 shot_codes 字典）

## 4. 内容骨架
### 4.1 安全区
- 上 10%（系统状态栏）+ 下 15%（字幕 / UI 贴纸）必须留空
- 主体视觉重心落在画面垂直 35%–60% 区间

### 4.2 分层构图（竖屏三带）
- 上带（0–33%）：环境/对手/悬念物件
- 中带（33–66%）：主角主体，占比 ≥ 60% 画面高
- 下带（66–100%）：道具 / 手部 / 字幕

### 4.3 运镜建议
- 手持微晃（±2° 内）= 情绪张力 +
- 严禁镜头旋转 / 90° 翻转 / 斜构图
- 垂直推拉 > 水平横摇（横摇在竖屏很突兀）

### 4.4 特写与反打
- 竖屏特写：人脸占比 60–80% 画面高
- 反打：保留主角至少 40% 屏占（避免全对手镜头）

### 4.5 多人同框
- 纵列排布优先于横列
- 最多 3 层景深（前景/中景/背景）
- 横向 ≥ 3 人几乎不可用

### 4.6 与 status_position 联动
- up   ：中带主体大占比 + 平视
- mid  ：三带平衡
- down ：主体下沉到中下带交界 / 四周留出压迫环境

## 5. Director/Prompter 如何消费
Prompter 将 vertical_grammar 对应要点写入 [FRAME] 段；
若 Director 产出违反（如要求"横摇"在 9:16），Prompter 必须纠偏为"垂直推拉"。

## 6. 反例
- ❌ 9:16 下要求"360° 环绕"（运镜空间不够，易露屏边）
- ❌ 竖屏全景多人横排（几乎无可读性）
- ❌ 主角反打时对手占 80% 屏
```

### 验收
- `aspect_ratio=="9:16"` 回归剧本：`routing_trace.applied[]` 含 `vertical_grammar`。
- Prompter 输出的 `[FRAME]` 段不含"横摇 / 90° 旋转 / 5 人横排"等禁止写法（CI 正则挡板）。

---

## T11 · 声画分离四段切模板

### 背景
v4 Prompter 的 SD2 三段式在部分 block 里把 BGM / 环境音 / 对白混在同一段，下游合成不好拆。v5 统一到 `avsplit_template`，Prompter `always` 注入。

### 切片（`prompter/avsplit_template.md`）骨架

```markdown
# avsplit_template

<!-- 脱敏声明：源自参考源 B 的声画分离理念，重写为我们的四段切。 -->

## 1. 目的
统一 Prompter SD2 提示词的声画排版，便于下游分轨合成与复查。

## 2. 注入触发条件
always 注入（所有画幅、所有 block）。

## 3. 受控词表引用
scene_bucket: dialogue/action/ambience/mixed（决定各段落的详细度倾向）

## 4. 内容骨架
### 4.1 四段切格式
[FRAME]  // 画面（主体 / 动作 / 景别 / 运镜 / 光）
[DIALOG] // 对白（原文；无对白写 <silent>）
[SFX]    // 环境音 + 点效（空间感 + 事件音）
[BGM]    // 情绪方向（仅方向：tension / release / suspense / bond / none）

### 4.2 scene_bucket 分支
- dialogue : [DIALOG] 详；[SFX] 弱化（呼吸/翻纸/衣料）
- action   : [FRAME] + [SFX] 详；[DIALOG] 常 <silent> 或短句
- ambience : [FRAME] + [BGM] 详；[DIALOG] 常 <silent>
- mixed    : 按主导 bucket 写；次要 bucket 简写

### 4.3 硬规则
- 四段必须出现（即便是 <silent> / none 占位）
- [DIALOG] 只能包含原剧本对白，不允许自由发挥
- [BGM] 不指定具体曲名 / 风格艺术家 / 乐器细节
- 时长 timecode 只写在 [FRAME] 第一行

## 5. Director/Prompter 如何消费
Prompter 把 Director 的 markdown 编译为 SD2 三段式时，
按本模板将每个 shot 的 payload 切为 4 段；SD2 接收时按段识别。

## 6. 反例
- ❌ 对白 / 音效 / BGM 混写一段
- ❌ [BGM] 写"钢琴 + 弦乐 + 某歌手"
- ❌ [DIALOG] 段加入场景描述
```

### 与 Prompter v5 prompt 的对接

Prompter v5 prompt 仅加一行钩子：

```
# v5 输出格式：每个 shot 必须包含 [FRAME][DIALOG][SFX][BGM] 四段；格式详见 avsplit_template 切片。
```

### 验收
- Prompter 产出 JSON 的 `sd2_prompt` 字段里，每 shot 可被正则 `^\[FRAME\]/^\[DIALOG\]/^\[SFX\]/^\[BGM\]` 四段全匹配。
- `[BGM]` 段只能取受控方向词，禁具名。
- 3 个回归剧本 100% 通过该格式校验。

---

## T12 · 付费关卡脚手架（Cliff 升级）

### 背景
v4 的末 block 只有一个 "CTA 文案 + 定格"，转化力弱。v5 将尾部结构化为**三级悬念脚手架**（soft / hard / final_cliff），对应不同题材/不同单集位置。

### 字段契约

- `meta.paywall_scaffolding`（见 `07_` §二）：`{final_block_id, level, elements.*}`。
- `block_index[末].routing.paywall_level`：受控词 `paywall_level ∈ {"none","soft","hard","final_cliff"}`。

三级定义（与 `02_` §4.1 的 3 份微切片对齐）：

```
soft        : 末镜头定格 + 1 个未答之问
hard        : 末镜头定格 + 关键证据入画 + 主角特写 + 时间截止提示
final_cliff : 末镜头定格 + 反转人物登场 + 主角反应镜 + 画面冻帧 + CTA 文案接入
```

### 切片拆分：3 份微切片（v5 最终）

- `director/paywall/soft.md`（≤ 480 tokens）
- `director/paywall/hard.md`（≤ 480 tokens）
- `director/paywall/final_cliff.md`（≤ 480 tokens）

仅按 `block_index[i].routing.paywall_level` 命中单级注入，避免三级内容同时加载。

各切片内容骨架（以 final_cliff 为例）：

```markdown
# paywall_scaffolding

<!-- 脱敏声明：源自参考源 C 的用户历程转化阶段理念，重写为三级脚手架。 -->

## 1. 目的
把末 block 的 CTA / 悬念尾从"单镜头"升级为"三级结构"，提升完播→下一集留存。

## 2. 注入触发条件
match.paywall_level ∈ {soft, hard, final_cliff}（默认 none 不注入）

## 3. 受控词表引用
paywall_level: none/soft/hard/final_cliff
shot_code: A2/A3/B1/D1/D4（常用收尾编码）

## 4. 内容骨架
### 4.1 soft（适用：非悬疑 / 情感向）
- 末镜头 [D1] 定格海报感画面
- [DIALOG] 含 1 个未答之问（疑问句 / 停顿）
- 不出现时间截止 / 文案 CTA

### 4.2 hard（适用：悬疑 / 情感高潮但未终局）
- 倒数第 2 个镜头 [A3] 关键证据特写入画
- 末镜头 [B1] 主角特写 + 时间截止视觉元素（计时器/日历/门关闭等）
- 可有 CTA 文案，但不写死

### 4.3 final_cliff（适用：反转爆点 / 单集收官）
- 倒数第 2 个镜头 [A2] 反转人物登场
- 末镜头 [B1] 主角反应镜 + 冻帧
- 紧跟 1 行 CTA 文案（"下一集..."）

### 4.4 与 status_curve 的关系
- final_cliff 时：本 block 末尾应该有一次 status_curve 方向反转（如主角刚 up 被再压 down / 反之）
- 反转后"下一集" = 观众留存驱动力

### 4.5 与 info_gap_ledger 的关系
- hard / final_cliff 时：必须保留 ≥ 1 条 `audience.hidden_from_audience` 或 audience `knows` 尚未覆盖 protagonist `knows` 的差项（信息差留给下一集，与 T08 弱覆盖规则联动）

## 5. Director/Prompter 如何消费
Director 按 level 选用对应模板；Prompter 在末 shot 的 [FRAME] 中必须落实"冻帧/计时器/反转入画"等具体视觉元素。

## 6. 反例
- ❌ soft 也塞时间截止 + CTA 文案（失去层次）
- ❌ final_cliff 主角在反转后依旧笑脸（情绪与画面不一致）
- ❌ 把 paywall 放到首 block（hook 位不是收尾位）
```

### 实施要点
- 单集默认 `level = final_cliff`（电商/长剧）或 `soft`（情感向），由 EditMap 根据 `meta.video.genre_hint` 自动判定。
- Director 按命中级别单独注入 1 份微切片（见 `02_` §4.1）。
- `paywall_scaffolding_check` 为**软门**：用关键词匹配做结构抽查（见 `07_` §7.6）。

### EditMap v5 prompt 钩子

```
# 第 7 步：付费悬念级别（v5 新增）
- 根据题材选择 paywall_level；
- 写入 meta.paywall_scaffolding.* 以及 block_index[末].routing.paywall_level；
- final_cliff 必须配合 audience.hidden_from_audience[] 非空（留白给下一集）。
```

### 验收（v5.0 **软门**）
- 末 block 的 `routing.paywall_level` 非 `"none"` 时，对应 1 份微切片被注入（`routing_trace.applied` 可见）。
- final_cliff：末 block 的 Director 产出关键词检查（"冻帧"/"反转"/"反应镜"任命中 2 项）通过率 ≥ 80%。
- hard / final_cliff：`audience.hidden_from_audience[]` 非空（与 T08 联动，软门）。

---

## 二、P2 汇总：文件变动一览

| 文件 | 动作 | 任务 |
|------|------|------|
| `1_EditMap-SD2-v5.md` | 新增 Step 6 / 7（主体性目标 / 付费级别） | T09/T12 |
| `2_SD2Director-v5.md` | 加钩子：`continuity_out` 新增 `protagonist_shot_ratio_actual`（LLM 自估）+ `shot_codes_used[]`（v5.0 软字段） | T07/T09 |
| `3_SD2Prompter-v5.md` | 加"四段切格式"钩子 + `validation_report` 新增 `avsplit_format_check` / `bgm_no_name_check`（硬门） | T11 |
| `4_KnowledgeSlices/prompter/vertical_grammar.md` | 新建 | T10 |
| `4_KnowledgeSlices/prompter/avsplit_template.md` | 新建 | T11 |
| `4_KnowledgeSlices/director/paywall/{soft,hard,final_cliff}.md` | **新建 3 份微切片** | T12 |
| `injection_map.yaml v2.0` | 新增 5 条条目（vertical_grammar + avsplit_template + 3 份 paywall） | T10/T11/T12 |
| `normalize_edit_map_sd2_v5.mjs` | 增 `paywall_scaffolding_check`（软门，关键词匹配） | T12 |
| Prompter pipeline 校验器 | 增 `avsplit_format_check` / `bgm_no_name_check`（硬门，正则） | T11 |
| `docs/v5/_traceability.yaml` | 5 条新切片登记 | T10/T11/T12 |

---

## 三、P2 风险与缓解

| 风险 | 缓解 |
|------|------|
| `protagonist_shot_ratio` 计算易抖动（主角有无进出镜不好量化） | v5 采取 Director 自报 has_protagonist，不做像素级分析；容差 ±0.05 |
| 竖屏切片与物理铁律切片冲突 | 两切片都 always-prompter（铁律）+ conditional（语法）；文本里明确"物理铁律优先" |
| 四段切让 Prompter 输出变长 10–15% | 可接受；若 token 压力大，`[BGM]` 段允许简写为 `<bgm: tension>` |
| `final_cliff` 在文艺片不合适 | EditMap 根据 `genre_hint` 自动降级为 `soft`；allow override |

---

## 四、P2 成功基线（给 06_ 验收用）

- **软门**：`protagonist_shot_ratio_actual`（LLM 自估）在 ≥ 80% payoff block 自评通过；未过 block 打 warning。
- **软门**：9:16 回归剧本的 Prompter 输出关键词扫描未命中「横摇 / 90° 旋转 / 5 人横排」。
- **硬门（T11）**：所有 block 的 `sd2_prompt` 通过 `avsplit_format_check` 正则（四段齐）+ `bgm_no_name_check`。
- **软门**：final_cliff block 视觉三要素齐备（关键词匹配 ≥ 2） + `audience.hidden_from_audience[]` 非空。

---

## 五、P0+P1+P2 合计 12 项的最终形态

v5 发布后系统应具备：

1. **纠错严格**（T01 / T02：术语不再漂移，schema 冻结，`routing_schema_valid` 硬门）
2. **情绪结构化**（T04：20s 闭环 + `emotion_loop_check` 软门）
3. **权力可视化**（T03：`status_curve` + `status_visual_mapping` 切片）
4. **爽点可设计**（T05：三层模型 + 4 份微切片）
5. **心理学可组合**（T06：六功能组 × 12 效应 + 6 份微切片）
6. **镜头可编码**（T07：A/B/C/D 字典 + 4 份微切片；v5.0 软字段，**v5.1 升硬门**）
7. **信息差可账本化**（T08：`actors_knowledge` + `proof_ladder` 支持 `hidden_from_audience` / `retracted`，软门）
8. **主角主体性可量化**（T09：v5.0 LLM 自估软门，**v5.1 精确计数硬门**）
9. **竖屏语法完备**（T10：`vertical_grammar` 切片）
10. **声画分离标准化**（T11：`avsplit_template` 切片 + **硬门 `avsplit_format_check`**）
11. **付费悬念脚手架化**（T12：三级 × 3 份微切片，软门）

**v5.1 Roadmap**：T00.5 `shots_contract[]` 结构化（+2 天独立 PR）→ T07 `[CODE]` / T09 `shot_ratio` 升为精确硬门。

下一篇：`06_v5-验收清单与回归基线.md`。
