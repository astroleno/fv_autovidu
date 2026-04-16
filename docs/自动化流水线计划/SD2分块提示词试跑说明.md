# SD2 分块提示词试跑说明

## 已接入文件

以下文件已复制到当前项目：

- `prompt/1_SD2Workflow/`
- `scripts/build_sd2_prompter_payload.js`
- `scripts/build_sd2_prompter_payload.test.js`

其中：

- `prompt/1_SD2Workflow/1_EditMap-SD2/1_EditMap-SD2-v1.md`：v1 单集 block 级 EditMap 工作流
- `prompt/1_SD2Workflow/1_EditMap-SD2/1_EditMap-SD2-v2.md`：**v2 升级版**，新增 `scene_archetype`、`focus_subject`、`block_skeleton`、`episodeShotCount`、`motionBias` 等
- `prompt/1_SD2Workflow/2_SD2Director/2_SD2Director-v1.md`：**新增中间阶段**（轻量镜头导演稿，廉价模型可执行）
- `prompt/1_SD2Workflow/2_SD2Prompter/2_SD2Prompter-v1.md`：单 block 的 SD2 三段式脚本生成器
- `prompt/1_SD2Workflow/3_FewShotKnowledgeBase/`：few-shot 知识库与检索契约
- `scripts/build_sd2_prompter_payload.js`：胶水代码，负责把 EditMap-SD2 输出转成 SD2Prompter 输入

## 三阶段流水线（v2 架构）

```
EditMap-SD2 (Opus/高价模型)
    → SD2Director (廉价模型，可选)
    → SD2Prompter (廉价模型)
```

- **EditMap-SD2**：剧本理解、Block 切分、叙事拆解、资产锚定、焦点主体判定、few-shot 检索键生成
- **SD2Director**：时间片划分、运镜意图、站位规划、焦点分配（上游已给强约束，廉价模型能稳定执行）
- **SD2Prompter**：三段式 Seedance 2.0 prompt、微表情、光影物理化、格式合规

## 新增参数：镜头预算与运镜偏好

### motionBias 中英文映射

`motionBias` 参数接受中文或英文输入，内部统一映射为英文存储：

| 中文输入 | 英文存储值 | SD2Director speed_bias | 含义 |
|---------|-----------|----------------------|------|
| `激进` | `aggressive` | `fast` | 固定镜头全集 ≤2 个，可省略空镜，景别偏特写/中景 |
| `平衡` | `balanced` | `neutral` | 不限固定镜头，空镜至少 1 个/Block，景别自由 |
| `沉稳` | `steady` | `slow` | 鼓励更多固定镜头，允许更多远景/全景 |

### episodeShotCount

全集镜头预算（目标镜头总数），与 `episodeDuration` 联合推导 `avg_shot_duration`。实际输出允许 ±10% 弹性。

## 这段胶水代码做什么

`scripts/build_sd2_prompter_payload.js` 负责 3 件事：

1. 从 `EditMap-SD2 JSON` 中选择单个 block，或批量处理全部 block
2. 根据 `block.few_shot_retrieval` 从 `prompt/1_SD2Workflow/3_FewShotKnowledgeBase` 中选出 1-N 个 few-shot 示例
3. 自动从前一 block 投影 `prev_block_context`，组装成 `SD2Prompter` 可直接消费的 payload

输出结构核心字段：

- `edit_map_block`
- `asset_tag_mapping`
- `prev_block_context`
- `few_shot_context`
- `rendering_style`
- `art_style`

## 输入要求

输入必须是一份符合 `EditMap-SD2` schema 的 JSON，至少包含：

- `meta.asset_tag_mapping[]`
- `blocks[]`
- `blocks[].few_shot_retrieval`
- `blocks[].continuity_hints`
- `blocks[].assets_required`
- `blocks[].visuals`

v2 新增可选字段（有则增强检索和结构约束）：
- `meta.block_skeleton[]`
- `meta.target_shot_count` / `meta.motion_bias`
- `blocks[].focus_subject` / `blocks[].reaction_priority`
- `blocks[].few_shot_retrieval.scene_archetype`

如果缺少这些字段，胶水代码仍可能运行，但 few-shot 注入或连续性投影会退化。

## 先跑内置测试

先确认脚本在本项目里可用：

```bash
cd /Users/zuobowen/Documents/GitHub/fv_autovidu
node --test scripts/build_sd2_prompter_payload.test.js
```

预期：4 个测试全部通过。

## 一键流水线

### 推荐：导演简报模式（--brief）

一段话描述所有参数，由 EditMap（Opus）自动解析为结构化参数并透传下游：

```bash
node scripts/sd2_pipeline/run_sd2_pipeline.mjs \
  --episode-json data/{projectId}/{episodeId}/episode.json \
  --script-file public/script/test/e1.md \
  --brief "单集总时长120秒；目标镜头数约60。现代都市医疗情感短剧，真人电影风格。冷调偏青，高反差，低饱和。运镜以固定为主。" \
  --yunwu
```

也可用文件传入：`--brief-file brief.txt`

**混合模式**：`--brief` 和单字段可同时使用，显式字段覆写 brief 中的对应维度：

```bash
node scripts/sd2_pipeline/run_sd2_pipeline.mjs \
  --episode-json data/{projectId}/{episodeId}/episode.json \
  --brief "单集总时长120秒；甜宠短剧，真人电影风格。" \
  --genre revenge \
  --yunwu
# genre 被 --genre 覆写为 revenge，其余参数从 brief 解析
```

### 分字段模式（传统方式）

```bash
node scripts/sd2_pipeline/run_sd2_pipeline.mjs \
  --episode-json data/{projectId}/{episodeId}/episode.json \
  --script-file public/script/test/e1.md \
  --global-synopsis "现代都市医疗情感短剧" \
  --rendering-style "3D写实动画" \
  --art-style "冷调偏青，高反差，低饱和" \
  --shot-hint 30 \
  --motion-bias 激进 \
  --genre sweet_romance
```

### 使用云雾/Opus（第一步 EditMap 用 Opus 拆解剧本）

```bash
node scripts/sd2_pipeline/run_sd2_pipeline.mjs \
  --episode-json data/{projectId}/{episodeId}/episode.json \
  --script-file public/script/test/e1.md \
  --global-synopsis "现代都市医疗情感短剧" \
  --rendering-style "3D写实动画" \
  --art-style "冷调偏青，高反差，低饱和" \
  --shot-hint 30 \
  --motion-bias 平衡 \
  --yunwu
```

加 `--yunwu` 后，EditMap 步骤会调用 `call_yunwu_editmap_sd2.mjs`（默认模型 `claude-opus-4-6-thinking`），后续 SD2Prompter 仍走 DashScope。

环境变量（Yunwu 模式需要）：
- `YUNWU_API_KEY`：必填
- `YUNWU_BASE_URL`：默认 `https://yunwu.ai/v1`
- `YUNWU_MODEL`：默认 `claude-opus-4-6-thinking`

### 参数说明

| 参数 | 说明 |
|------|------|
| `--episode-json` | episode.json 路径 |
| `--script-file` | 剧本 .md 文件路径（可选，不传则从 episode.json 拼接） |
| `--global-synopsis` | 全剧设定文本 |
| `--global-synopsis-file` | 全剧设定文件路径（优先于 `--global-synopsis`） |
| `--duration` | 单集时长（秒），不传则从 episode.json 推算 |
| `--shot-hint` | 全集目标镜头数（可选，写入 `episodeShotCount`） |
| `--motion-bias` | 运镜偏好：`激进` / `平衡` / `沉稳`（或英文 `aggressive` / `balanced` / `steady`），默认 `平衡` |
| `--genre` | 短剧题材：`sweet_romance` / `revenge` / `suspense` / `fantasy` / `general`。不传则由 LLM 从剧本推断 |
| `--rendering-style` | 渲染风格 |
| `--art-style` | 美术基底 |
| `--brief` | **新增**：导演简报（自然语言），一段话描述时长/镜头数/题材/风格/色调等，由 EditMap 解析 |
| `--brief-file` | **新增**：导演简报文件路径（优先于 `--brief`） |
| `--yunwu` | 开关：EditMap 步骤走云雾/Opus |
| `--model` | 覆盖 LLM 模型名（仅 Yunwu 模式有效） |
| `--skip-editmap` | 跳过 EditMap 步骤（需已有 `edit_map_sd2.json`） |
| `--skip-prompter` | 仅跑到 payload 生成，跳过 SD2Prompter |
| `--dry-run` | 仅跑到 payload 生成，跳过所有 LLM 调用 |
| `--block` | 仅处理指定 Block（如 `B03`） |
| `--concurrency` | SD2Prompter 并发数 |
| `--stagger-ms` | SD2Prompter 并发间隔（默认 400ms） |

## 单个 Block 试跑

```bash
cd /Users/zuobowen/Documents/GitHub/fv_autovidu
node scripts/build_sd2_prompter_payload.js /ABS/PATH/TO/edit_map_sd2.json \
  --block B03 \
  --rendering-style "3D写实动画" \
  --art-style "冷调偏青，高反差，低饱和" \
  --output /ABS/PATH/TO/B03.sd2_payload.json
```

说明：

- `--block`：指定 block id，例如 `B03`
- `--rendering-style`：必填时建议显式传，避免依赖上游 meta
- `--art-style`：可选；不传时回退到 `edit_map.meta.art_style`
- `--output`：输出文件路径；不传则直接打印到 stdout

## 全量 Block 批量生成

```bash
cd /Users/zuobowen/Documents/GitHub/fv_autovidu
node scripts/build_sd2_prompter_payload.js /ABS/PATH/TO/edit_map_sd2.json \
  --rendering-style "3D写实动画" \
  --art-style "冷调偏青，高反差，低饱和" \
  --output /ABS/PATH/TO/episode.sd2_payloads.json
```

## few-shot 注入规则

脚本会从 `scene_bucket` 对应 bucket 中检索，并按以下优先级打分：

1. `scene_bucket` 命中
2. `injection_goals` 与 `must_cover` 重合
3. `structural_tags` 命中
4. `visual_tags` 命中

v2 新增 `scene_archetype` 可进一步做桶内精排（如同为 dialogue 桶，`power_confrontation` 和 `comedy_fastcut` 拿到不同示例）。

注意：

- `few_shot_context.selected_examples[].example_prompt` 会一起注入
- 这个 `example_prompt` 只能作为模式参考，不能原样复制其中的人物、场景和剧情事实
- 若 `scene_bucket = mixed`，脚本会从最相关的两个主桶中各拿示例组合注入

## 接到 SD2Prompter 的方式

拿到单 block payload 后，把它作为 `SD2Prompter` 的输入：

- `edit_map_block` -> 当前 block
- `asset_tag_mapping` -> 全局 @图N 映射
- `prev_block_context` -> 前一 block 的连续性投影
- `few_shot_context` -> few-shot 检索结果
- `rendering_style` -> 全局渲染风格
- `art_style` -> 全局美术基底

也就是说，后续 LLM 调用不需要自己再拼 continuity 和 few-shot 逻辑，直接消费这个 payload 即可。

## 当前已知边界

- 当前 few-shot 排序是启发式检索，不是 embedding 检索
- 如果某个 example 未来需要更稳的召回，建议在 bucket 文件里继续补充示例级元数据
- 如果输入 EditMap-SD2 不含 `meta.asset_tag_mapping`，脚本不会自动从 asset manifest 重建映射
- SD2Director 中间阶段目前仅有 prompt 模板，尚未接入 pipeline 自动调用（需手动串联或后续迭代）

## 建议试跑顺序

1. 先挑一个 `emotion` 或 `dialogue` block 验证最简单路径
2. 再跑一个 `action` block 看时间片和 few-shot 注入是否符合预期
3. 最后跑 `memory` 或 `mixed` block，检查视觉标签与跨时间线提示是否稳定
4. 开启 `--yunwu` 测试 Opus 模型对比 DashScope 的 EditMap 输出质量差异
