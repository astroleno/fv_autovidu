# STS 工作台一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地一期 STS 工作台：集默认音色 + 单镜音色覆盖（持久化到 `episode.json`）、按镜列表与展开试听（原声/生成声/可选视频静音）、懒加载播放器、`/post-production?shotId=` 深链展开。

**Architecture:** 后端在 `Episode.dubDefaultVoiceId` 与 `Shot.dubVoiceIdOverride` 上解析最终 `voiceId`；批量接口不再要求请求体传 `voiceOverrides`。前端用 `flattenShots` + `dub/status` 合并状态，通过 `PATCH /episodes/{episodeId}` 与 `PATCH /episodes/{episodeId}/shots/{shotId}` 持久化音色选择；展开行内挂载 `<audio>`/`<video>`。

**Tech Stack:** FastAPI/Pydantic、React、现有 `getFileUrl` + `useEpisodeFileBasePath`。

---

### Task 1: 后端持久化字段与解析

**Files:**
- Modify: `web/server/models/schemas.py` — `Episode` / `Shot` / `DubProcessRequest`
- Modify: `web/server/routes/dub_route.py` — `_voice_id_for_shot` / `dub_process`
- Modify: `web/server/routes/episodes.py` — PATCH 白名单

- [x] **Step 1:** `Episode.dubDefaultVoiceId` / `Shot.dubVoiceIdOverride` 落模型
- [x] **Step 2:** `POST /dub/process` 改为按 `episode.json` 逐镜解析最终 `voiceId`
- [x] **Step 3:** `PATCH /episodes/{episodeId}` 白名单扩展 `dubDefaultVoiceId`

---

### Task 2: 前端类型与 API

**Files:**
- Modify: `web/frontend/src/types/api.ts`
- Modify: `web/frontend/src/types/episode.ts`
- Modify: `web/frontend/src/api/episodes.ts`
- Modify: `web/frontend/src/stores/episodeStore.ts`

- [x] **Step 1:** 前端 Episode / Shot 类型补 `dubDefaultVoiceId` / `dubVoiceIdOverride`
- [x] **Step 2:** 扩展 episode PATCH 类型，shot PATCH 允许 `dubVoiceIdOverride`

---

### Task 3: Dub 模块化与 DubPanel 升级

**Files:**
- Create: `web/frontend/src/components/business/dub/DubShotRow.tsx`
- Modify: `web/frontend/src/components/business/DubPanel.tsx`
- Modify: `web/frontend/src/components/business/index.ts`（如需导出）

- [x] 已实现；音色选择改为直接 PATCH `episode.json`，不再使用 `dubVoiceStorage.ts`

---

### Task 4: PostProduction 深链

**Files:**
- Modify: `web/frontend/src/pages/PostProductionPage.tsx`

- [x] **Step 1:** `useSearchParams` 读取 `shotId`，传给 `DubPanel` 作首次展开/滚动

---

### Task 5: 验证

- [ ] `cd web/frontend && npm run build`
- [ ] `pytest`
- [x] 直接执行 `tests/test_dub_voice_overrides.py` 中核心测试函数，已通过
