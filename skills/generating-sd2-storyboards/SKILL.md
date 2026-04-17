---
name: generating-sd2-storyboards
description: Generates a complete SD2 storyboard prompt pack from a script, a one-line director brief, and an asset list. Internally orchestrates the EditMap → Director → Prompter block chain via Yunwu/Opus plus DashScope/qwen-plus. Use when the user says 生成分镜 / 剧本转分镜 / 跑 SD2 流水线 / script to storyboard / 出分镜提示词. Typical runtime 5–15 minutes. Requires YUNWU_API_KEY and DASHSCOPE_API_KEY in the repository .env file.
---

# generating-sd2-storyboards

把「剧本 + 一句话导演简报 + 资产列表」一键转成完整 SD2 分镜提示词包。

## Quick start

用户给出 3 样输入后，执行一条命令即可：

```bash
node skills/generating-sd2-storyboards/scripts/generate.mjs \
  --script <path-or-inline> \
  --brief "<一句话简报>" \
  --assets-file <path.json> \
  [--slug <output-dir-name>]
```

产物目录：`output/sd2/<slug>/`，核心产物：`sd2_final_report.md`。

## 本 skill 自带一套 prompts 副本

本 skill 目录下 `prompts/` 是完整的 SD2 v4 提示词与知识库副本，skill 运行**只**依赖它。
和仓库根 `prompt/1_SD2Workflow/` 是两套完全独立的生命周期：

```
仓库根 prompt/1_SD2Workflow/  ← 开发态，prompt engineer 原地迭代
                |
                |  手动触发：node scripts/sync-from-repo.mjs
                ↓
skill 内 prompts/              ← 发布态，skill 稳定运行靠它
```

- 跑 skill 时 `generate.mjs` 设置 `SD2_PROMPT_ROOT` 指向 skill 内 `prompts/`
- 开发时 prompt engineer 直接改仓库根（不受 skill 影响）
- 需要 skill 拉取最新 prompt 时手动跑同步脚本，详见 [reference/sync-workflow.md](reference/sync-workflow.md)

## 用户输入的 3 个字段

| 字段 | 必填 | 说明 | 参考 |
|------|------|------|------|
| `script` | 是 | 剧本路径（`.md`/`.txt`）或直接传入文本 | [reference/inputs-spec.md](reference/inputs-spec.md) |
| `brief` | 是 | 一句话导演简报，含时长 / 题材 / 风格 | 同上 |
| `assets` | 是 | 资产列表 `[{ name, type, description? }]` | [reference/assets-schema.md](reference/assets-schema.md) |

## 资产列表：自然语言优先前置转写

**当用户用自然语言描述资产时（例如"有两个角色：秦若岚、赵凯；场景是医院走廊和副院长办公室；道具有诊断书、手机"），先把它转成 JSON 再调脚本**，不要把自然语言直接塞给 `generate.mjs`。

转写 schema 和示例见 [reference/assets-schema.md](reference/assets-schema.md)。转好后写入临时文件（例如 `/tmp/assets-<slug>.json`），再作为 `--assets-file` 传入。

## 工作流（Low freedom，严格按序）

把下面的清单复制到你的回复里逐项打钩：

```
- [ ] Step 1: 收齐 script / brief / assets 三项；缺任一必须先问用户
- [ ] Step 2: 若 assets 是自然语言，按 reference/assets-schema.md 转成 JSON 写入临时文件
- [ ] Step 3: 调用 scripts/generate.mjs（不要加任何未在本文件出现过的 flag）
- [ ] Step 4: 等待脚本完成（5–15 分钟，正常耗时）；期间不要中断
- [ ] Step 5: 读取产物目录下的 sd2_final_report.md 并向用户汇报关键数字
- [ ] Step 6: 若脚本返回非 0 退出码，按 reference/troubleshooting.md 排查
```

## Thinking 模式策略

- **第 1 次运行：thinking 保持开启**（不传 `--no-thinking`）
- **若 EditMap JSON 截断或缺 Block，`generate.mjs` 自动触发第 2 次重试，并在重试时传 `--no-thinking`**
- **两次都失败时退出并报错**，由 Claude 读 [reference/troubleshooting.md](reference/troubleshooting.md) 给用户下一步建议

这条策略已写死在 `generate.mjs` 中，Claude **不要**手动添加 `--no-thinking` 或其他 flag 来"优化"。

## 产物与汇报

执行成功后，Claude 应向用户汇报：

1. 产物目录路径（`output/sd2/<slug>/`）
2. 总 Block 数、总时长（从 `sd2_final_report.json` 的 summary 读）
3. Markdown 报告路径（`sd2_final_report.md`）

产物目录全部文件清单见 [reference/output-layout.md](reference/output-layout.md)。

## 前置条件检查

开始前确认：

1. `.env` 已配置 `YUNWU_API_KEY` 和 `DASHSCOPE_API_KEY`
2. 当前工作目录是仓库根（`scripts/sd2_pipeline/run_sd2_pipeline.mjs` 存在）
3. `node` 版本 ≥ 18

## 何时 **不要** 使用这个 skill

- 用户只想重跑 Prompter 提示词 → 让用户直接用 `run_sd2_pipeline --skip-editmap --skip-director`
- 用户想导出分镜 CSV/Markdown 格式 → 走 `export_storyboard_blocks_md.mjs`
- 用户只要跑 dry-run / 单 Block 定点重试 → 让用户直接用流水线脚本
- 用户想改 EditMap / Director / Prompter 的 system prompt → 改仓库根 `prompt/1_SD2Workflow/`，然后跑 `sync-from-repo.mjs` 拉进 skill；详见 [reference/sync-workflow.md](reference/sync-workflow.md)

## 失败与排查

完整失败表见 [reference/troubleshooting.md](reference/troubleshooting.md)。

## 评测

`evaluations/` 下的 3 个场景用于验证本 skill 是否仍能正常工作：

- `eval-01-minimal.json` — 最小输入，走完整链路一次
- `eval-02-full-brief.json` — 完整 brief（含题材 / 风格 / 镜头数），测参数透传
- `eval-03-retry.json` — 故意触发截断，验证 thinking 重试策略
