/**
 * ShotCard Shot 卡片
 * Stitch 报纸风格：newsprint-card、灰度图、方角、UPPERCASE 标签
 * 首帧与尾帧同屏双列对比（ShotFrameCompare），便于左右对照
 * 尾帧 / 出视频：调用后端批量生成 API，并由 taskStore 轮询任务状态
 */
import { useState } from "react"
import { Link } from "react-router"
import { Loader2 } from "lucide-react"
import type { Shot, VideoMode } from "@/types"
import { Badge } from "@/components/ui"
import { StatusIndicator } from "./StatusIndicator"
import { DubStatusBadge } from "./DubStatusBadge"
import { AssetTag } from "./AssetTag"
import { ShotFrameCompare } from "./ShotFrameCompare"
import { ShotRowVideoPreview } from "./ShotRowVideoPreview"
import { shotStatusLabels } from "@/utils/format"
import { generateApi } from "@/api/generate"
import { useTaskStore } from "@/stores/taskStore"
import { useToastStore } from "@/stores/toastStore"
import { routes } from "@/utils/routes"
import {
  buildSingleShotVideoQuickRequest,
  toastAfterVideoTasksSettled,
} from "@/utils/videoQuickRegenerate"

interface ShotCardProps {
  shot: Shot
  /** 所属项目 UUID，用于拼接新路由 */
  projectId: string
  episodeId: string
  basePath?: string
  /** 缓存破坏，重新拉取后图片刷新 */
  cacheBust?: string
  /** 分镜板「框选模式」：显示勾选框；外层带 data-batch-pick-item 供 Alt+拖拽框选 */
  pickMode?: boolean
  /** 当前是否勾选参与批量 */
  batchPicked?: boolean
  /** 切换勾选 */
  onBatchPickToggle?: () => void
}

export function ShotCard({
  shot,
  projectId,
  episodeId,
  basePath = "",
  cacheBust,
  pickMode = false,
  batchPicked = false,
  onBatchPickToggle,
}: ShotCardProps) {
  const [submitting, setSubmitting] = useState<"endframe" | "video" | null>(null)
  const startPolling = useTaskStore((s) => s.startPolling)
  const pushToast = useToastStore((s) => s.push)

  const busyEnd = shot.status === "endframe_generating"
  const busyVid = shot.status === "video_generating"
  const canEndframe =
    Boolean(shot.firstFrame) && !busyEnd && !busyVid && submitting !== "endframe"
  const canVideo =
    Boolean(shot.firstFrame) && !busyEnd && !busyVid && submitting !== "video"

  const defaultVideoMode: VideoMode = shot.endFrame ? "first_last_frame" : "first_frame"

  const showEndSkeleton =
    busyEnd || shot.status === "endframe_generating" || submitting === "endframe"

  const handleEndframe = async () => {
    if (!canEndframe) return
    setSubmitting("endframe")
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
          pushToast(`尾帧任务已完成（S${String(shot.shotNumber).padStart(2, "0")}）`, "success")
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "尾帧生成请求失败", "error")
    } finally {
      setSubmitting(null)
    }
  }

  const shotLabel = `S${String(shot.shotNumber).padStart(2, "0")}`

  const handleVideo = async () => {
    if (!canVideo) return
    setSubmitting("video")
    try {
      const body = buildSingleShotVideoQuickRequest(
        episodeId,
        shot.shotId,
        defaultVideoMode
      )
      const res = await generateApi.video(body)
      const ids = res.data.tasks.map((t) => t.taskId)
      startPolling(ids, {
        episodeId,
        onPollAborted: () => {
          pushToast(
            `视频任务轮询中断（${shotLabel}），请刷新页面后查看结果`,
            "error",
            8000
          )
        },
        onAllSettled: (results) => {
          toastAfterVideoTasksSettled(results, pushToast, shotLabel)
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "视频生成请求失败", "error")
    } finally {
      setSubmitting(null)
    }
  }

  const cardInner = (
    <div className="newsprint-card p-4 box-border relative">
      {pickMode && (
        <div
          className="absolute top-2 left-2 z-30"
          data-shot-checkbox
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <label className="flex items-center gap-1 cursor-pointer bg-[var(--color-newsprint-off-white)] border border-[var(--color-newsprint-black)] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-tighter shadow-sm box-border">
            <input
              type="checkbox"
              checked={batchPicked}
              onChange={() => onBatchPickToggle?.()}
              aria-label={`批量框选：镜头 S${String(shot.shotNumber).padStart(2, "0")}`}
            />
            选
          </label>
        </div>
      )}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--color-newsprint-black)] border-dashed">
        <span className="text-[10px] font-black uppercase tracking-tighter text-[var(--color-newsprint-black)] opacity-80">
          S{String(shot.shotNumber).padStart(2, "0")} | {shot.cameraMovement} | {shot.duration}s
        </span>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {shot.videoCandidates.some((c) => c.selected) ? (
            <DubStatusBadge dub={shot.dub} />
          ) : null}
          <StatusIndicator status={shot.status} />
          <Badge
            status={shot.status}
            pulse={
              shot.status === "endframe_generating" || shot.status === "video_generating"
            }
          >
            {shotStatusLabels[shot.status]}
          </Badge>
        </div>
      </div>

      {/* 首帧 + 尾帧：同屏左右对比 */}
      <div className="mb-4">
        <ShotFrameCompare
          shot={shot}
          projectId={projectId}
          episodeId={episodeId}
          basePath={basePath}
          cacheBust={cacheBust}
          variant="card"
          showEndSkeleton={showEndSkeleton}
          onRetryEndframe={shot.status === "error" ? handleEndframe : undefined}
        />
      </div>

      {/* 首尾帧之后：主视频缩略 + 悬浮预览，点击进入镜头详情（与分镜表列表「视频」列一致） */}
      <div className="mb-4">
        <p className="text-[9px] font-black uppercase tracking-wider text-[var(--color-muted)] mb-1.5">
          视频
        </p>
        <ShotRowVideoPreview
          shot={shot}
          projectId={projectId}
          episodeId={episodeId}
          basePath={basePath}
          cacheBust={cacheBust}
        />
      </div>

      {(shot.visualDescription || shot.imagePrompt || shot.videoPrompt) && (
        <div
          className="mb-3 text-[10px] text-[var(--color-muted)] line-clamp-3 box-border"
          title={[shot.visualDescription, shot.imagePrompt, shot.videoPrompt].filter(Boolean).join("\n\n")}
        >
          {shot.visualDescription ? `画面: ${(shot.visualDescription || "").slice(0, 30)}…` : null}
          {shot.imagePrompt ? ` 图: ${(shot.imagePrompt || "").slice(0, 30)}…` : null}
          {shot.videoPrompt ? ` 视: ${(shot.videoPrompt || "").slice(0, 30)}…` : null}
        </div>
      )}
      {shot.assets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {shot.assets.map((a) => (
            <AssetTag
              key={a.assetId}
              asset={a}
              basePath={basePath}
              cacheBust={cacheBust}
              projectId={projectId}
              episodeId={episodeId}
            />
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1">
        <Link to={routes.regen(projectId, episodeId, shot.shotId)}>
          <button
            type="button"
            className="w-full py-1.5 text-[10px] font-black uppercase tracking-wider border border-[var(--color-newsprint-black)] bg-transparent hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
          >
            重生
          </button>
        </Link>
        <button
          type="button"
          disabled={!canEndframe}
          onClick={handleEndframe}
          className="w-full py-1.5 text-[10px] font-black uppercase tracking-wider border border-[var(--color-newsprint-black)] bg-transparent hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busyEnd || submitting === "endframe" ? (
            <span className="inline-flex items-center justify-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              尾帧
            </span>
          ) : (
            "尾帧"
          )}
        </button>
        <button
          type="button"
          disabled={!canVideo}
          onClick={handleVideo}
          className="w-full py-1.5 text-[10px] font-black uppercase tracking-wider bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)] border border-[var(--color-newsprint-black)] hover:bg-[var(--color-primary)] hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busyVid || submitting === "video" ? (
            <span className="inline-flex items-center justify-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              视频
            </span>
          ) : (
            "出视频"
          )}
        </button>
      </div>
    </div>
  )

  if (pickMode) {
    return (
      <div
        data-batch-pick-item={shot.shotId}
        className="relative box-border"
        style={{ boxSizing: "border-box" }}
      >
        {cardInner}
      </div>
    )
  }

  return cardInner
}
