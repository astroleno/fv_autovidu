# v6 · 对白保真与 beat 硬锚（P0 任务方案）

**状态：方案设计（Draft）**
**日期：2026-04-20**
**任务编号：T01 / T02 / T03（P0 · 硬门）**
**依赖文档：** `00_v6-升级计划总览.md` · `01_v6-甲方脚本对齐审计报告.md`

---

## 一、问题回顾（一句话）

v5 输出**丢失 95% 以上对白**、**丢失 96% 以上关键视觉动作**。根因：Director/Prompter 只消费了 Normalizer 的 `core_action` 抽象摘要，**没有硬约束去消费 `raw_excerpt` 原文和 `segments[]` 列表**。

---

## 二、T01 · 对白原文强制落地

### 2.1 目标

凡是 `beat_ledger[].segments[].segment_type ∈ {dialogue, monologue, vo}` 的文本，**必须原样（或最多保留说话人前缀 + 原句）** 出现在 Prompter 输出的 `[DIALOG]` 段里。禁止 `<silent>`，禁止"嘴唇开合，无声口型可辨"这类变体，禁止重写语义。

### 2.2 落地点

#### 2.2.1 Prompter v5 主提示词新增铁律 12

```text
【铁律 12（v6 · 对白保真）】
- 凡是本 Block 覆盖的 beat.segments 中 segment_type ∈ {dialogue, monologue, vo}
  的文本，必须原样出现在对应 FRAME 的 [DIALOG] 段。
- 允许的最小变形：
  · 去除编剧批注（括号内的情绪/动作提示，如"（不耐烦）""（心虚）"）
  · 对齐说话人前缀（统一使用 canonical_name + "："）
  · 将 OS / VO 以 (OS) / (VO) 标记
- 禁止：
  · 将对白改为 "<silent>" 或 "口型可辨"
  · 将对白替换为同义重写（如把"你怎么来了"改成"您怎么过来了"）
  · 将多句对白合并成单句概要
- 违反本铁律的 Block 会被硬门拦截（validation_pass = false）。
```

#### 2.2.2 Prompter 输出新增校验字段

在 `prompts/BXX.json` 的 `validation_report` 中新增：

```json
{
  "dialogue_fidelity_check": {
    "expected_segments": ["SEG_007", "SEG_008", "SEG_014", "..."],
    "matched_segments": ["SEG_007", "SEG_008"],
    "missing_segments": ["SEG_014"],
    "rewritten_segments": [],
    "fidelity_ratio": 0.67,
    "pass": false
  }
}
```

#### 2.2.3 Pipeline 层硬门

`call_sd2_block_chain_v5` 在 Prompter 回包后做本地正则匹配：

```python
# 伪代码：对每个 Block 的每条 dialogue segment 做字符串相似度匹配
for seg in block.consumed_segments:
    if seg.type in {'dialogue','monologue','vo'}:
        if not contains_near_match(prompter_output, seg.text, threshold=0.85):
            raise HardGateFail(f"铁律12违反：{seg.seg_id} 对白未落地")
```

匹配阈值 0.85 是为了容忍"去除括号批注"与"说话人前缀归一化"。

### 2.3 异常处理

- 若 Block 在时长约束下**无法容纳**全部对白，允许在 Director appendix 中声明 `dialogue_deferred_to: "B0X"`，把该 segment 推迟到下一个 Block 消费，但整集 `dialogue_fidelity_ratio ≥ 0.95`。
- 若原剧本有"OS" + "VO" 同时发生的复合音轨，Prompter 必须在同一个 FRAME 内写出两行 `[DIALOG]`，分别标 `(OS)` 与 `(VO)`。

---

## 三、T02 · raw_excerpt 覆盖审计

### 3.1 目标

**整集** `segment_coverage_ratio ≥ 0.90`；**单 Block 可低于 0.5，但不得为 0**（说明该 Block 至少消费了一条原文 segment）。

### 3.2 落地点

#### 3.2.1 Normalizer 侧：已有 `segments[]`，无需改动

`normalized_script_package.json` 的 `beat_ledger[].segments[]` 已经按类型列出所有原文段，字段包括 `seg_id / segment_type / text`。

#### 3.2.2 Director v5 主提示词新增消费字段

在 Director 输出的 `appendix` 中新增：

```json
{
  "segment_coverage_report": {
    "block_id": "B02",
    "consumed_segments": [
      { "seg_id": "SEG_007", "segment_type": "dialogue", "consumed_at_shot": 3 },
      { "seg_id": "SEG_008", "segment_type": "dialogue", "consumed_at_shot": 4 },
      { "seg_id": "SEG_009", "segment_type": "descriptive", "consumed_at_shot": 5 }
    ],
    "total_segments_in_covered_beats": 3,
    "consumed_count": 3,
    "coverage_ratio": 1.0
  }
}
```

#### 3.2.3 整集级汇总

`sd2_final_report.json` 新增：

```json
{
  "episode_coverage": {
    "total_segments": 55,
    "consumed_segments": 50,
    "segment_coverage_ratio": 0.909,
    "unconsumed_segment_ids": ["SEG_012", "SEG_016", "SEG_020", "SEG_022", "SEG_027"],
    "pass": true
  }
}
```

未消费的 segments 如果全是 `segment_type=transition`（【切镜】【闪回】之类的纯技术标记），可以豁免；其他类型未消费 → 告警或拦截。

#### 3.2.4 硬门规则（v6.0 · 二层独立校验）

| # | 指标 | 作用域 | 阈值 | 门级 |
|---|------|--------|------|------|
| 1 | `segment_coverage_ratio` | 整集 | **≥ 0.90** | **硬门** |
| 2 | `dialogue_subtype_coverage` | `segment_type ∈ {dialogue, monologue, vo}` 子集 | **= 1.00**（不得缺任何一条） | **硬门**（上位） |
| 3 | `descriptive_coverage` | `segment_type == descriptive` 子集 | 无硬下限，但 `core_action` 已覆盖者可豁免 | 软门（warning） |

- 指标 2 是**上位硬门**：即使 (1) 整集达 0.95，只要 (2) 有任何一条对白类 segment 未消费，pipeline 仍然硬拦（对应 00 号文档 §0 仲裁铁律第 ② 层"保真硬门"）；
- 指标 3 只打警告，允许部分环境描写在时长约束下被合并或省略。

### 3.3 Director 消费优先级（切片里给顺序指引）

在 `4_KnowledgeSlices/director/` 下新增切片 `v6_segment_consumption_priority.md`：

```text
【消费优先级】
P0（必须每镜消费）：
  · dialogue（对白）
  · monologue（内心独白）
  · vo（画外音）
P1（应该消费）：
  · descriptive 中包含动作性动词的段（如"推门""抓住""解开"）
P2（可选消费）：
  · descriptive 纯环境描写段
  · transition 纯技术标记（【切镜】【闪回】）
```

---

## 四、T03 · key_visual_actions 硬锚

### 4.1 目标与职责切分（v6 冻结）

把甲方剧本中**标志性、不可替换的视觉动作**（登场惊艳的高跟鞋、推门撞破、分屏定格等）从"描述性段落"里抽取成结构化列表，让 Director 必须 1:1 消费。

**职责切分**（与 00 号文档 §三、05 号文档 §二对齐）：

| 阶段 | 组件 | 职责 | 版本 |
|------|------|------|------|
| 抽取 | **Normalizer v2** | 规则 + LLM 兜底产 `beat_ledger[].key_visual_actions[]` | **v6.0（本文档）** |
| 编排 | Scene Architect | 基于 Normalizer 抽取结果追加 `suggested_block_id / suggested_shot_role`、视觉 hint 调整 | v6.1（05 号文档） |
| 消费 | Director | 每条 P0 KVA 必须 1:1 映射到具体 shot；产 `kva_consumption_report[]` | v6.0（本节） |
| 可视化 | Prompter | 铁律 13 验证"可视化线索齐全" | v6.0（本节） |

**关键原则**：Scene Architect **不做抽取**，只在 Normalizer 产出基础上做块级编排与视觉 hint。这样"真相源"只在 Normalizer，避免 v6.1 上线前后 KVA 列表出现差异。

### 4.2 Normalizer 扩展

#### 4.2.1 新增字段 `beat_ledger[].key_visual_actions[]`

```json
{
  "key_visual_actions": [
    {
      "kva_id": "KVA_001",
      "source_seg_id": "SEG_004",
      "action_type": "signature_entrance",
      "summary": "一双高跟鞋出现，镜头逐渐上移",
      "required_shot_count_min": 1,
      "required_structure_hints": ["low_angle", "pan_up"],
      "forbidden_replacement": ["普通全景人物登场", "面部直接特写"],
      "priority": "P0"
    },
    {
      "kva_id": "KVA_SPLIT_SCREEN_FINALE",
      "source_seg_id": "SEG_055",
      "action_type": "split_screen",
      "summary": "左屏女主抚腹 / 右屏男反与女反亲热，明暗对比定格",
      "required_shot_count_min": 2,
      "required_structure_hints": ["split_screen", "freeze_frame"],
      "forbidden_replacement": ["单屏悬念", "暗示性未读消息"],
      "priority": "P0"
    }
  ]
}
```

#### 4.2.2 抽取规则（写进 Normalizer prompt）

触发抽取的关键词/句式（任命中一条就抽取）：

| 关键词 | 映射 action_type |
|---|---|
| "高跟鞋""镜头上移""逆光亮相" | signature_entrance |
| "推门""被推开"（物理动作 + 发现） | discovery_reveal |
| "跨坐""解扣""抱入怀""捏下巴""摸肚子""亲唇" | intimate_betrayal |
| "分屏""左屏""右屏" | split_screen |
| "定格""色调一边明一边暗" | freeze_frame / contrast_tone |
| "闪回""【闪回】""【切镜】" | flashback / cross_cut |
| "整理衣领""抓住手" | performative_affection |
| 人名 + "VO" / "（OS）" | inner_voice |

### 4.3 Director 侧硬锚消费

#### 4.3.1 Director 主提示词新增段落

```text
【KVA 消费协议】
- 本 Block 覆盖的 beats 中，key_visual_actions[] 的每一条都必须被消费。
- 消费方式：在对应 Block 的 appendix.kva_consumption_report[] 中写明：
  { "kva_id": "...", "consumed_at_shot": N, "shot_code": "A1|B2|..." }
- 禁止在 forbidden_replacement 列出的方式下"变形消费"。
- priority=P0 的 KVA 未消费 → 本 Block 硬门失败。
- priority=P1 的 KVA 未消费 → 本 Block warning，但需写明 deferred_to_block。
```

#### 4.3.2 appendix 新增

```json
{
  "kva_consumption_report": [
    { "kva_id": "KVA_001", "consumed_at_shot": 1, "shot_code": "A1", "verification": "高跟鞋特写 + 低仰 pan_up" },
    { "kva_id": "KVA_SPLIT_SCREEN_FINALE", "consumed_at_shot": 5, "shot_code": "D1", "verification": "分屏 + 定格 + 明暗对比" }
  ],
  "kva_coverage_ratio": 1.0
}
```

### 4.4 Prompter 侧呼应

Prompter 铁律 13（v6 新增）：

```text
【铁律 13（v6 · KVA 硬锚）】
- 本 Block 的 Director 输出中 kva_consumption_report[] 的每一条，对应 shot 的
  FRAME 段必须写入"可视化验证线索"：
  · split_screen → 必须出现"分屏"或"左屏/右屏"字样
  · freeze_frame → 必须出现"定格"或"静止画面"
  · signature_entrance → 必须出现特写/低仰 + 身体局部（鞋/腿/手）
  · intimate_betrayal → 必须保留原动作主语 + 肢体接触动词
- 违反 → 硬门失败。
```

---

## 五、三条铁律协同流程

```mermaid
flowchart LR
    Script[原剧本] --> Norm[Normalizer v2]
    Norm -->|beat.segments[]| Dir[Director v6]
    Norm -->|beat.key_visual_actions[]| Dir
    Norm -->|beat.raw_excerpt| Dir

    Dir -->|segment_coverage_report| G1{覆盖率<br/>≥ 0.9?}
    Dir -->|kva_consumption_report| G2{KVA P0<br/>全覆盖?}
    Dir -->|markdown_body| Prompt[Prompter v6]

    Prompt -->|dialogue_fidelity_check| G3{对白<br/>≥ 0.85?}
    Prompt -->|kva visualization| G4{可视化<br/>线索齐?}

    G1 -->|是| Pass[通过]
    G1 -->|否| Fail[硬门失败]
    G2 -->|否 P0| Fail
    G3 -->|否| Fail
    G4 -->|否| Fail
    G2 -->|是| Pass
    G3 -->|是| Pass
    G4 -->|是| Pass

    style Fail fill:#ffd6d6,stroke:#c33
    style Pass fill:#e8f5e9,stroke:#2a6
```

---

## 六、改造清单（code-level TODO）

| 模块 | 文件 | 改动 |
|------|------|------|
| Normalizer | `prompt/1_SD2Workflow/0_ScriptNormalizer/…` | `beat_ledger[]` 追加 `key_visual_actions[]` 字段抽取逻辑 |
| Director system prompt | `prompt/1_SD2Workflow/2_SD2Director/2_SD2Director-v5.md` → `…-v6.md` | 新增「KVA 消费协议」+「segment_coverage_report 产出要求」段落 |
| Director 切片 | `4_KnowledgeSlices/director/v6_segment_consumption_priority.md` | 新建 |
| Director 切片 | `4_KnowledgeSlices/director/v6_kva_examples.md` | 新建，给正反例 |
| Prompter system prompt | `2_SD2Prompter-v5.md` → `…-v6.md` | 新增铁律 12/13 + `dialogue_fidelity_check` 输出字段 |
| Pipeline | `call_sd2_block_chain_v5` → `…_v6` | 本地硬门校验（相似度匹配 + 覆盖率统计） |
| Schema | `docs/v6/04_v6-schema-冻结.md`（待建） | 记录新字段契约 |
| 合同文档 | `docs/v5/07_v5-schema-冻结.md` → v6 副本 | 追加新字段定义 |

---

## 七、验收用例（TDD 风格）

### UC-T01-01（对白保真）

**输入**：`normalized_script_package.json` 含 `SEG_007: "护士：刚刚那人是谁啊？我怎么从来没在心外科见过？"`
**Block**：B02 覆盖该 segment
**期望 Prompter 输出**：某个 FRAME 的 `[DIALOG]` 段包含 `护士：刚刚那人是谁啊？` 字样（≥ 85% 相似度）
**当前 v5.0 结果**：❌ 输出为"嘴唇开合，无声但口型可辨"
**v6.0 目标**：✅ 完整落地

### UC-T02-01（覆盖率）

**输入**：整集 55 个 segments
**v6.0 目标**：`segment_coverage_ratio ≥ 0.90`（即至少消费 50 个），其中全部 `dialogue/monologue/vo` 类型必须 100% 消费

### UC-T03-01（KVA 分屏）

**输入**：`KVA_SPLIT_SCREEN_FINALE` 标记在 `BT_008`
**Block**：B10（结尾块）必须消费
**期望 Prompter 输出**：某 FRAME 出现"分屏"关键词 + 至少 2 镜分屏对照
**当前 v5.0 结果**：❌ 替换成"手机未读消息"
**v6.0 目标**：✅ 硬门确保分屏落地

---

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| 对白全部塞入 FRAME 导致 Prompter 输出超长 | 单条对白 > 30 字时允许分多个 FRAME 承接（每 FRAME ≤ 30 字），保留原文完整性 |
| KVA 抽取漏掉非标准句式 | 抽取规则表 4.2.2 持续维护；增加"人工标注通道"，允许甲方脚本在 xlsx 备注列标 `@KVA` 强制标记 |
| 覆盖率 0.90 对极简脚本（如纯空镜开场）过严 | `transition` 类 segments 不计入分母；允许通过 `meta.coverage_ratio_floor` 在 Normalizer 元数据里覆写阈值 |
| 硬门阻塞线上批量跑 | Pipeline 支持 `--allow-v6-soft` 降级开关，在实验阶段把硬门降为 warning |

---

## 九、交付里程碑

| 时间 | 里程碑 |
|------|--------|
| 2026-04-22 | Normalizer 完成 `key_visual_actions[]` 抽取规则 + 单测 |
| 2026-04-23 | Director v6 提示词冻结 + 切片上线 |
| 2026-04-24 | Prompter v6 铁律 12/13 + `dialogue_fidelity_check` 上线 |
| 2026-04-25 | Pipeline 硬门校验 + 降级开关 |
| 2026-04-26 | `leji-v5p` 同剧本重跑 → 验证对白保真 ≥ 95% / KVA 消费 100% / 覆盖率 ≥ 0.90 |
| 2026-04-28 | 与甲方脚本二次对标，出 v6.0 基线报告 |

---

## 十、用户规则对齐

- 每份文件 ≤ 400 行 ✅
- 详尽注释 ✅（本文档 + 代码改动位置明确）
- 先输出流程图后落地 ✅（第 5 节 mermaid）
- CSS padding 涉及 box-sizing: border-box：本任务不涉及 CSS，N/A
- 无 `any`：本任务的 TypeScript 改动均使用具体类型，N/A 示例
