# SD2 v4 提示词与知识库（skill 内部副本）

本目录是 `generating-sd2-storyboards` skill **自带的**一整套 SD2 v4 提示词与知识库。
skill 独立运行只依赖本目录，不读仓库根 `prompt/1_SD2Workflow/`。

## 与仓库根的关系

```
仓库根 prompt/1_SD2Workflow/       ← 开发态，prompt engineer 原地迭代
                |
                |  手动 sync（触发脚本：scripts/sync-from-repo.mjs）
                ↓
本目录 prompts/                     ← 发布态，skill 自包含运行
```

- **两套完全独立**，各有版本、各有更新节奏
- 仓库根是"最新"，本目录是"此 skill 当前锁定的稳定版"
- 单向同步：仓库根 → 本目录，不反向

## 目录结构

```
prompts/
├── VERSION                         # 本副本的内容版本号（SemVer）
├── CHANGELOG.md                    # 每次 sync 的变更记录
├── KNOWLEDGE_GRAPH.md              # injection_map 的人类可读翻译
├── CONSUMERS.md                    # skill 里谁在消费本目录
├── README.md                       # 本文件
├── 1_EditMap-SD2/
│   └── 1_EditMap-SD2-v4.md         # EditMap system prompt
├── 2_SD2Director/
│   └── 2_SD2Director-v4.md         # Director system prompt
├── 2_SD2Prompter/
│   └── 2_SD2Prompter-v4.md         # Prompter system prompt
├── 4_KnowledgeSlices/
│   ├── injection_map.yaml          # 切片路由表
│   ├── director/                   # Director 知识切片
│   └── prompter/                   # Prompter 知识切片
├── docs/                           # 接入指南等参考文档
└── _deprecated/
    └── 3_FewShotKnowledgeBase/     # v4 已不用的 FewShot 老库，保留仅供参考
```

## 加载机制

`skills/generating-sd2-storyboards/scripts/generate.mjs` 调流水线前会设置：

```
SD2_PROMPT_ROOT=<绝对路径>/skills/generating-sd2-storyboards/prompts
```

流水线代码 `scripts/sd2_pipeline/lib/sd2_prompt_paths_v4.mjs` 的 `getPromptRoot()`
优先读这个 env，所以所有 prompt 解析都会指向本目录。

没有 env 时流水线走默认值（仓库根 `prompt/1_SD2Workflow/`），这是为了向后兼容，
不影响 prompt engineer 直接命令行跑流水线的习惯。

## 更新本目录

**不要手改本目录下任何文件**。改动会被下次 sync 覆盖掉。

正确流程：

1. 在仓库根 `prompt/1_SD2Workflow/` 里改你要改的 prompt / slice
2. 跑一次 pipeline 确认仓库根版本没回归问题
3. 回到 skill 目录跑：
   ```bash
   node skills/generating-sd2-storyboards/scripts/sync-from-repo.mjs
   ```
4. 脚本会：
   - 对比两边差异，列出将变更的文件
   - bump 本目录 VERSION（patch / minor / major 由 CLI 参数决定）
   - append CHANGELOG.md 一条新记录
   - 物理同步文件

详见 [../reference/sync-workflow.md](../reference/sync-workflow.md)。
