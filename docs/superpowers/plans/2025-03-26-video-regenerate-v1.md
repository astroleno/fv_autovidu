# 视频「再生成」与自动选中 v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实 `docs/superpowers/specs/2025-03-26-video-generation-modes-retry-design.md` v1：无尾帧时阻塞首尾帧再生成、术语区分「重试失败镜头 / 再生成」、finalize 后自动选中、UI 标注物理最新候选；将「仅首帧 / 首尾帧」再生成入口拆分为显式两路。

**Architecture:** 后端在 `video_finalizer` 单点调用 `select_candidate`，与 `episode.json` 写入同锁，避免前端轮询抢选中。前端用已有 `createdAt` 计算「物理最新」徽章，不新增 `VideoCandidate` 字段。选片卡/聚焦面板复用 `buildSingleShotVideoQuickRequest`，拆成两个按钮并做无尾帧禁用。

**Tech Stack:** FastAPI、现有 `data_service`、`video_finalizer`、React+TS、Tailwind、`VideoPickCard` / `VideoPickFocusPanel`。

---

## 文件与职责总览

| 路径 | 职责 |
|------|------|
| `docs/superpowers/specs/2025-03-26-video-generation-modes-retry-design.md` | 需求与验收（已更新） |
| `web/server/services/task_store/video_finalizer.py` | finalize 成功后 `select_candidate` |
| `web/frontend/src/utils/videoCandidateSort.ts`（新建） | `maxCreatedAt` / `isPhysicallyNewest` 纯函数 |
| `web/frontend/src/components/business/VideoPickCard.tsx` | 双按钮再生成、最新徽章、文案 |
| `web/frontend/src/components/business/VideoPickFocusPanel.tsx` | 同上，保持行为一致 |
| `web/frontend/src/utils/videoQuickRegenerate.ts` | 文件头术语注释 |
| `web/frontend/src/components/business/BatchResultSummary.tsx` | 文件头术语与「重试失败镜头」注释 |
| `tests/test_video_finalizer_select.py`（可选） | 若易测则加集成测试；否则手工验收 |

---

### Task 1: `video_finalizer` — 落盘后自动选中

**Files:**
- Modify: `web/server/services/task_store/video_finalizer.py`（约 240–252 行）

- [ ] **Step 1: 在 `update_video_candidate` 成功后调用 `select_candidate`**

在 `data_service.update_video_candidate(...)` 与当前 `shot_after = get_shot` 块之间，插入：

```python
data_service.select_candidate(
    episode_id, shot_id, candidate_id, ns
)
```

- [ ] **Step 2: 删除或合并原 247–252 行「任一条 selected」分支**

`select_candidate` 已将镜头 `status` 置为 `selected` 并统一候选 `selected` 位，故删除下列逻辑，避免重复与不一致：

```python
shot_after = data_service.get_shot(episode_id, shot_id, ns)
if shot_after and any(c.selected for c in shot_after.videoCandidates):
    data_service.update_shot(episode_id, shot_id, {"status": "selected"}, ns)
else:
    data_service.update_shot(episode_id, shot_id, {"status": "video_done"}, ns)
```

若团队希望 **无播放路径** 的候选 finalize 仍走 `video_done`，需另开需求；**v1 spec** 要求凡成功落盘即选中该候选，故以 `select_candidate` 为准。

- [ ] **Step 3: 本地验证**

启动 API 后，对单镜提交一条视频任务，待 finalize 成功，检查 `episode.json` 中该镜 `videoCandidates` 仅一条 `selected: true` 且为刚完成 `candidate_id`。

- [ ] **Step 4: Commit**

```bash
git add web/server/services/task_store/video_finalizer.py
git commit -m "feat(finalizer): auto-select candidate after video download"
```

---

### Task 2: 工具函数 — 物理最新候选

**Files:**
- Create: `web/frontend/src/utils/videoCandidateSort.ts`

- [ ] **Step 1: 实现比较函数**

```typescript
import type { VideoCandidate } from "@/types/episode"

/**
 * 按 ISO `createdAt` 比较，返回较新者（相等时保留先传入的 tie-break）。
 */
export function pickNewestCandidate(
  candidates: VideoCandidate[]
): VideoCandidate | null {
  if (candidates.length === 0) return null
  return candidates.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b))
}

/** 某候选是否为当前镜下 createdAt 最大（物理最新） */
export function isPhysicallyNewest(
  cand: VideoCandidate,
  all: VideoCandidate[]
): boolean {
  const n = pickNewestCandidate(all)
  return n !== null && n.id === cand.id
}
```

- [ ] **Step 2: Commit**

```bash
git add web/frontend/src/utils/videoCandidateSort.ts
git commit -m "feat: helpers for newest video candidate by createdAt"
```

---

### Task 3: `VideoPickCard` — 最新徽章 + 双按钮再生成

**Files:**
- Modify: `web/frontend/src/components/business/VideoPickCard.tsx`

- [ ] **Step 1: 引入 `isPhysicallyNewest`**

在候选卡片（或缩略图容器）上：若 `isPhysicallyNewest(c, shot.videoCandidates)`，渲染 `<span>` 标签「最新」，并增加与选中态可区分的边框/背景（`box-sizing: border-box` 若新增 padding）。

- [ ] **Step 2: 将单一「重新生成视频」拆为两枚按钮**

- **「仅首帧再生成」**：`buildSingleShotVideoQuickRequest(..., "first_frame")` → `generateApi.video` → 沿用现有 `startPolling`。
- **「首尾帧再生成」**：`buildSingleShotVideoQuickRequest(..., "first_last_frame")`；当 `!shot.endFrame` 时 **`disabled`**，并 `title` 或旁注：`需要先生成尾帧后再使用首尾帧模式`（与后端错误文案一致）。

- [ ] **Step 3: 文案**

工具栏标题由「增加候选 / 重跑」改为强调 **再生成**（例如「追加候选 / 再生成」），避免单独使用「重试」。

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/components/business/VideoPickCard.tsx
git commit -m "feat(pick): dual regenerate buttons and newest badge"
```

---

### Task 4: `VideoPickFocusPanel` — 与 Task 3 行为一致

**Files:**
- Modify: `web/frontend/src/components/business/VideoPickFocusPanel.tsx`

- [ ] **Step 1:** 复制 Task 3 的按钮拆分、禁用规则与 `isPhysicallyNewest` 展示（聚焦模式与卡片模式 UI 结构可能不同，保持文案与 API 一致）。

- [ ] **Step 2: Commit**

```bash
git add web/frontend/src/components/business/VideoPickFocusPanel.tsx
git commit -m "feat(pick): align focus panel regenerate UX with VideoPickCard"
```

---

### Task 5: 术语注释与 `ShotDetailPage`（可选）

**Files:**
- Modify: `web/frontend/src/utils/videoQuickRegenerate.ts`
- Modify: `web/frontend/src/components/business/BatchResultSummary.tsx`

- [ ] **Step 1:** 在 `videoQuickRegenerate.ts` 顶部注释中增加：**「再生成」≠ `BatchResultSummary` 的「重试失败镜头」**（指向 design spec）。

- [ ] **Step 2:** 在 `BatchResultSummary.tsx` 文件头注释中明确：`onRetryFailed` = **失败任务重试**，与选片「再生成」无关。

- [ ] **Step 3（可选）：** `ShotDetailPage.tsx` 若仅展示 `<video>` 列表，可为每条候选加「最新」小标签（复用 `isPhysicallyNewest`），与 v1 验收「列表可见」一致。

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/utils/videoQuickRegenerate.ts web/frontend/src/components/business/BatchResultSummary.tsx
git commit -m "docs: clarify regenerate vs retry-failed terminology"
```

---

### Task 6: 回归与验收

- [ ] **Step 1: 前端构建**

Run: `cd /Users/zuobowen/Documents/GitHub/fv_autovidu/web/frontend && pnpm run build`

Expected: 无 TS 错误。

- [ ] **Step 2: 对照 spec §10 手测清单**

含：无尾帧时首尾按钮禁用、再生成后 `episode.json` 选中项、最新标签。

- [ ] **Step 3: Commit**（仅当有文档或脚本变更时）

---

## Plan self-review

1. **Spec coverage:** §11 四句均映射到 Task 1–5；§5 术语映射 Task 5；§6.1 最新/选中映射 Task 1–2–3。
2. **Placeholders:** 无 TBD。
3. **Consistency:** `select_candidate` 签名与 `data_service` 一致；`ns` 与 finalizer 内其它调用一致。

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2025-03-26-video-regenerate-v1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每任务派生子代理，任务间人工复核，迭代快  

**2. Inline Execution** — 本会话内按 `executing-plans` 连续执行并设检查点  

Which approach do you prefer?
