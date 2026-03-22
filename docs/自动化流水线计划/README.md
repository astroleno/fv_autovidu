# 自动化流水线计划（文档索引）

本目录聚焦一件事：把 **平台拉取 → 本地尾帧 → 多模式视频生成** 收敛成一套真的能排期、能实现、能验收的自动化方案。  
和 `docs/平台辅助计划`、`docs/尾帧补全计划` 的关系如下：

- `docs/平台辅助计划`：偏平台能力、整体架构、前端配套。
- `docs/尾帧补全计划`：偏某一轮功能补齐。
- **本目录**：偏正式流水线入口、实施顺序、任务恢复边界、验收标准。

## 文档结构

| 文件 | 说明 |
|------|------|
| [自动化流水线计划.md](./自动化流水线计划.md) | 主文档：落地结论、已确认现状、正式入口决策、优先级、实施阶段、验收标准 |

## 这版文档的核心结论

- 计划 **适合落地**，但必须先收敛范围，不能把 CLI 对齐、Web 运维、批量 UI 增强同时当成第一阶段。
- 正式入口只保留一个：`scripts/feeling/full_pipeline.py`。`Makefile/justfile` 只能做包装。
- 任务恢复当前只能承诺到“弱恢复”，在持久化完成前不能把能力写成“重启后无缝继续”。

## 推荐阅读顺序

1. 先读主文档的 **「一、落地结论」** 和 **「四、落地决策」**，先把边界收紧。
2. 再读 **「五、缺口与优先级」**，确认当前到底先做什么。
3. 实施时按 **「六、实施方案」** 和 **「八、验收标准」** 执行，不要跳阶段。

## 唯一正式命令示例（CLI 主闭环）

配置好项目根目录 `.env`（`FEELING_*`、`YUNWU_API_KEY`、`VIDU_API_KEY`）后，从空 `data/` 跑通：

```bash
python scripts/feeling/full_pipeline.py --project-id <PROJECT_UUID> --steps pull,tail,video --video-mode first_last_frame
```

- `--episode-id` 可选；省略则处理该项目下全部剧集目录。
- `--steps` 可只写 `tail,video` 等跳过已完成的拉取。
- 详见脚本 `--help` 与主文档「六、实施方案」。

## 关联代码路径（速查）

- 拉取项目：`src/feeling/puller.py`
- 尾帧 CLI：`scripts/endframe/gen_tail.py`
- 视频批量 CLI：`scripts/i2v/batch.py`
- 多参考传统脚本：`scripts/i2v/ref2v_multi.py`
- Web 生成入口：`web/server/routes/generate.py`
- Web 任务追踪：`web/server/routes/tasks.py`
- 分镜批量页：`web/frontend/src/pages/StoryboardPage.tsx`
- 模式选择组件：`web/frontend/src/components/business/VideoModeSelector.tsx`
- 前端轮询：`web/frontend/src/stores/taskStore.ts`

---

*维护约定：如果主文档更新了正式入口、阶段划分或验收口径，这个 README 也要同步更新。*
