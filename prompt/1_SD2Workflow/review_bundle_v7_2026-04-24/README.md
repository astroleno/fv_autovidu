# v7 Prompt Review Bundle

这份评审包对应本次已经跑通的链路与产物：

- 运行入口：`scripts/sd2_pipeline/run_pipeline_v7.mjs`
- 通过产物：`output/sd2/medical_smoke_stage0_iter10`
- 运行路由：
  - Stage 0 `ScriptNormalizer v2`：豆包
  - Stage 1 `EditMap L1 pure_md`：Opus 4.6 thinking
  - Stage 1 `EditMap L2 translator`：Opus 4.6 thinking
  - Stage 1.5 `Scene Architect`：Opus 4.6 thinking
  - Stage 2/3 `Director + Prompter block chain`：豆包

本目录只打包这条链**实际参与**的提示词与知识材料，便于去隔壁单独审 prompt，不需要再在原目录里来回找。

## 目录说明

- `0_ScriptNormalizer/`
  - Stage 0 的源头 meta prompt。
- `1_EditMap-SD2/`
  - `1_EditMap-v7.md`：L1 `pure_md` 源头 prompt
  - `1_EditMap-Translator-v1.md`：L2 `pure_md -> canonical json` 转译 prompt
- `1_5_SceneArchitect/`
  - Stage 1.5 的场级调度 prompt。
- `2_SD2Director/`
  - Director prompt。
- `2_SD2Prompter/`
  - Prompter prompt。
- `3_FewShotKnowledgeBase/`
  - Block chain 侧 few-shot 检索库。
- `4_KnowledgeSlices/`
  - EditMap / Director / Prompter 在运行时注入的知识切片与 `injection_map.yaml`。

## 数据流

### 0. 输入归一前置

运行器先把剧本与资产整理成 `edit_map_input.json`。

主要来源：

- `episode.json`
- 原始剧本 `e1.md`
- brief / genre / duration 等外部参数

主要产物：

- `edit_map_input.json`

### 1. Stage 0 · ScriptNormalizer v2

使用文件：

- `0_ScriptNormalizer/ScriptNormalizer-v2.md`

输入：

- `edit_map_input.json`

输出：

- `normalized_script_package.json`

下游真正依赖的核心字段：

- `beat_ledger[]`
- `beat_ledger[].segments[]`
- `beat_ledger[].key_visual_actions[]`
- `beat_ledger[].structure_hints[]`
- `segments[].dialogue_char_count`
- `meta.genre_bias_inferred`

这一步的职责是把原剧本切成**机械锚点**，不是做叙事设计。

### 2. Stage 1 · EditMap L1（pure_md）

使用文件：

- `1_EditMap-SD2/1_EditMap-v7.md`
- `4_KnowledgeSlices/editmap/*.md`

输入：

- `edit_map_input.json`
- `normalized_script_package.json`

输出：

- `edit_map_sd2.l1_pure_md.md`

L1 的职责：

- 基于 Stage 0 的 `SEG / KVA / structure_hints` 做 block 切分
- 产出 `Global Ledger / Block Ledger / Rhythm Ledger / Narrative Notes`
- 保留并发链路需要的 `covered / must / lead / tail / overflow / scene_run`

这一层是 `pure_md` 真源头。

### 3. Stage 1 · EditMap L2（translator）

使用文件：

- `1_EditMap-SD2/1_EditMap-Translator-v1.md`

输入：

- `edit_map_sd2.l1_pure_md.md`

输出：

- `edit_map_sd2.json`

L2 的职责：

- 把 L1 的 ledger-first markdown 转成 canonical JSON
- 补出 `appendix.block_index`
- 补出 `meta.style_inference / meta.rhythm_timeline`
- 保留给后续 payload builder 的结构化字段

### 4. Stage 1.5 · Scene Architect

使用文件：

- `1_5_SceneArchitect/1_5_SceneArchitect-v1.md`

输入：

- `edit_map_sd2.json`
- `normalized_script_package.json`
- `episode.json`

输出：

- `scene_architect_output.json`
- 同时把调度结果回灌到 `edit_map_sd2.json`

这一步主要做两件事：

- `rhythm_adjustments`
- `kva_arrangements`

它不替代 EditMap，也不直接写 Director prompt。

### 5. Stage 2 · Director payload build

这一层没有单独 prompt，但它把上游结构拼成 Director 可消费的 payload。

关键中间产物：

- `sd2_director_payloads.json`

每个 block 里最关键的字段：

- `scriptChunk`
- `styleInference`
- `rhythmTimelineForBlock`
- `infoDensityContract`
- `v5Meta.shotSlots`

### 6. Stage 2 · Director

使用文件：

- `2_SD2Director/2_SD2Director-v6.md`
- `4_KnowledgeSlices/director/*.md`
- `4_KnowledgeSlices/injection_map.yaml`

输入：

- `sd2_director_payloads.json` 中每个 block 的 payload

输出：

- `director_prompts/Bxx.json`
- `sd2_director_all.json`

Director 的职责：

- 消费 `scriptChunk`
- 决定 shot 级结构
- 写 `segment_coverage_report`
- 写 `kva_consumption_report`
- 写 `shot_meta.info_delta`
- 满足 `closing_hook / split_screen / freeze_frame` 等硬约束

### 7. Stage 3 · Prompter

使用文件：

- `2_SD2Prompter/2_SD2Prompter-v6.md`
- `4_KnowledgeSlices/prompter/*.md`
- `3_FewShotKnowledgeBase/*.md`
- `4_KnowledgeSlices/injection_map.yaml`

输入：

- Director 每个 block 的结果
- few-shot 检索结果

输出：

- `prompts/Bxx.json`

Prompter 的职责：

- 把 Director shot plan 编译成最终 `[FRAME] / [DIALOG] / [SFX] / [BGM]`
- 兑现对白保真
- 兑现 KVA 可视化
- 输出自检字段

### 8. 汇总

最终由导出层汇总成：

- `sd2_final_report.json`
- `sd2_final_report.md`

## 哪些文件是“源头 prompt”，哪些是“运行时知识”

### 源头 prompt

- `0_ScriptNormalizer/ScriptNormalizer-v2.md`
- `1_EditMap-SD2/1_EditMap-v7.md`
- `1_EditMap-SD2/1_EditMap-Translator-v1.md`
- `1_5_SceneArchitect/1_5_SceneArchitect-v1.md`
- `2_SD2Director/2_SD2Director-v6.md`
- `2_SD2Prompter/2_SD2Prompter-v6.md`

### 运行时知识 / few-shot

- `4_KnowledgeSlices/editmap/*.md`
- `4_KnowledgeSlices/director/*.md`
- `4_KnowledgeSlices/prompter/*.md`
- `4_KnowledgeSlices/injection_map.yaml`
- `3_FewShotKnowledgeBase/*.md`

## 对评审最有用的阅读顺序

建议按这个顺序看：

1. `1_EditMap-SD2/1_EditMap-v7.md`
2. `1_EditMap-SD2/1_EditMap-Translator-v1.md`
3. `1_5_SceneArchitect/1_5_SceneArchitect-v1.md`
4. `2_SD2Director/2_SD2Director-v6.md`
5. `2_SD2Prompter/2_SD2Prompter-v6.md`
6. `0_ScriptNormalizer/ScriptNormalizer-v2.md`
7. `4_KnowledgeSlices/` 与 `3_FewShotKnowledgeBase/`

原因：

- 这条 v7 链真正的核心分歧点在 `pure_md -> translator -> scene architect -> director/prompter`
- Stage 0 更像源锚点层，应该放在“理解主链后”再看它如何约束上游输入

## 补充说明

- 本次通过链路仍有一个**非阻塞软警告**：
  - `edit_map_sd2.json` 里 `meta.style_inference.genre_bias.value` 仍缺失
  - 这轮不会阻塞全链，但如果你要评审 EditMap/L2 的严谨性，这个点值得单独看
- 本目录是**复制件**，原始文件仍在原 prompt 目录中维护
- 运行入口和路径解析逻辑在：
  - `scripts/sd2_pipeline/run_pipeline_v7.mjs`
  - `scripts/sd2_pipeline/lib/sd2_prompt_paths_v6.mjs`
