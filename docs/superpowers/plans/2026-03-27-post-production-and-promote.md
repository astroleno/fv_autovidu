# 后期制作单页、首帧精出与剪映字幕 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地设计说明 `docs/后期制作单页、首帧精出与剪映字幕/2026-03-27-post-production-and-promote-design.md`：后端 promote 按 `first_frame` / `first_last_frame` 分流并拒绝 `reference`；剪映导出请求扩展字幕四字段 + `build_text_track_payload` 可配；前端新增 project-scoped 后期制作页（配音 + 剪映 Tab）、localStorage 分拆、精出按钮按 mode 收紧；分镜页增加入口（一期可与现有 Dub/Export **并存**，见 §11.2）。

**Architecture:** 后端在 `promote_video` 单入口内按候选 `VideoCandidate.mode` 分支校验与入队；剪映在 `JianyingExportRequest` 增加可选字幕字段，经 `jianying_service` 传入 `build_text_track_payload`；前端新页面组合现有 `DubPanel` / 导出 API，抽共享表单组件减少重复。

**Tech Stack:** FastAPI、Pydantic v2、React Router v7、Zustand、现有 `episodesApi` / `shotsApi` / `exportApi`。

**计划怎么拆：** 本文件按 **Wave 1→4** 顺序交付，每 Wave 结束可单独跑通测试/手工验收。若多人并行，仅 **Wave 2 与 Wave 3** 可在 API 契约冻结后部分并行（先合并 schema 再并行实现服务与前端表单）。**不要求**单独开 worktree，若用 `using-git-worktrees` 可隔离长期分支。

**Spec 对照：** 设计 §8 验收要点映射到文末「Spec coverage」。

---

## 文件结构总览（新增 / 修改）

| 区域 | 新建 | 主要修改 |
|------|------|----------|
| 后端 promote | `tests/test_promote_video.py`（或并入现有 generate 测试文件） | `web/server/routes/generate.py` `promote_video` |
| 剪映 | — | `web/server/models/schemas.py` `JianyingExportRequest`；`web/server/services/jianying_text_track.py`；`web/server/services/jianying_service.py` 调用点；可选 `tests/test_jianying_text_track.py` |
| 前端路由与页 | `web/frontend/src/pages/PostProductionPage.tsx`；可选 `web/frontend/src/components/business/postProduction/*` | `web/frontend/src/App.tsx`；`web/frontend/src/utils/routes.ts` |
| 精出 UI | — | `web/frontend/src/components/business/VideoPickFocusPanel.tsx`；`web/frontend/src/components/business/VideoPickCard.tsx`；`usePromoteCandidate` 若存在 |
| 分镜入口 | — | `web/frontend/src/pages/StoryboardPage.tsx`（链接按钮；一期可不删 Dub/Export） |

---

## Wave 1：后端 `POST /generate/video/promote` 分流

**目标：** `first_frame` 预览候选可精出且不要求尾帧；`first_last_frame` 行为与现网一致；`reference` 等返回 400。

### Task 1.1：扩展 `promote_video` 校验与入队逻辑

**Files:**
- Modify: `web/server/routes/generate.py`（`promote_video`，约 755–855 行）
- Create: `tests/test_promote_video.py`

**逻辑要点（替换当前「一律 first_last_frame + 校验尾帧」）：**

1. 共用校验保留：`shot` 存在、`cand` 存在、`taskStatus==success`、`seed>0`、`isPreview==true`。
2. 首帧文件：`ep_dir / shot.firstFrame` 必须存在（两种 mode 均需）。
3. 按 `cand.mode` 分支：
   - **`first_frame`**：**不**检查 `shot.endFrame`；入队时 `VideoJobSpec` 第 4 元（`mode`）为 **`"first_frame"`**；`ref_ids` 仍为 `None`；其余与现精出一致（`promoted_from=candidateId`、`is_preview=False`）。
   - **`first_last_frame`**：保留现有尾帧存在性检查；入队 **`"first_last_frame"`**。
   - **其它**（含 `reference`）：追加错误信息：`精出仅支持 first_frame / first_last_frame，当前为 {cand.mode}`。

4. `jobs` 构建时，mode 使用分支结果，**不要**写死 `"first_last_frame"`。

**参考：** `_run_video_gen` 已支持 `mode == "first_frame"` 的 Vidu 调用路径。

- [ ] **Step 1.1.1** 编写单测：构造内存 episode 数据或通过 `data_service` 与临时目录写入最小 `episode.json` + 首帧文件（可复用其它测试的 fixture 模式）。用 `TestClient` 或直调 `promote_video`（若项目无 HTTP 测例则调用 `data_service` + 提取校验函数为纯函数后单测）。**至少**覆盖：
  - `first_frame` + 无 `endFrame` → 200 且 `background_tasks` 入队（若难测异步，可断言 `jobs` 构造前无尾帧错误 —— 以项目现有测试风格为准）。
  - `first_last_frame` + 缺尾帧文件 → 400。
  - `reference` 候选 → 400。

- [ ] **Step 1.1.2** 实现 `generate.py` 修改，`pytest tests/test_promote_video.py -v` 全绿。

- [ ] **Step 1.1.3** 全量 `pytest` 回归。

- [ ] **Step 1.1.4** Commit：`feat(generate): promote 支持 first_frame 并拒绝非支持 mode`

---

## Wave 2：剪映字幕参数 + `build_text_track_payload`

**目标：** `JianyingExportRequest` 增加 §11.4 四字段（及校验）；`build_text_track_payload` 接收样式参数；`jianying_service` 从请求传入。

### Task 2.1：Schema 与文本轨道

**Files:**
- Modify: `web/server/models/schemas.py` — `JianyingExportRequest` 增加：
  - `subtitleFontSize: int = 8`（或 `subtitle_size` 与前端对齐，二选一全仓一致）
  - `subtitleAlign: Literal["left","center","right"] = "center"`
  - `subtitleAutoWrapping: bool = True`
  - `subtitleTransformY: float = -0.8`
  - Validators：`fontSize` 4–16；`transformY` -1.0～0
- Modify: `web/server/services/jianying_text_track.py` — `build_text_track_payload(..., *, font_size=8, align=..., auto_wrapping=True, transform_y=-0.8)`  
  - 内联 **align 字符串 → `TextStyle.align` 整数**：实现时打开 pyJianYing 的 `TextStyle` 定义核对，**禁止**盲用 0/1/2；文档 §11.4 数字仅为提示。
- Modify: `web/server/services/jianying_service.py` — 调用 `build_text_track_payload` 时传入 `req` 解析后的参数。

- [ ] **Step 2.1.1** 在 `tests/test_jianying_text_track.py`（新建）断言：给定参数时 material 中 style 与 clip `transform_y` 与传入一致（可 snapshot 关键字段）。

- [ ] **Step 2.1.2** 跑通 `pytest tests/test_jianying_text_track.py` + 若有剪映集成测试则一并跑。

- [ ] **Step 2.1.3** Commit：`feat(jianying): 导出请求可配字幕样式与字号`

---

## Wave 3：前端 — 路由、后期制作页、localStorage

**目标：** `/project/:projectId/episode/:episodeId/post-production` 可访问；Tab「配音」「剪映」；剪映表单含画布 + 四字段 + `draftPath`；`fv_jianying_episode_defaults:${episodeId}` 存画布与字幕默认；`LS_JIANYING_DRAFT_PATH` 仍全局。

### Task 3.1：路由与空壳页

**Files:**
- Modify: `web/frontend/src/utils/routes.ts` — `postProduction(projectId, episodeId)`
- Modify: `web/frontend/src/App.tsx` — 子路由注册
- Create: `web/frontend/src/pages/PostProductionPage.tsx` — `useParams` 读 `projectId`/`episodeId`；`fetchEpisodeDetail`；顶栏返回 `routes.episode(projectId, episodeId)`；两 Tab 占位

- [ ] **Step 3.1.1** `npm run build` 通过。

- [ ] **Step 3.1.2** Commit：`feat(ui): 后期制作页路由与空壳`

### Task 3.2：配音 Tab

- 复用 `DubPanel`（或抽 `DubSection`）：将 **语言 locale 编辑** 放在 Tab 顶部（`updateEpisodeLocales` + 与 Storyboard 相同数据源）。
- 一期：**不删除** Storyboard 内 DubPanel 亦可（并存）。

### Task 3.3：剪映 Tab + 表单持久化

- 抽组件：`JianyingExportForm`（或内联）包含 `draftPath`、`canvasSize`、四字段；提交调用现有 `exportApi` / `jianying-draft`。
- `useEffect` 读取/写入 localStorage：全局 `draftPath`；episode 键 JSON 存画布+字幕。

- [ ] **Step 3.3.1** 手工验收：刷新后同 episode 恢复字幕默认值；换 episode 不串；draftPath 跨 episode 共用。

- [ ] **Step 3.3.2** Commit：`feat(ui): 后期制作页配音与剪映表单`

---

## Wave 4：精出按钮收紧 + 分镜入口

### Task 4.1：精出按钮仅 `first_frame` | `first_last_frame`

**Files:**
- Modify: `web/frontend/src/components/business/VideoPickFocusPanel.tsx`（约 364 行附近）
- Modify: `web/frontend/src/components/business/VideoPickCard.tsx`（约 638 行附近）
- Modify: `grep` 项目内 `精出` / `promote` / `usePromoteCandidate` 全部扫一遍

**条件：** 在原有 `isPreview && success && seed>0` 上增加  
`(cand.mode === "first_frame" || cand.mode === "first_last_frame")`。

- [ ] **Step 4.1.1** `npm run build`

- [ ] **Step 4.1.2** Commit：`fix(ui): 精出按钮仅首帧/首尾帧候选`

### Task 4.2：分镜页「后期制作」按钮

- `StoryboardPage` 显著位置 `Link` 至 `routes.postProduction(projectId, episodeId)`。

- [ ] **Step 4.2.1** Commit：`feat(ui): 分镜页入口至后期制作`

---

## Wave 5（可选收尾，与一期解耦）

- 分镜页移除重复 `DubPanel` / `ExportPanel`、语言编辑改为只读 + 链到后期制作（设计 §11.2 目标态）。
- 单独 PR / commit，避免与 Wave 1–4 绑定。

---

## Spec coverage（设计 §8）

| 验收项 | Wave |
|--------|------|
| first_frame 精出无需尾帧 | 1 |
| first_last_frame 与升级前一致 | 1 |
| reference promote → 400 | 1 |
| 后期制作页配音 + 剪映导出 + localStorage | 3 |
| 剧集入口进后期制作 | 3–4 |
| 精出按钮不误露 reference | 4 |

---

## Plan self-review

1. **Spec coverage：** §2–3、§5、§11 均已映射到 Wave；§7 非目标未排期；§11.6 语言归属在 Wave 3 配音 Tab。
2. **Placeholder scan：** 无 TBD；align 整数以实现时库类型为准已写明。
3. **Consistency：** `VideoJobSpec` 使用位置与 `generate.py` 现有元组顺序一致，修改时以当前文件为准核对下标。

---

## Execution handoff

**Plan complete:** `docs/superpowers/plans/2026-03-27-post-production-and-promote.md`

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每 Wave / Task 派生子代理，任务间人工或自动 review。  
2. **Inline Execution** — 本会话内按 Wave 执行，配合 `executing-plans` 的检查点。

**建议顺序：** Wave 1 → 2 → 3 → 4；Wave 5 独立发布。

请选择 **1** 或 **2**；若开始 Wave 1，请先确认测试策略（`TestClient` vs 纯函数提取）与仓库现有 HTTP 测试惯例一致后再写第一条测试。
