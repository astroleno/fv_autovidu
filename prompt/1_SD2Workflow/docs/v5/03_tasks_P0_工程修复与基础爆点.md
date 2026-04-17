# SD2Workflow v5 · P0 任务清单（T01–T04）

**优先级：P0（Week 1 必须完成）**
**日期：2026-04-16**

P0 四项任务共同特征：**低侵入 + 高 ROI**。三项是「对齐/修复/自检」，一项是 v5 新数据结构（`status_curve`）的底座，后续 P1/P2 都会复用。

> **前置**：P0 开工前必须完成 Week 0 全部动作（见 `01_` §7），含存量切片清洗与 3 份 golden sample。
> **字段契约**：所有字段形态以 `07_v5-schema-冻结.md` 为准；本文件只给"任务→字段"的改动清单。

---

## T01 · 时长约束术语对齐（4–15s 唯一口径）

### 背景
v4 已将硬约束定为 `4–15s`，但历史文档、切片示例、合同里仍残留 `5–16s`、`12s+` 等旧说法，导致后续新人或新切片易混乱。

### 修改清单

| 文件 | 动作 |
|------|------|
| `prompt/1_SD2Workflow/1_EditMap-SD2/1_EditMap-SD2-v4.md` | 继承 v4 的 `4–15s`，v5 版 `1_EditMap-SD2-v5.md` 复制后，确认所有 `5-16`、`≥12` 已被清除 |
| `prompt/1_SD2Workflow/4_KnowledgeSlices/director/structure_constraints.md` | 扫描并替换旧阈值；仅保留「单子镜头 ≥ 3s」「冲击帧 2s 例外」「每组 ≤ 5 镜头」 |
| `docs/v5/_traceability.yaml` | 登记"历史合同已冻结 v3.1，v5 只做术语清理" |
| `docs/SD2Workflow-v3.1-接口合同.md`（归档前） | 合同 2「Block 时长规则」段落脚注补一行："自 v5 起，组时长口径统一为 4–15s；本合同 5-16s 版本保留作历史冻结参考。" |

> 注意：**v3.1 合同是冻结文档**，不改正文，只加脚注。

### 正则扫描命令（本地预检）

> 按 `01_` §3.1 **单一真相源**的扫描范围：只扫 `prompt/**` 与 `4_KnowledgeSlices/**`，放行 `docs/**`、`reference/**`、`scripts/**`（白名单行例外）。

```
rg -n '(5[\s-]*16|≥\s*12|group_time_min|group_time_max)' \
   prompt/1_SD2Workflow/prompt \
   prompt/1_SD2Workflow/4_KnowledgeSlices
```

### 验收
- 上述正则 0 命中。
- `1_EditMap-SD2-v5.md` 中 `4` 与 `15` 都以"硬约束"描述。
- v5 回归跑三个剧本，`duration_sum_check` 与 `max_block_duration_check` 均 `true`。

---

## T02 · Schema 冻结 + 路由标签对齐（v5 EditMap 侧唯一新增硬门 H4）

### 背景
v4 中 `match.structural_tags` 在合同/切片里写法不一，EditMap 有时写 `meta.routing.structural_tags`、有时 `meta.routing.structural`。v5 通过 `07_v5-schema-冻结.md` **一次冻结**，后续工程只认 canonical。

### canonical 形态（摘自 07 §二）

- 路由**嵌入** `block_index[i].routing`（不外联，不整片对象），六字段：
  `structural[] / satisfaction[] / psychology[] / shot_hint[] / paywall_level / scene_bucket`。
- **`meta.routing.*` 整体废弃**；`aspect_ratio` 移到 `meta.video.aspect_ratio`。
- `routing_trace[]` 由**编排层**生成，LLM 不写。

### 修改清单

| 文件 | 动作 |
|------|------|
| `4_KnowledgeSlices/injection_map.yaml` | 升级到 v2.0（见 `02_` §五），`match.*` 全量对齐新字段；`max_total_tokens_per_consumer.director = 3000` |
| `1_EditMap-SD2-v5.md` | 输出契约段明确使用 `block_index[i].routing.*`；废弃 `meta.routing.*` 与 `structural_tags` 字段 |
| `2_SD2Director-v5.md` | 读路径改为 `block_index[i].routing.structural[]`（v4 v5 Director prompt 升级一起发） |
| `scripts/sd2_pipeline/normalize_edit_map_sd2_v5.mjs` | **新建**（从 v4 脚本复制），加 v4→v5 兼容层：`structural_tags → routing.structural`；加 `routing_schema_valid` 审计实现 |
| `diagnosis.routing_schema_valid`（硬门） | 按 `07_` §7.1 实现：六字段齐全、类型合法、受控词落点、长度上限 |

### EditMap v5 prompt 追加"钩子"（示意）

```
# 输出契约（v5 追加）
- 每个 block_index[i] 必须包含 routing 对象，六字段完整：
  structural[], satisfaction[], psychology[], shot_hint[], paywall_level, scene_bucket；
- 字段值必须来自受控词表（07_v5-schema-冻结.md §五），禁止新造同义词；
- 无对应标签时填 [] 或 "none"，不要省略字段；
- meta.video 须含 aspect_ratio / scene_bucket_default / genre_hint / target_duration_sec。
```

### normalize 兼容层片段（v5.mjs）

```js
// v5 兼容层（三个月过渡期）
for (const block of appendix.block_index) {
  if (block.structural_tags && !block.routing?.structural) {
    block.routing = block.routing || {};
    block.routing.structural = block.structural_tags;
    delete block.structural_tags;
  }
  // 六字段兜底
  block.routing ||= {};
  block.routing.structural    ||= [];
  block.routing.satisfaction  ||= [];
  block.routing.psychology    ||= [];
  block.routing.shot_hint     ||= [];
  block.routing.paywall_level ||= "none";
  block.scene_bucket          ||= appendix.meta?.video?.scene_bucket_default || "dialogue";
}
```

### 验收
- `injection_map.yaml` 版本号为 `2.0`；`max_total_tokens_per_consumer.director == 3000`。
- 3 个回归剧本的每个 `block_index[i].routing` 均含 6 字段，受控词落点合法。
- `diagnosis.routing_schema_valid == true`（**硬门**：失败即 retry，超阈值丢弃）。
- 编排层产出 `meta.routing_trace[]`，每 block 一条（`applied[]` 非空、`truncated[]` ≤ 3%）。

---

## T03 · 地位跷跷板 `status_curve`（v5 核心新字段）

### 背景
v4 只有情绪强度曲线（`rhythm_curve`），无法表达"谁在上/下"。而权力位的起伏是爽点兑现的必要前提。`status_curve` 一旦有了，T05（爽点兑现）、T08（信息差账本）、T09（主角主体性）、T12（付费脚手架）都能直接消费。

### 字段契约

结构见 `07_v5-schema-冻结.md` §二 `meta.status_curve[]`。要点：

- `position ∈ {"up","mid","down"}`（受控词，见 07 §五）。
- `delta_from_prev ∈ {"up","up_steep","down","down_deeper","stable"}`。
- `antagonists[]` 可多人；如无对手，填空数组。

### 注入侧

新增切片 `director/status_visual_mapping.md`，在 `injection_map v2.0` 中为 `director.always`（见 `02_` 文档表格）。**Director 每次都拿到**，本 block 的 `status_curve[block_id]` 作为 payload 的一部分透传给 Director。

### 切片内容骨架（按 `01_` §5 模板写）

```markdown
# status_visual_mapping

## 1. 目的
把 EditMap 的 status_curve 位置（up/mid/down）翻译成 Director 分镜的景别/机位/光/构图倾向。

## 2. 注入触发条件
always 注入；本 block 的 status_curve[protagonist.position] 决定主角落点，
antagonists[i].position 决定对手落点。

## 3. 受控词表引用
status_position: ["up","mid","down"]

## 4. 内容骨架
位置 | 景别 | 机位 | 光 | 构图 | 禁忌
up | 中/近 | 平视/略低 | 顺光主光偏暖 | 居中占画面 ≥60% | 不俯拍压低
mid | 中/中全 | 平视 | 中性光 | 平衡 | —
down | 近/特写 | 俯拍或略高 | 逆光/顶光压暗 | 偏下/边缘 | 不仰拍抬高

delta 对应的"转变镜头"建议：
- down -> up        : 主角反打 + 慢推近 + 对手景别从近变中
- down_deeper       : 主角被多人环绕镜 + 主角占比骤降
- up -> down        : 主角失控反应镜 + 环境道具入镜压迫

## 5. Director/Prompter 如何消费
Director 在每镜头标注前，先根据本 block 的 position 选择基线景别/机位，再结合 shot_codes（T07）精修。

## 6. 反例
- ❌ 把 down 硬写成俯拍 90° 极端角度（造成 UI 违和）
- ❌ position 与景别矛盾（如 up 却用俯拍）
```

### EditMap v5 prompt 追加"钩子"

```
# 第 0.3 步：地位跷跷板推理（v5 新增）
- 列出全片主角与主要对手；
- 对每个 block 标记 protagonist.position 与 antagonists[].position；
- 要求全片至少出现 1 次 up↔down 翻转（如无，则在 diagnosis.note 中解释为什么）；
- 字段写入 meta.status_curve[]。
```

### 验收
- `meta.status_curve[]` 长度 == `block_index[]` 长度。
- 至少一次 `delta_from_prev ∈ {"up","down_deeper"}` 出现（除非 `diagnosis.note` 标注「慢热/静态片段」）。
- Director 产出的分镜描述与 `status_visual_mapping` 的建议匹配（抽样审）。

---

## T04 · 20s 情绪闭环自检（Step 0.5）

### 背景
v4 有 Step 0 时长拆分自检，保证单 block ≤ 15s；但没有"情绪 5 阶段是否完整"的自检。外部研究包（参考源 C）提出的"20s 情绪闭环：Hook→压迫→锁死→兑现→悬念"在 v5 作为**软自检**落地，不增加硬约束。

### 实施方式（仅 prompt + normalize，不加切片）

#### EditMap v5 prompt 追加段落（Step 0.5，位于 Step 0 之后 Step 1 之前）

```
# Step 0.5 · 20s 情绪闭环自检（v5 新增，仅自检不强制）

对每一个"叙事段"（= 相邻若干 block 组成的 15–25s 情绪单元），
按 hook / pressure / lock / payoff / suspense 五阶段尝试标注：

{
  "loop_id": "L1",
  "span_blocks": ["B01","B02"],
  "stages": {
    "hook":     "B01 前 3s 主角被误解",
    "pressure": "B01 中段 对手加码",
    "lock":     "B02 开头 资源被断",
    "payoff":   "B02 中段 主角反制",
    "suspense": "B02 末 反转者入画"
  },
  "completeness": "full"  // full | partial | missing
}

若本叙事段缺失某阶段，completeness="partial"，并在 diagnosis.notes 中说明
（如"慢热铺垫段允许 partial"）。missing 只用于刻意留白。

产出位置：meta.emotion_loops[]
```

#### normalize 新增检查（软门）

详见 `07_v5-schema-冻结.md` §7.4：

- `emotion_loops[]` 长度 ≥ 2
- 首末 loop `completeness == "full"`
- 其余 loop 中 `full` 占比 ≥ 60%

**软门**：违反只记 warning，不 retry、不阻塞流水线。

### 验收
- `meta.emotion_loops[]` 至少 2 条（通常 4–6 条）。
- `diagnosis.emotion_loop_check == true` 在 3 个回归剧本中至少 2 套通过。
- 首末 loop 的 `completeness == "full"`。

---

## 四、P0 汇总：文件变动一览

| 文件 | 动作 | 任务 |
|------|------|------|
| `1_EditMap-SD2-v5.md` | 复制 v4 → v5，新增 Step 0.3 / 0.5 钩子 + `block_index[i].routing` 契约段 | T02/T03/T04 |
| `2_SD2Director-v5.md` | 读路径从 `block_index[].structural_tags` 改为 `.routing.structural[]` | T02 |
| `scripts/sd2_pipeline/normalize_edit_map_sd2_v5.mjs` | **新建**；含 v4→v5 兼容层、`routing_schema_valid`（硬门）、`emotion_loop_check`（软门） | T02/T04 |
| `4_KnowledgeSlices/injection_map.yaml` | 升级 v2.0：字段重命名 + priority + overflow_policy + director token 3000（见 `02_` §五） | T02 |
| `4_KnowledgeSlices/director/status_visual_mapping.md` | **新建** | T03 |
| `4_KnowledgeSlices/director/structure_constraints.md` | Week 0 已清洗；T01 只做最后回归抽查 | T01 |
| `4_KnowledgeSlices/director/structure_fewshot.md` | Week 0 已清洗；T01 只做最后回归抽查 | T01 |
| `docs/v5/_traceability.yaml` | 新增 status_visual_mapping 条目，来源代号 C | T03 |
| `docs/SD2Workflow-v3.1-接口合同.md` | 合同 2 加脚注（v5 口径） | T01（仅脚注） |
| CI：`01_` §3.1 正则挡板 + `routing_schema_valid` 静态校验 | 新加 | T01/T02 |

---

## 五、P0 风险与回滚

| 风险 | 概率 | 缓解 |
|------|------|------|
| Step 0.5 新钩子让 EditMap 总 token 超限 | 中 | Step 0.5 以"请给出闭环标注（可简短）"方式写，50–80 字/loop |
| `status_curve` LLM 抗拒长 JSON | 低 | 与 `block_index` 一起统一产出；结构简单 |
| `injection_map` 字段改名导致 pipeline 炸 | 高 | normalize 做 1 次"旧名 → 新名"兼容映射；打 warning 不阻塞 |
| 历史切片里残留 `structural_tags` | 中 | 扫描正则 + CI 挡板 |

**回滚**：任何 P0 项可独立回滚；优先回滚顺序 T04 → T03 → T02 → T01（T01 几乎零风险）。

---

## 六、P0 成功基线（给 06_ 验收用）

- EditMap appendix 每 block 产出完整 `block_index[i].routing`（6 字段）+ `meta.status_curve[]` + `meta.emotion_loops[]`。
- `diagnosis` 至少包含：
  - **硬门**（EditMap 侧 H1–H4）：`duration_sum_check`、`max_block_duration_check`、`skeleton_integrity_check`（v4 已有）+ **`routing_schema_valid`**（v5 EditMap 侧新增的唯一硬门）
  - **软门**：`emotion_loop_check`（v5 新增）
- 3 个回归剧本均通过 T01 正则扫描（按 `01_` §3.1 范围）0 命中。
- P0 完成即具备「T05–T08 切片注入」的路由基础。

下一篇：`04_tasks_P1_心理学与镜头字典.md`。
