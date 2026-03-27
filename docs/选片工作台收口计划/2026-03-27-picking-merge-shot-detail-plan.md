# 选片工作台收口计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `ShotDetailPage`（镜头详情）路由重定向到 `VideoPickPage` 的 `picking` 模式，使 picking 成为唯一的「单镜头结果工作台」；同时在 picking 参考区补齐快速迭代所需的编辑与操作能力。

---

## 一、三层架构

```
┌──────────────────────────────────────────────────────────────────────┐
│ 分镜表 StoryboardPage                                      【源数据管理】│
│   完整 prompt 编辑 · 批量尾帧/视频 · 配音管理 · 资产管理 · 拉取同步      │
└───────────────┬──────────────────────────────────────────────────────┘
                │ 点击镜头卡片 / 视频缩略图 / 首尾帧
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 选片 overview (VideoPickPage overview mode)                【结果概览】│
│   扫描所有镜头候选 · 进度一览 · 点击卡片 → 进入 picking                  │
└───────────────┬──────────────────────────────────────────────────────┘
                │ 进入选片 / 点击卡片
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 选片 picking (VideoPickPage picking mode)              【结果精细+迭代】│
│                                                                      │
│  ┌─────────────────────────┐  ┌──────────────────────────────────┐  │
│  │ 左：候选区 (65-75%)      │  │ 右：参考区 (25-35%)               │  │
│  │  视频候选网格            │  │  首尾帧对比（展示）                 │  │
│  │  选定 / 精出 1080p       │  │  画面描述（只读展示）               │  │
│  │                         │  │  视频提示词（✏️ 可编辑 → 重试）     │  │
│  │                         │  │  图像提示词（只读展示）              │  │
│  │                         │  │  时长（✏️ 可编辑）                  │  │
│  │                         │  │  资产标签（展示）                   │  │
│  │                         │  │  配音状态（展示）                   │  │
│  │                         │  │  ──────── 操作 ────────           │  │
│  │                         │  │  生成视频：首帧 / 首尾帧 / 自定义    │  │
│  │                         │  │  生成尾帧                          │  │
│  │                         │  │  单帧重生入口                      │  │
│  └─────────────────────────┘  └──────────────────────────────────┘  │
│                                                                      │
│  核心循环：看结果 → 不满意 → 改视频提示词/时长 → 重试 → 再看 → 选定 → 下一镜│
└──────────────────────────────────────────────────────────────────────┘
                ▲
                │ replace 重定向
┌───────────────┴──────────────────────────────────────────────────────┐
│ ShotDetailPage (旧路由 /shot/:shotId)                   【兼容跳转壳】│
│   读取 params → navigate replace → picking?shotId=xxx                │
└──────────────────────────────────────────────────────────────────────┘
```

### 各层职责边界

| 层 | 页面 | 职责 | 不做什么 |
|---|---|---|---|
| **源数据管理** | 分镜表 | 完整 prompt（画面描述 / 图像提示词 / 视频提示词 / 台词）编辑、批量尾帧与视频、配音、资产、拉取同步 | 不做候选选定、精出 |
| **结果概览** | 选片 overview | 全局候选扫描、筛选（状态/画幅/Scene 分组）、进入单镜头 picking | 不做单镜头编辑 |
| **结果精细+迭代** | 选片 picking | 单镜头候选选定/精出、**视频提示词编辑+时长编辑**（改完直接重试）、生成视频/尾帧、单帧重生入口 | 不做批量操作、不编辑画面描述/图像提示词/台词 |

### 为什么 ShotDetail 跳转到 picking 而非保留独立页

- ShotDetail 的核心操作（看候选、选定、追加生成）与 picking 完全重合，保留两页会**并行演化**增加维护负担。
- picking 已有键盘快速决策流（←→ 切镜头、数字键选定、Tab 循环），从详情路由进入可以直接享用，无需重新实现。
- 快速迭代闭环（改提示词 → 重新生成 → 看结果）只需在参考区增加 **视频提示词编辑** + **时长编辑** + **生成工具条**，不需要把整个详情页的编辑能力搬过来。

---

## 二、参考区字段清单

| 字段 | 模式 | 理由 |
|---|---|---|
| 首尾帧对比 | 展示 | 视觉参考，对照候选质量 |
| 画面描述 | **只读展示** | 参考上下文，深度编辑回分镜表 |
| 视频提示词 | **可编辑** | 改完直接重新生成视频，快速迭代核心 |
| 图像提示词 | **只读展示** | 参考信息；需重新生成首帧时走「单帧重生」 |
| 时长 | **可编辑** | 影响视频生成参数，迭代需要 |
| 资产标签 | 展示 | 参考上下文 |
| 配音状态 | 展示 badge | 参考 |
| **生成视频** | 操作（首帧 / 首尾帧 / 自定义参数） | 快速重试核心 |
| **生成尾帧** | 操作 | 无尾帧时需先生成 |
| **单帧重生入口** | Link → RegenPage | 首帧不满意时用 |

---

## 三、关键设计决策

### 3.1 侧栏空间管理

参考区宽度 `w-[22rem] xl:w-[24rem]`（352–384px），内容以纵向堆叠为主。

**策略：信息分层 + 默认折叠**

- **始终可见**：首尾帧对比、视频提示词编辑区、生成视频工具条（这三者构成「改 → 试」闭环的核心）。
- **默认折叠 / 截断**：画面描述（line-clamp-2，可展开）、图像提示词（line-clamp-2，可展开）、资产标签（超过 3 个折叠为 +N）。
- **按需显示**：配音 badge 无配音时不渲染；生成尾帧按钮仅在无尾帧时突出显示。
- **时长 + 单帧重生入口**：与生成工具条同行或紧邻，占行高极小。

这样「改提示词 → 点生成」的核心链路始终在一屏内可完成，不需要滚动。

### 3.2 键盘快捷键与编辑态共存

**规则：focus 可编辑控件时，暂停 picking 全局键盘流**

实现方式：`VideoPickFocusPanel` 维护 `detailEditing: boolean`，参考区在任何可编辑控件（视频提示词 textarea、时长 input）获得 focus 时回调 `onEditingChange(true)`，blur 时回调 `onEditingChange(false)`。

```tsx
useVideoPickKeyboard({
  enabled: Boolean(shot) && !videoDialogOpen && !detailEditing,
  // ... 其余参数不变
})
```

**涉及的可编辑控件仅 2 个**（视频提示词 textarea + 时长 input），范围可控：

| 控件 | focus 时 | blur / Enter 时 | Esc 时 |
|---|---|---|---|
| 视频提示词 textarea | `detailEditing = true`，左右键在 textarea 内移动光标 | 保存 + `detailEditing = false` | 取消编辑 + `detailEditing = false` |
| 时长 input | `detailEditing = true` | 保存 + `detailEditing = false` | 取消编辑 + `detailEditing = false` |
| VideoModeSelector 弹窗 | `videoDialogOpen = true`（已有） | 关闭弹窗 | 关闭弹窗 |

无需担心「每新增控件就要审计快捷键」——参考区不会再增加更多可编辑字段；需要完整编辑回分镜表。

### 3.3 shotId 深链策略

旧路由 `/shot/:shotId` → `ShotDetailRedirectPage` → `navigate(replace)` → `/pick?shotId=xxx`。

`VideoPickPage` 将 `?shotId` 视为**一次性启动参数**：消费后 `enterPicking(index)` 定位到目标镜头，随即 `navigate(replace)` 清除查询参数，URL 回归 `/pick`。后续左右切换不再写 URL。

---

## 四、文件变更清单

**Create:**
- `web/frontend/src/pages/ShotDetailRedirectPage.tsx`：旧路由兼容跳转壳
- `web/frontend/src/components/business/VideoPickEditablePrompt.tsx`：视频提示词可编辑块（点击 → textarea，blur/Enter 保存，Esc 取消）

**Modify:**
- `web/frontend/src/App.tsx`：旧 shot 路由挂载 ShotDetailRedirectPage
- `web/frontend/src/utils/routes.ts`：增加 `videopickShot` 深链
- `web/frontend/src/utils/videoPickHelpers.ts`：增加 `resolveRequestedShotIndex`
- `web/frontend/src/pages/VideoPickPage.tsx`：消费 `?shotId` 深链参数
- `web/frontend/src/components/business/VideoPickFocusPanel.tsx`：传递 `detailEditing`
- `web/frontend/src/components/business/VideoPickReferencePanel.tsx`：升级为迭代参考面板（增加视频提示词编辑、时长编辑、生成工具条、尾帧、重生入口）
- `web/frontend/src/components/business/ShotDurationCell.tsx`：增加 `onEditingChange` 回调
- `web/frontend/src/components/business/ShotFrameCompare.tsx`：入口链接改为 `videopickShot`
- `web/frontend/src/components/business/ShotRow.tsx`：入口链接改为 `videopickShot`
- `web/frontend/src/components/business/ShotRowVideoPreview.tsx`：入口链接改为 `videopickShot`
- `web/frontend/src/components/business/VideoPickCard.tsx`：入口链接改为 `videopickShot`
- `web/frontend/src/components/business/regen/RegenFramePanel.tsx`：返回链接改为 `videopickShot`
- `web/frontend/src/components/business/index.ts`：导出新组件
- `web/frontend/src/pages/StoryboardPage.tsx`：入口提示文案更新

**Delete:**
- `web/frontend/src/pages/ShotDetailPage.tsx`

---

## 五、Task 拆分

### Task 1: 旧路由跳转 + shotId 深链

**目标**：`/shot/:shotId` 自动跳转到 `/pick?shotId=xxx`，picking 消费参数后定位镜头。

**Files:**
- Create: `web/frontend/src/pages/ShotDetailRedirectPage.tsx`
- Modify: `web/frontend/src/App.tsx`
- Modify: `web/frontend/src/utils/routes.ts`
- Modify: `web/frontend/src/utils/videoPickHelpers.ts`
- Modify: `web/frontend/src/pages/VideoPickPage.tsx`

- [ ] **Step 1: `routes.ts` 增加 `videopickShot` 深链生成器**

```ts
/** 选片工作台·定位到指定镜头（shotId 为一次性启动参数，消费后清除） */
videopickShot: (projectId: string, episodeId: string, shotId: string) =>
  `/project/${encodeURIComponent(projectId)}/episode/${encodeURIComponent(episodeId)}/pick?shotId=${encodeURIComponent(shotId)}`,
```

- [ ] **Step 2: `videoPickHelpers.ts` 增加 `resolveRequestedShotIndex`**

```ts
/** 在镜头列表中查找目标 shotId 的索引；找不到返回 null。深链场景应传入全量列表（不受筛选影响） */
export function resolveRequestedShotIndex(
  shots: Array<{ shotId: string }>,
  requestedShotId: string | null
): number | null {
  if (!requestedShotId) return null
  const index = shots.findIndex((shot) => shot.shotId === requestedShotId)
  return index >= 0 ? index : null
}
```

- [ ] **Step 3: 创建 `ShotDetailRedirectPage.tsx`**

```tsx
import { useEffect } from "react"
import { useNavigate, useParams } from "react-router"
import { routes } from "@/utils/routes"

/** 旧镜头详情路由的兼容跳转壳：读取 params → replace 到选片 picking 深链 */
export default function ShotDetailRedirectPage() {
  const navigate = useNavigate()
  const { projectId = "", episodeId = "", shotId = "" } = useParams()

  useEffect(() => {
    if (!projectId || !episodeId || !shotId) return
    navigate(routes.videopickShot(projectId, episodeId, shotId), {
      replace: true,
    })
  }, [episodeId, navigate, projectId, shotId])

  return <div className="p-8 text-sm text-[var(--color-muted)]">正在进入选片工作台…</div>
}
```

- [ ] **Step 4: `App.tsx` 将旧 shot 路由改为挂载 `ShotDetailRedirectPage`**

```tsx
import ShotDetailRedirectPage from "@/pages/ShotDetailRedirectPage"

{
  path: "project/:projectId/episode/:episodeId/shot/:shotId",
  element: <ShotDetailRedirectPage />,
}
```

- [ ] **Step 5: `VideoPickPage.tsx` 消费 `?shotId` 查询参数，定位后清除**

**关键：深链定位不受筛选态影响。** 使用 `flattenShots(currentEpisode)`（全量叙事序列表）而非 `filteredFlatShots`（受筛选条件过滤后的列表）来解析目标 shotId。这样即使用户上次设了「仅待选」筛选，从外部链接进来仍能稳定定位。定位成功后先重置筛选为默认（全部），再进入 picking。

```tsx
import { useSearchParams } from "react-router"
import { resolveRequestedShotIndex } from "@/utils/videoPickHelpers"

const [searchParams] = useSearchParams()
const consumedDeepLinkRef = useRef(false)
const requestedShotId = searchParams.get("shotId")

useEffect(() => {
  if (!currentEpisode || !requestedShotId || consumedDeepLinkRef.current) return
  // 使用全量镜头列表定位，不受筛选态影响
  const allShots = flattenShots(currentEpisode)
  const index = resolveRequestedShotIndex(allShots, requestedShotId)
  if (index == null) return
  consumedDeepLinkRef.current = true
  // 重置筛选为默认，确保目标镜头在视图中可见
  resetFilters()
  enterPicking(index)
  navigate(routes.videopick(projectId, episodeId), { replace: true })
}, [
  currentEpisode,
  requestedShotId,
  enterPicking,
  resetFilters,
  navigate,
  projectId,
  episodeId,
])
```

- [ ] **Step 6: 构建验证**

Run: `npm run build`

Expected: PASS，无类型错误。手动验证：访问 `/shot/:shotId` 自动跳转到 `/pick` 并定位对应镜头。

```bash
git add -A && git commit -m "feat: shotId deep-link into picking + ShotDetail redirect"
```

---

### Task 2: 参考区升级为迭代面板

**目标**：在 picking 参考区增加视频提示词编辑、时长编辑、生成视频/尾帧工具条、单帧重生入口。

**Files:**
- Create: `web/frontend/src/components/business/VideoPickEditablePrompt.tsx`
- Modify: `web/frontend/src/components/business/VideoPickReferencePanel.tsx`
- Modify: `web/frontend/src/components/business/VideoPickFocusPanel.tsx`
- Modify: `web/frontend/src/components/business/ShotDurationCell.tsx`
- Modify: `web/frontend/src/components/business/index.ts`

- [ ] **Step 1: 创建 `VideoPickEditablePrompt.tsx`——视频提示词可编辑块**

```tsx
/**
 * 选片参考区的视频提示词编辑块
 *
 * 默认只读预览（点击进入编辑态）；
 * blur / Enter 保存、Shift+Enter 换行、Esc 取消。
 * focus 时通过 onEditingChange 通知父组件暂停 picking 全局键盘流。
 */
import { useEffect, useRef, useState } from "react"

export interface VideoPickEditablePromptProps {
  label: string
  value: string
  onCommit: (next: string) => Promise<void> | void
  onEditingChange?: (editing: boolean) => void
}

export function VideoPickEditablePrompt({
  label,
  value,
  onCommit,
  onEditingChange,
}: VideoPickEditablePromptProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { onEditingChange?.(editing) }, [editing, onEditingChange])
  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  const commitAndExit = () => {
    const trimmed = draft.trim()
    if (trimmed !== value.trim()) void onCommit(trimmed)
    setEditing(false)
  }
  const cancelAndExit = () => {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="min-w-0 box-border" style={{ boxSizing: "border-box" }}>
        <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-1">{label}</p>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitAndExit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); textareaRef.current?.blur() }
            if (e.key === "Escape") { e.preventDefault(); cancelAndExit() }
          }}
          className="w-full min-h-[6rem] rounded-sm border border-[var(--color-newsprint-black)] p-2 text-xs leading-relaxed resize-y box-border"
          style={{ boxSizing: "border-box" }}
        />
        <p className="text-[8px] text-[var(--color-muted)] mt-0.5">Enter 保存 · Shift+Enter 换行 · Esc 取消</p>
      </div>
    )
  }

  return (
    <div className="min-w-0 box-border" style={{ boxSizing: "border-box" }}>
      <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-0.5">{label}</p>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-full text-left rounded-sm border border-dashed border-[var(--color-newsprint-black)] bg-white/80 px-2 py-1.5 text-[11px] leading-snug whitespace-pre-wrap break-words line-clamp-4 hover:border-solid hover:border-[var(--color-primary)] transition-colors box-border"
        style={{ boxSizing: "border-box" }}
        title="点击编辑"
      >
        {value.trim() || "暂无内容，点击添加"}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: `ShotDurationCell.tsx` 增加可选的 `onEditingChange` 回调**

在现有 Props 接口增加：

```ts
onEditingChange?: (editing: boolean) => void
```

在组件内的编辑态 `useEffect` 中回调：

```ts
useEffect(() => {
  onEditingChange?.(editing)
}, [editing, onEditingChange])
```

不影响分镜表等其他调用处（未传 `onEditingChange` 时为 undefined，不回调）。

- [ ] **Step 3: 改造 `VideoPickReferencePanel`——增加编辑与操作能力**

在现有展示型布局基础上：

1. **视频提示词**：将 `ExpandablePromptBlock` 替换为 `VideoPickEditablePrompt`，`onCommit` 调用 `updateShot(episodeId, shot.shotId, { videoPrompt })`。
2. **时长**：增加 `ShotDurationCell`，传入 `onEditingChange`。
3. **生成视频工具条**：复用 `ShotVideoGenerateToolbar`（已有组件）。
4. **生成尾帧按钮**：在无尾帧时突出显示。
5. **单帧重生入口**：`Link` 到 `routes.regen()`。

- [ ] **Step 3.5: `VideoPickFocusPanel` 候选区删除现有 `regenerateToolbar`**

生成/再生成控件**从候选区迁移到参考区**，不是新增一份。`VideoPickFocusPanel` 中现有的 `regenerateToolbar`（仅首帧再生成、首尾帧再生成、自定义参数、再生成预览候选按钮）及其关联的 `handleQuickRegenerateVideo`、`handleVideoModeConfirm`、`handleEndframe`、`submittingVideo`、`submittingEndframe`、`videoDialogOpen` 等状态与逻辑**全部移除**，由右侧 `VideoPickReferencePanel` 内的 `ShotVideoGenerateToolbar` 作为**唯一生成入口**。

同时移除候选区底部无候选时的 `再生成 2 个预览候选` / `再生成候选（仅首帧）` 按钮，改为文案引导「请在右侧参考区发起生成」。

Props 新增：

```ts
export interface VideoPickReferencePanelProps {
  // ... 已有 props
  /** 当参考区内有可编辑控件被 focus 时回调 true，blur 时回调 false */
  onEditingChange?: (editing: boolean) => void
}
```

内部用 `useCallback` 汇聚两个编辑控件的 editing 状态：

```tsx
const [promptEditing, setPromptEditing] = useState(false)
const [durationEditing, setDurationEditing] = useState(false)

useEffect(() => {
  onEditingChange?.(promptEditing || durationEditing)
}, [promptEditing, durationEditing, onEditingChange])
```

- [ ] **Step 4: `VideoPickFocusPanel` 接入 `detailEditing` 布尔量**

```tsx
const [detailEditing, setDetailEditing] = useState(false)

useVideoPickKeyboard({
  enabled: Boolean(shot) && !videoDialogOpen && !detailEditing,
  // ... 其余参数不变
})

<VideoPickReferencePanel
  // ... 已有 props
  onEditingChange={setDetailEditing}
/>
```

- [ ] **Step 5: 导出新组件并构建验证**

`index.ts` 增加：

```ts
export { VideoPickEditablePrompt } from "./VideoPickEditablePrompt"
export type { VideoPickEditablePromptProps } from "./VideoPickEditablePrompt"
```

Run: `npm run build`

Expected: PASS。手动验证：picking 模式下可编辑视频提示词与时长，编辑态左右键不切镜头，blur 后恢复。

```bash
git add -A && git commit -m "feat: picking reference panel with editable video prompt & duration + generate toolbar"
```

---

### Task 3: 迁移所有入口链接 + 删除旧详情页

**目标**：所有指向 `/shot/:shotId` 的入口改为 `routes.videopickShot`；删除 `ShotDetailPage.tsx`。

**Files:**
- Modify: `web/frontend/src/components/business/ShotFrameCompare.tsx`
- Modify: `web/frontend/src/components/business/ShotRow.tsx`
- Modify: `web/frontend/src/components/business/ShotRowVideoPreview.tsx`
- Modify: `web/frontend/src/components/business/VideoPickCard.tsx`
- Modify: `web/frontend/src/components/business/regen/RegenFramePanel.tsx`
- Modify: `web/frontend/src/pages/StoryboardPage.tsx`
- Delete: `web/frontend/src/pages/ShotDetailPage.tsx`

- [ ] **Step 1: 全局搜索 `routes.shot(` 并替换为 `routes.videopickShot(`**

涉及组件：`ShotFrameCompare`、`ShotRow`、`ShotRowVideoPreview`、`VideoPickCard`、`VideoPickFocusPanel`。

所有 `<Link to={routes.shot(...)}>` 改为 `<Link to={routes.videopickShot(...)}>` 或在不需要 Link 的地方改为 `onEnterPicking` 回调。

- [ ] **Step 2: `RegenFramePanel` 返回链接改为 picking 深链**

```tsx
<Link to={routes.videopickShot(projectId, episodeId, shot.shotId)}>
  ← 返回选片工作台
</Link>
```

- [ ] **Step 3: `StoryboardPage` 头部提示文案更新**

```tsx
<span className="text-[var(--color-muted)] font-medium normal-case tracking-normal text-[13px]">
  点击镜头进入选片工作台：查看候选、编辑视频提示词、快速重试
</span>
```

- [ ] **Step 4: 删除 `ShotDetailPage.tsx`**

`App.tsx` 中该路由已在 Task 1 替换为 `ShotDetailRedirectPage`，无残留引用。

```bash
git rm web/frontend/src/pages/ShotDetailPage.tsx
```

- [ ] **Step 5: 构建 + 全局验证**

Run: `npm run build`

Expected: PASS，无 `ShotDetailPage` 残留引用，无类型错误。

```bash
git add -A && git commit -m "refactor: migrate all shot detail entries to picking + remove ShotDetailPage"
```

---

## 六、Manual QA

- [ ] 从分镜表网格卡、列表行、首尾帧缩略图、视频缩略图点击进入，均落到选片 picking 模式并定位到对应镜头。
- [ ] 旧书签 `/project/:projectId/episode/:episodeId/shot/:shotId` 自动跳转到 picking。
- [ ] picking 参考区展示：首尾帧、画面描述（只读）、图像提示词（只读）、视频提示词（可编辑）、时长（可编辑）、资产标签、配音状态。
- [ ] 点击视频提示词 → 进入编辑态 → 此时按←→不会切镜头 → blur/Enter 保存 → 键盘快捷键恢复。
- [ ] 时长 input focus 时同样暂停键盘流，blur 后恢复。
- [ ] 生成视频（首帧/首尾帧/自定义参数）、生成尾帧、单帧重生入口均可正常操作。
- [ ] 改完视频提示词 → 点击重新生成 → 任务完成后候选列表刷新，闭环顺畅。
- [ ] overview 仍能批量浏览，picking 仍保留撤销、跳镜头、仅待选等键盘快捷键。
- [ ] 单帧重生完成后，顶部「返回」回到当前镜头的 picking。

---

## 七、最小自动化验证建议

本版去掉了完整测试底座以降低实施门槛，但以下两个行为最容易回归，建议至少做最小自动化覆盖：

1. **旧路由跳转到 picking**：`resolveRequestedShotIndex` 纯函数测试（输入 shotId 列表 + 目标 id → 返回正确索引 / null）。一个 Vitest 文件、3-5 个 case 即可，不需要 DOM 环境。
2. **编辑态暂停快捷键**：`detailEditing` 布尔量影响 `useVideoPickKeyboard({ enabled })` 的路径。如果后续引入 Vitest + jsdom，可写一个集成测试：focus textarea → 按 ArrowRight → 断言镜头未切换。

即使暂不写测试，Manual QA 中的对应条目（第 4、5 条）是**必测项**，不可跳过。

---

## 八、Self-Review

- **Spec coverage**: 三层架构明确（分镜表=源、overview=扫、picking=选+迭代）；ShotDetail 跳转而非删除能力。
- **可编辑字段范围受控**: 仅视频提示词 textarea + 时长 input，`detailEditing` 布尔量完全覆盖。
- **侧栏空间**: 核心迭代链路（视频提示词 + 生成工具条）始终一屏可见；只读字段截断折叠。
- **键盘冲突**: 2 个可编辑控件 + 1 个已有弹窗，布尔量方案成熟，不会随功能膨胀而失控。
- **Placeholder scan**: 无 `TODO` / `TBD` 占位。
