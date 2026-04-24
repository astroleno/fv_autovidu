# Doubao vs Qwen · leji-v6h 对照报告

> 对照条件：同一份 `edit_map_sd2.json` + `normalized_script_package.json` + `edit_map_input.json`（leji-v6h 豆包轮次产出，两侧均 `--skip-editmap`）
> - Doubao: `provider=doubao_ark`, `model=doubao-seed-2-0-pro-260215`
> - Qwen: `provider=dashscope_qwen`, `model=qwen-plus`
> - HOTFIX L/M/N/O/P/Q 全开，无降级 flag

## 1 · 宏观产物一致性

| 指标 | Doubao | Qwen |
|---|---|---|
| blocks | 16 | 16 |
| total shots | 39 | 39 |
| shots/block 分布 | `{1: 2, 2: 7, 3: 5, 4: 2}` | `{1: 2, 2: 7, 3: 5, 4: 2}` |
| shot 对象字段 | `['covered_segment_ids', 'duration', 'end_sec', 'info_delta', 'sd2_prompt', 'shot_idx', 'start_sec']` | `['asset_usage', 'director_code_passthrough', 'duration', 'duration_sec', 'five_stage_role', 'info_delta', 'kva_consumed', 'sd2_prompt', 'shot_idx', 'timecode']` |

**关键结论**：
- 两模型 Director 分镜结构**完全一致**（39 shots / 16 blocks / 同 shots-per-block 直方图）→ Director 阶段在这组输入上不是变量
- **Qwen 完整遵守 v6 新 schema**（`timecode` / `duration_sec` / `info_delta` / `five_stage_role`）；**Doubao 回退到 v5 旧 schema**（`start_sec` / `end_sec`），下游结构化消费时 qwen 零胶水代码，doubao 需额外解析

## 2 · v6 硬门通过/失败分布（全 16 block）

| 硬门 | Doubao (pass/fail) | Qwen (pass/fail) | 说明 |
|---|---:|---:|---|
| Director · 段覆盖 | 15/1 | 13/3 |  |
| Director · KVA 覆盖 | 9/7 | 11/5 |  |
| Director · 信息密度 | 15/1 | 15/1 |  |
| Prompter · 对白保真（外部） | 12/4 | 14/2 | **外部验证**，代码比对 SEG 实际是否落到 shot |
| Prompter · 对白保真（自检） | 16/0 | 16/0 | LLM 自评字段 |
| Prompter · 段覆盖 L2（自检） | 16/0 | 6/10 | LLM 自评字段 |
| Prompter · 段覆盖 L3（自检） | 16/0 | 15/1 | LLM 自评字段 |
| Prompter · KVA 覆盖（自检） | 16/0 | 8/8 | LLM 自评字段 |
| HOTFIX L · 每 shot 对白 ≤2 | 16/0 | 16/0 | 本轮新增外部硬门 |
| HOTFIX M · shots ≥ ceil(seg/4) | 13/3 | 13/3 | 本轮新增外部硬门 |
| HOTFIX N · 人名白名单 | 15/1 | 1/15 | 本轮新增外部硬门 |

Pipeline 终态：Doubao=`ok`, Qwen=`ok`

## 3 · 外部验证 · Prompter 对白保真 fail 细节

### 3.1 Doubao (fail 4)
- `B16` — missing seg_ids=SEG_048,SEG_049,SEG_050,SEG_051,SEG_054
- `B14` — missing seg_ids=SEG_041
- `B09` — missing seg_ids=SEG_028
- `B15` — missing seg_ids=SEG_046

### 3.2 Qwen (fail 2)
- `B16` — missing seg_ids=SEG_048,SEG_049,SEG_050,SEG_054,SEG_055
- `B14` — missing seg_ids=SEG_043

## 4 · HOTFIX N 人名白名单 fail 分析（观察模型书写风格差异）

### Doubao (fail 1)
- `B13` · unknown_tokens=`咬紧,眉心`

### Qwen (fail 15)
- `B12` · unknown_tokens=`边缘,冷调`
- `B10` · unknown_tokens=`擦声`
- `B03` · unknown_tokens=`大褂,黑丝`
- `B02` · unknown_tokens=`回响,瓷砖,金属,人员,低语,嗡鸣,大褂,深色`
- `B01` · unknown_tokens=`砖声,短促,清脆,带金,鞋跟,地面`
- `B06` · unknown_tokens=`叠层,渐强,音效,轮廓,听诊`
- `B08` · unknown_tokens=`衣袖`
- `B04` · unknown_tokens=`叠压,她面,示音`
- `B13` · unknown_tokens=`放大,渐强,窸窣`
- `B07` · unknown_tokens=`璃门,走廊`
- `B16` · unknown_tokens=`桌椅,冷光,光灯,白大,一致,吸声`
- `B15` · unknown_tokens=`颌线,锁骨,轻响`
- `B14` · unknown_tokens=`暗示`
- `B11` · unknown_tokens=`嗡鸣,渐强,擦声,示音,合声,上提,鼻翼`
- `B09` · unknown_tokens=`流音,增强,方向,页声,动声`

**分析**：
- Doubao 仅 1 次假阳性（`咬紧` / `眉心` — 顿号堆叠身体部位词被 CJK name-run 误判）
- Qwen 15/16 block 触发 → 几乎全部来自 `[BGM]` / `[SFX]` 段内的音效 / 材质顿号串（`渐强、擦声、嗡鸣、瓷砖、金属 …`），**非人名幻觉**
- **书写风格差异**：Qwen 倾向把多个 SFX 元素用顿号串联，Doubao 倾向用句号 / 逗号分句；本 gate 当前扫整段 `sd2_prompt`，对两种风格同用一把尺会误伤 qwen
- 本项不应被视作 Qwen 更差 —— 而是 gate 的一个已知假阳性模式；后续若需修，应做 `[BGM]` / `[SFX]` 段屏蔽或 stoplist 扩展，但**按用户要求本轮不做**（避免过拟合）

## 5 · 自评诚实度（对角线观察）

| 指标 | Doubao | Qwen |
|---|---|---|
| prompter_self_segment_l2 pass | 16/16 | 6/16 |
| prompter_self_kva_coverage pass | 16/16 | 8/16 |
| prompter_dialogue_fidelity 外部 pass | 12/16 | 14/16 |

**观察**：Doubao 在 self_check 字段上**全填满分**（16/16），但外部验证的 dialogue_fidelity 仍 fail 4 次；Qwen 在自评上给出诚实的 0.14–0.67 小数，外部验证反而更好（fail 2）。

**启示**：**Doubao 有自评虚高倾向**（倾向写 `coverage_ratio=1.0 pass=true`），Qwen 自评更贴近实际。外部硬门（`prompter_dialogue_fidelity` / `max_dialogue_per_shot` / `min_shots_per_block` / `character_token_integrity`）才是最终尺度。

## 6 · 资源与稳定性

- `pipeline_run.log`（HOTFIX O 生效）· Doubao=23,965B (328行), Qwen=21,306B (292行)
- `sd2_final_report`（HOTFIX Q 生效）· 两侧均生成；`meta.partial.status=ok`，block-chain 未过硬门不影响审计链落盘
- `_llm_trace`（HOTFIX P 生效）· 两侧每个 Bxx.json / sd2_payloads / sd2_routing_trace 全齐，provider / model 可审计

## 7 · 综合评价（同输入 · 同 hardgate 全开）

| 维度 | Doubao pro | Qwen plus | 胜出方 |
|---|---|---|---|
| 结构一致性（分镜数 / 节奏） | ✓ | ✓ | 打平 |
| v6 schema 遵守度 | 旧 schema | 新 schema 完整 | **Qwen** |
| Director 段覆盖 | 15/16 pass | 13/16 pass | Doubao |
| Director KVA 覆盖 | 9/16 pass | 11/16 pass | Qwen |
| Prompter 对白保真（外部） | 12/16 pass | 14/16 pass | **Qwen** |
| 自评诚实度 | 全填满分（虚高） | 给出实际比值 | **Qwen** |
| 人名 / token 白名单 | 1/16 fail（假阳性） | 15/16 fail（音效顿号假阳性） | — gate 对两种风格不对称 |
| 对白行上限守纪 | 16/16 pass | 16/16 pass | 打平（HOTFIX L 生效） |

## 8 · 建议

1. **不做定向修 gate**（按用户要求）：本次 `character_token_integrity` 对 qwen 的大量 fail 来自音效顿号堆叠风格不友好，不是真的人名幻觉；不改 gate，保留为『模型书写风格』的可观测指标
2. **模型选择**：就 v6 schema 遵守 / 对白外部保真 / 自评诚实这三条硬指标看，qwen-plus 优于 doubao-pro；但 Director KVA 覆盖上 qwen 略优、段覆盖上 doubao 略优，互有胜负
3. **下一轮对比应**：
   - 让 qwen 跑一遍**完整** pipeline（含 EditMap，而非跳过），看 qwen 的 EditMap 是否也会像 doubao 那样幻觉出 `SEG_063-SEG_072`
   - 增加一轮 `qwen-max` / `qwen3-max`（旗舰档）vs `doubao-pro` 公平对比，因为当前 qwen-plus 与 doubao-pro 并非同档
   - 不应为「让 doubao 看起来更好」去收紧 / 放松具体 gate（避免 Goodhart）
