# 消费者清单

谁会读本目录的文件？改动这里的任何内容前请先过一眼本清单。

## skill 内部消费者

| 消费者 | 读取路径 | 触发时机 |
|--------|---------|---------|
| `skills/generating-sd2-storyboards/scripts/generate.mjs` | **整个 prompts/** | 启动 pipeline 前设置 `SD2_PROMPT_ROOT` env 指向本目录 |

## 通过 env 间接消费者（跑流水线时）

只要 `SD2_PROMPT_ROOT` 指向本目录，下面的脚本就会读本目录而非仓库根：

| 脚本 | 读取的文件 |
|------|-----------|
| `scripts/sd2_pipeline/lib/sd2_prompt_paths_v4.mjs` | 入口，4 个 getter 函数 |
| `scripts/sd2_pipeline/call_yunwu_editmap_sd2_v4.mjs` | `1_EditMap-SD2/1_EditMap-SD2-v4.md` |
| `scripts/sd2_pipeline/call_sd2_block_chain_v4.mjs` | `2_SD2Director/2_SD2Director-v4.md`<br/>`2_SD2Prompter/2_SD2Prompter-v4.md`<br/>`4_KnowledgeSlices/injection_map.yaml` 及其引用 |

## 不消费本目录的调用方式（重要）

以下调用方式**不会**读本目录，它们读仓库根 `prompt/1_SD2Workflow/`：

- `node scripts/sd2_pipeline/run_sd2_pipeline.mjs ...`（未设 `SD2_PROMPT_ROOT`）
- 任何开发期直接调用流水线脚本的场景

**为什么要保留这种二元行为**：
- prompt engineer 开发时还是改仓库根，立刻看效果
- skill 要的是"锁定的稳定版"，所以走副本
- 两者互不干扰是特性不是 bug

## 改这里会影响谁？

本目录是**单向同步的下游**。你**不应该手改本目录**。
正确流程：改仓库根 `prompt/1_SD2Workflow/`，再跑 sync 脚本同步过来。
详见 [../reference/sync-workflow.md](../reference/sync-workflow.md)。
