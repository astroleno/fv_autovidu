/**
 * VideoPickReferencePanel — 选片 picking 模式右侧「参考 + 迭代」面板
 *
 * ## 职责
 * - **展示**：首尾帧对比、画面描述 / 图像提示词（只读，可展开）、资产标签、配音状态。
 * - **可编辑**：视频提示词、时长（与分镜表同源组件，写入 episode.json）。
 * - **操作**：生成视频工具条（与镜头详情同源 `ShotVideoGenerateToolbar`）、无尾帧时突出「生成尾帧」、单帧重生入口。
 *
 * ## 键盘
 * 可编辑控件通过 `onEditingChange` / `onVideoDialogOpenChange` 向上传递，由 `VideoPickFocusPanel` 暂停 `useVideoPickKeyboard`。
 *
 * ## 布局
 * 参考区宽度由父级 `VideoPickFocusPanel` 控制（约 22–24rem）；本组件内部纵向堆叠，`box-border` 防 padding 撑破。
 */
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import { Film, Loader2, RotateCcw } from "lucide-react"
import type { Shot } from "@/types"
import { useEpisodeStore, useTaskStore, useToastStore } from "@/stores"
import { Button } from "@/components/ui"
import { generateApi } from "@/api/generate"
import { routes } from "@/utils/routes"
import { ShotFrameCompare } from "./ShotFrameCompare"
import { AssetTag } from "./AssetTag"
import { DubStatusBadge } from "./DubStatusBadge"
import { ShotDurationCell } from "./ShotDurationCell"
import { ShotVideoGenerateToolbar } from "./ShotVideoGenerateToolbar"
import { VideoPickEditablePrompt } from "./VideoPickEditablePrompt"

/** 资产标签预览条数：超过则显示 +N（与收口计划「>3 折叠」一致） */
const ASSET_PREVIEW_LIMIT = 3

/** 单条只读可展开文本（画面描述 / 图像提示词） */
function ExpandablePromptBlock({
  label,
  text,
  lineClampClass,
}: {
  label: string
  text: string
  lineClampClass: string
}) {
  const [expanded, setExpanded] = useState(false)
  const trimmed = text.trim()
  if (!trimmed) return null

  return (
    <div
      className="min-w-0 box-border"
      style={{ boxSizing: "border-box" }}
    >
      <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-0.5">
        {label}
      </p>
      <p
        className={`text-[10px] text-[var(--color-ink)] leading-snug whitespace-pre-wrap break-words ${
          expanded ? "" : lineClampClass
        }`}
      >
        {trimmed}
      </p>
      <button
        type="button"
        className="mt-0.5 text-[10px] font-bold text-[var(--color-primary)] underline"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? "收起" : "展开"}
      </button>
    </div>
  )
}

export interface VideoPickReferencePanelProps {
  shot: Shot
  projectId: string
  episodeId: string
  basePath: string
  cacheBust?: string
  showEndSkeleton: boolean
  /** 参考区内任一可编辑控件 focus 时为 true，用于暂停选片全局键盘 */
  onEditingChange?: (editing: boolean) => void
  /** 自定义参数弹窗打开时为 true */
  onVideoDialogOpenChange?: (open: boolean) => void
}

export function VideoPickReferencePanel({
  shot,
  projectId,
  episodeId,
  basePath,
  cacheBust,
  showEndSkeleton,
  onEditingChange,
  onVideoDialogOpenChange,
}: VideoPickReferencePanelProps) {
  const updateShot = useEpisodeStore((s) => s.updateShot)
  const startPolling = useTaskStore((s) => s.startPolling)
  const pushToast = useToastStore((s) => s.push)

  const [promptEditing, setPromptEditing] = useState(false)
  const [durationEditing, setDurationEditing] = useState(false)

  useEffect(() => {
    onEditingChange?.(promptEditing || durationEditing)
  }, [promptEditing, durationEditing, onEditingChange])

  const setPromptEditingCb = useCallback((v: boolean) => {
    setPromptEditing(v)
  }, [])

  const setDurationEditingCb = useCallback((v: boolean) => {
    setDurationEditing(v)
  }, [])

  const assets = shot.assets ?? []
  const extraAssetCount = Math.max(0, assets.length - ASSET_PREVIEW_LIMIT)

  const busyEnd = shot.status === "endframe_generating"
  const busyVid = shot.status === "video_generating"
  const [submittingEndframe, setSubmittingEndframe] = useState(false)
  const canEndframe =
    Boolean(shot.firstFrame) &&
    !busyEnd &&
    !busyVid &&
    !submittingEndframe
  const hasEndFramePath = Boolean(shot.endFrame?.trim())
  const shotLabel = `S${String(shot.shotNumber).padStart(2, "0")}`

  const handleEndframe = async () => {
    if (!canEndframe) return
    setSubmittingEndframe(true)
    try {
      const res = await generateApi.endframe({
        episodeId,
        shotIds: [shot.shotId],
      })
      const { tasks } = res.data
      const ids = tasks.map((t) => t.taskId)
      startPolling(ids, {
        episodeId,
        onAllSettled: () => {
          pushToast(`尾帧任务已完成（${shotLabel}）`, "success")
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "尾帧生成请求失败", "error")
    } finally {
      setSubmittingEndframe(false)
    }
  }

  const onCommitVideoPrompt = async (next: string) => {
    await updateShot(episodeId, shot.shotId, { videoPrompt: next })
  }

  return (
    <aside
      className="flex flex-col gap-3 min-w-0 w-full max-h-[calc(100vh-12rem)] overflow-y-auto box-border p-3 border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]/25 rounded-sm"
      style={{ boxSizing: "border-box" }}
      aria-label="当前镜头参考与迭代"
    >
      <ShotFrameCompare
        variant="pick"
        shot={shot}
        projectId={projectId}
        episodeId={episodeId}
        basePath={basePath}
        cacheBust={cacheBust}
        showEndSkeleton={showEndSkeleton}
        onRetryEndframe={
          shot.status === "error" ? () => void handleEndframe() : undefined
        }
      />

      <div
        className="rounded-sm border border-dashed border-[var(--color-newsprint-black)] p-2 bg-white/80 min-w-0 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-1.5">
          只读参考（深度编辑请回分镜表）
        </p>
        <div
          className="flex flex-col gap-2 min-w-0 box-border"
          style={{ boxSizing: "border-box" }}
        >
          <ExpandablePromptBlock
            label="画面描述 visualDescription"
            text={shot.visualDescription ?? ""}
            lineClampClass="line-clamp-2"
          />
          <ExpandablePromptBlock
            label="图像提示词 imagePrompt"
            text={shot.imagePrompt ?? ""}
            lineClampClass="line-clamp-2"
          />
        </div>
      </div>

      <VideoPickEditablePrompt
        label="视频提示词 videoPrompt"
        value={shot.videoPrompt ?? ""}
        onCommit={onCommitVideoPrompt}
        onEditingChange={setPromptEditingCb}
      />

      {/* 无尾帧时突出「生成尾帧」，满足首尾帧视频模式前置条件 */}
      {!hasEndFramePath ? (
        <div
          className="rounded-sm border border-[var(--color-primary)] bg-[var(--color-primary)]/10 p-2 box-border"
          style={{ boxSizing: "border-box" }}
        >
          <p className="text-[10px] font-bold text-[var(--color-newsprint-black)] mb-1.5">
            尚未生成尾帧
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={!canEndframe}
            className="text-[10px] px-2 py-1.5 gap-1.5 h-auto w-full justify-center box-border"
            style={{ boxSizing: "border-box" }}
            onClick={() => void handleEndframe()}
          >
            {submittingEndframe || busyEnd ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
            ) : (
              <Film className="w-3.5 h-3.5 shrink-0" aria-hidden />
            )}
            生成尾帧
          </Button>
        </div>
      ) : null}

      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 box-border text-[10px] text-[var(--color-ink)]"
        style={{ boxSizing: "border-box" }}
      >
        <span className="text-[9px] font-black uppercase text-[var(--color-muted)] shrink-0">
          时长
        </span>
        <ShotDurationCell
          shot={shot}
          episodeId={episodeId}
          updateShot={updateShot}
          className="text-[var(--color-ink)]"
          onEditingChange={setDurationEditingCb}
        />
        <span aria-hidden className="text-[var(--color-border)]">
          |
        </span>
        <Link
          to={routes.regen(projectId, episodeId, shot.shotId)}
          className="inline-flex items-center gap-1 font-bold text-[var(--color-primary)] underline underline-offset-2 box-border"
          style={{ boxSizing: "border-box" }}
        >
          <RotateCcw className="w-3 h-3 shrink-0" aria-hidden />
          单帧重生
        </Link>
      </div>

      {shot.dub != null ? (
        <div
          className="flex flex-wrap items-center gap-2 min-w-0 box-border"
          style={{ boxSizing: "border-box" }}
        >
          <span className="text-[9px] font-black uppercase text-[var(--color-muted)] shrink-0">
            配音
          </span>
          <DubStatusBadge dub={shot.dub} />
        </div>
      ) : null}

      {assets.length > 0 ? (
        <div
          className="min-w-0 box-border"
          style={{ boxSizing: "border-box" }}
        >
          <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-1.5">
            资产
          </p>
          <div className="flex flex-wrap gap-1.5 min-w-0">
            {assets.slice(0, ASSET_PREVIEW_LIMIT).map((a) => (
              <AssetTag
                key={a.assetId}
                asset={a}
                basePath={basePath}
                cacheBust={cacheBust}
                projectId={projectId}
                episodeId={episodeId}
              />
            ))}
            {extraAssetCount > 0 ? (
              <span
                className="inline-flex items-center px-2 py-0.5 border border-[var(--color-newsprint-black)] text-[10px] font-black uppercase bg-[var(--color-outline-variant)] text-[var(--color-muted)] box-border"
                style={{ boxSizing: "border-box" }}
                title={`另有 ${String(extraAssetCount)} 个资产`}
              >
                +{extraAssetCount}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <ShotVideoGenerateToolbar
        shot={shot}
        episodeId={episodeId}
        onVideoDialogOpenChange={onVideoDialogOpenChange}
      />
    </aside>
  )
}
