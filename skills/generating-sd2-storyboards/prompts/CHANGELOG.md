# SD2 Prompts 内部副本变更日志

本文件记录 skill 内部 prompts/ 副本每次从仓库根同步的变更。
版本遵循 SemVer：

- **MAJOR** — 主 prompt 协议改变（JSON schema / 字段语义变更）
- **MINOR** — 新增能力、切片新增、非破坏性提示词调整
- **PATCH** — 文案修订、笔误修复、等价改写

每次 `sync-from-repo.mjs` 都会在此追加一条记录。

---

## [4.0.0] - 2026-04-17

**来源 commit**: `49a3fb0` (feat(sd2): add v4 workflow prompts and pipeline modules)

初始化本副本：从仓库根 `prompt/1_SD2Workflow/` 完整拷贝 v4 版全部文件。

- EditMap-SD2 v4 系统提示词（672 行）
- SD2Director v4 系统提示词（415 行）
- SD2Prompter v4 系统提示词（378 行）
- KnowledgeSlices：director/ 和 prompter/ 下全部切片
- injection_map.yaml v1.0
- v4 已废弃的 `3_FewShotKnowledgeBase/` 移入 `_deprecated/` 仅作归档

**历史脉络（仅供回溯，不在本副本内）**：

| 日期 | commit | 说明 |
|------|--------|------|
| 2026-04-17 | `49a3fb0` | v4 workflow prompts + pipeline modules |
| 2026-04-16 | `3ea8189` | v3 prompts enhancement |
| 2026-04-16 | `02ca46d` | v3 prompts / pipeline normalization |
| 2026-04-16 | `bd7d2bf` | SD2 workflow prompts 初版 |
