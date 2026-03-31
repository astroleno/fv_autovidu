# 后期制作导航与剪映 UX 增强 — Implementation Plan

> **For agentic workers:** 按任务顺序执行；每步完成后跑 `npm test`（frontend）相关用例。

**Goal:** 剧集侧栏按产品顺序展示入口并含「后期制作」；面包屑补齐 `/post-production` 与 `/pick`；后期制作页剪映 Tab 增加导出结果区、字幕来源说明、9:16/16:9 纵向位置示意图。

**Architecture:** 纯函数 `episodeRouteLabels` 供面包屑与单测；`postProduction/` 包内含字幕示意布局数学与展示组件、导出结果卡片；`PostProductionPage` 组合上述模块并保持现有 API 调用。

**Tech Stack:** React 19、Vitest、Tailwind、既有 `routes`/`exportApi`。

---

## Tasks

- [x] **1** — `episodeRouteLabels.test.ts`：路径 → 文案（后期制作、选片总览、粗剪、资产库、分镜板、镜头、单帧重生）。
- [x] **2** — 实现 `episodeRouteLabels.ts`，`AppLayout` 引用并删除内联函数。
- [x] **3** — `subtitlePreviewLayout.test.ts` + `subtitlePreviewLayout.ts`：`transform_y` → 示意条距底部百分比（钳制 -1～0）。
- [x] **4** — `SubtitlePositionPreview.tsx`：双画框 9:16 / 16:9 + `box-sizing: border-box`。
- [x] **5** — `JianyingExportResultCard.tsx` + `JianyingSubtitleHints.tsx`：展示路径、复制、字幕与写入说明。
- [x] **6** — `SideNavBar`：顺序（资产库→分镜→选片→后期→粗剪）、`Sparkles`、`aria-label="剧集导航"`；`SideNavBar.test.tsx` 断言链接顺序。
- [x] **7** — `PostProductionPage`：剪映 Tab 整合说明文案、示意图、导出成功状态；扩展 `PostProductionPage.test.tsx`。
- [x] **8** — `npm test` + `npm run lint`（frontend），`git commit`。
