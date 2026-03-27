/**
 * VideoPickCard — 选片总览专用「宽卡片」
 *
 * 布局原则（改版后）：
 * - **左侧参考区（Left Context）**：首尾帧 + 提示词摘要 + 配音状态 + 资产标签 —— 提供「对照预期」所需的最小信息，不是详情页全量搬运。
 * - **右侧候选区（Right Candidates）**：视频候选网格 + 选定 / 精出 + 再生成工具条 —— **决策主体**，优先保证播放器可读性。
 *
 * - lg 及以上：左右分栏；lg 以下：上下堆叠，顺序始终「参考在上、候选在下」。
 *
 * 交互概要：
 * - 有候选时：先渲染各候选 VideoPlayer，其下为再生成工具条
 * - 无候选时：右侧仅工具条 + 引导；左侧参考区仍展示（便于决定是否继续生成）
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { ExternalLink, Film, Loader2 } from "lucide-react"
import type { Shot, VideoMode } from "@/types"
import type { GenerateVideoRequest } from "@/types"
import { usePromoteCandidate } from "@/hooks"
import { candidateCanPromoteToFullQuality } from "@/utils/videoCandidatePromote"
import { useEpisodeStore, useShotStore, useTaskStore, useToastStore } from "@/stores"
import { Button } from "@/components/ui"
import { generateApi } from "@/api/generate"
import { VideoPlayer } from "./VideoPlayer"
import { StatusIndicator } from "./StatusIndicator"
import { VideoModeSelector, type VideoModeSelectorResult } from "./VideoModeSelector"
import { ShotFrameCompare } from "./ShotFrameCompare"
import { AssetTag } from "./AssetTag"
import { DubStatusBadge } from "./DubStatusBadge"
import { shotStatusLabels } from "@/utils/format"
import { aspectRatioGroupKey } from "@/utils/aspectRatio"
import { getFileUrl } from "@/utils/file"
import { routes } from "@/utils/routes"
import {
  buildSingleShotVideoQuickRequest,
  toastAfterVideoTasksSettled,
} from "@/utils/videoQuickRegenerate"
import { isPhysicallyNewest } from "@/utils/videoCandidateSort"

/** 组件对外 Props：与分镜卡片类似的剧集上下文，便于拼接静态资源 URL 与路由 */
export interface VideoPickCardProps {
  shot: Shot
  projectId: string
  episodeId: string
  basePath: string
  cacheBust?: string
  /**
   * 当前镜头在「筛选后的扁平镜头列表」中的索引（与 VideoPickPage 中 filteredFlatShots 一致），
   * 用于进入选片模式时定位当前镜头。
   */
  flatIndex: number
  /** 从列表进入 Picking 模式（会保存滚动位置等，由页面注入） */
  onEnterPicking?: (flatIndex: number) => void
}

/** 左侧单条提示词：行数截断 + 实测溢出后显示「展开更多」，避免无意义按钮 */
function PickPromptField({
  label,
  text,
  lineClampClass,
}: {
  label: string
  text: string
  /** 收起态 Tailwind line-clamp，如 line-clamp-3 */
  lineClampClass: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const pRef = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const el = pRef.current
    if (!el || expanded) {
      setOverflowing(false)
      return
    }
    setOverflowing(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded, lineClampClass])

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
        ref={pRef}
        className={`text-[10px] text-[var(--color-ink)] leading-snug whitespace-pre-wrap break-words ${
          expanded ? "" : lineClampClass
        }`}
      >
        {trimmed}
      </p>
      {overflowing || expanded ? (
        <button
          type="button"
          className="mt-0.5 text-[10px] font-bold text-[var(--color-primary)] underline"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "收起" : "展开更多"}
        </button>
      ) : null}
    </div>
  )
}

/**
 * 左侧「核心文本」区：优先级 画面描述 > 视频提示词 > 图像提示词；全空时占位
 */
function VideoPickLeftPrompts({ shot }: { shot: Shot }) {
  const hasAny =
    Boolean(shot.visualDescription?.trim()) ||
    Boolean(shot.videoPrompt?.trim()) ||
    Boolean(shot.imagePrompt?.trim())

  if (!hasAny) {
    return (
      <p
        className="text-[10px] text-[var(--color-muted)] box-border"
        style={{ boxSizing: "border-box" }}
      >
        暂无提示词信息
      </p>
    )
  }

  return (
    <div
      className="flex flex-col gap-2 min-w-0 box-border"
      style={{ boxSizing: "border-box" }}
    >
      <PickPromptField
        label="画面描述"
        text={shot.visualDescription ?? ""}
        lineClampClass="line-clamp-3"
      />
      <PickPromptField
        label="视频提示词"
        text={shot.videoPrompt ?? ""}
        lineClampClass="line-clamp-4"
      />
      <PickPromptField
        label="图像提示词"
        text={shot.imagePrompt ?? ""}
        lineClampClass="line-clamp-2"
      />
    </div>
  )
}

/**
 * 候选网格：默认可读性优先 —— 1 列大单列、2 列起最多 2 列（不在普通宽度下铺 3 列竖屏候选）
 */
function candidateGridClass(count: number): string {
  if (count <= 0) return "grid gap-3"
  if (count === 1) return "grid grid-cols-1 gap-3"
  return "grid grid-cols-1 sm:grid-cols-2 gap-3"
}

const ASSET_PREVIEW_LIMIT = 3

export function VideoPickCard({
  shot,
  projectId,
  episodeId,
  basePath,
  cacheBust,
  flatIndex,
  onEnterPicking,
}: VideoPickCardProps) {
  const { selectCandidate } = useShotStore()
  const { promote, isPromoting } = usePromoteCandidate({
    episodeId,
    shotId: shot.shotId,
  })
  const currentEpisode = useEpisodeStore((s) => s.currentEpisode)
  const startPolling = useTaskStore((s) => s.startPolling)
  const pushToast = useToastStore((s) => s.push)

  const [submittingVideo, setSubmittingVideo] = useState(false)
  const [submittingEndframe, setSubmittingEndframe] = useState(false)
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)

  const episodeAssetIds = useMemo(
    () => (currentEpisode?.assets ?? []).map((a) => a.assetId),
    [currentEpisode?.assets]
  )

  const busyEnd = shot.status === "endframe_generating"
  const busyVid = shot.status === "video_generating"
  const canSubmitVideo =
    Boolean(shot.firstFrame?.trim()) &&
    !busyEnd &&
    !busyVid &&
    !submittingVideo
  const canEndframe =
    Boolean(shot.firstFrame) &&
    !busyEnd &&
    !busyVid &&
    !submittingEndframe
  const shotLabel = `S${String(shot.shotNumber).padStart(2, "0")}`
  /** 首尾帧再生成依赖尾帧路径（与后端校验一致；不自动补尾帧 v1） */
  const hasEndFramePath = Boolean(shot.endFrame?.trim())
  const showEndSkeleton =
    busyEnd || submittingEndframe

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
          pushToast(
            `尾帧任务已完成（${shotLabel}）`,
            "success"
          )
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "尾帧生成请求失败", "error")
    } finally {
      setSubmittingEndframe(false)
    }
  }

  /**
   * 快捷再生成（追加候选）：`first_frame` 只跑首帧 i2v；`first_last_frame` 走预览档（540p+turbo+双候选），与弹窗「预览模式」一致。
   * 注：产品用语「再生成」；失败任务批量补救见 BatchResultSummary「重试失败镜头」。
   */
  const handleQuickRegenerateVideo = async (mode: VideoMode) => {
    if (!canSubmitVideo) return
    setSubmittingVideo(true)
    try {
      const body = buildSingleShotVideoQuickRequest(
        episodeId,
        shot.shotId,
        mode
      )
      const res = await generateApi.video(body)
      const ids = res.data.tasks.map((t) => t.taskId)
      pushToast(
        `已提交 ${ids.length} 个视频任务（${shotLabel}），生成完成后将提示并刷新列表`,
        "info",
        5000
      )
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
      setSubmittingVideo(false)
    }
  }

  /**
   * 弹窗确认：与 StoryboardPage 批量视频请求体一致，仅 shotIds 长度为 1。
   */
  const handleVideoModeConfirm = async (result: VideoModeSelectorResult) => {
    if (!canSubmitVideo) return
    setSubmittingVideo(true)
    try {
      const body: GenerateVideoRequest = {
        episodeId,
        shotIds: [shot.shotId],
        mode: result.mode,
        model: result.model,
        resolution: result.resolution,
        referenceAssetIds: result.referenceAssetIds,
        ...(result.mode === "first_last_frame" && result.isPreview
          ? {
              isPreview: true,
              candidateCount: result.candidateCount ?? 1,
            }
          : {}),
      }
      const res = await generateApi.video(body)
      const ids = res.data.tasks.map((t) => t.taskId)
      pushToast(
        `已提交 ${ids.length} 个视频任务（${shotLabel}）`,
        "info",
        5000
      )
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
      setVideoDialogOpen(false)
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "视频生成请求失败", "error")
    } finally {
      setSubmittingVideo(false)
    }
  }

  const storyboardUrl = routes.episode(projectId, episodeId)
  const detailUrl = routes.videopickShot(projectId, episodeId, shot.shotId)
  const gridClass = candidateGridClass(shot.videoCandidates.length)
  const hasFirstFrame = Boolean(shot.firstFrame?.trim())
  const nCandidates = shot.videoCandidates.length
  const assets = shot.assets ?? []
  const extraAssetCount = Math.max(0, assets.length - ASSET_PREVIEW_LIMIT)

  /** 有首帧时才渲染：与分镜板同源按钮；无首帧时由 missingFirstFrameNote 说明 */
  const regenerateToolbar = hasFirstFrame ? (
    <div
      className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] p-2 box-border"
      style={{ boxSizing: "border-box" }}
    >
      <span className="text-[9px] font-black uppercase text-[var(--color-muted)] shrink-0 w-full sm:w-auto">
        {nCandidates > 0 ? "追加候选 / 再生成" : "生成视频"}
      </span>
      <Button
        type="button"
        variant="secondary"
        disabled={!canSubmitVideo}
        className="text-[10px] px-2 py-1.5 gap-1.5 h-auto box-border"
        style={{ boxSizing: "border-box" }}
        onClick={() => void handleQuickRegenerateVideo("first_frame")}
        title="仅首帧图生视频（i2v），不依赖尾帧"
      >
        {submittingVideo ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
        ) : (
          <Film className="w-3.5 h-3.5 shrink-0" aria-hidden />
        )}
        仅首帧再生成
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={!canSubmitVideo || !hasEndFramePath}
        className="text-[10px] px-2 py-1.5 gap-1.5 h-auto box-border"
        style={{ boxSizing: "border-box" }}
        onClick={() => void handleQuickRegenerateVideo("first_last_frame")}
        title={
          hasEndFramePath
            ? "首尾帧预览档（540p+turbo+双候选），与弹窗预览一致"
            : "需要先生成尾帧后再使用首尾帧模式"
        }
      >
        {submittingVideo ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
        ) : (
          <Film className="w-3.5 h-3.5 shrink-0" aria-hidden />
        )}
        首尾帧再生成
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={!canSubmitVideo}
        className="text-[10px] px-2 py-1.5 h-auto box-border"
        style={{ boxSizing: "border-box" }}
        onClick={() => setVideoDialogOpen(true)}
      >
        自定义参数
      </Button>
      <p className="text-[9px] text-[var(--color-muted)] leading-snug w-full basis-full sm:basis-auto sm:flex-1 min-w-0">
        {busyEnd || busyVid
          ? "尾帧或视频生成中，请等待当前任务结束后再试。"
          : nCandidates > 0
            ? "在上方成片候选基础上再提交任务，完成后列表会增加新候选；成片落盘后会自动选中最新一条。"
            : "首尾帧快捷为预览档（540p+turbo+双候选）；正式档或多参考请用「自定义参数」。无尾帧时请先跑尾帧再点「首尾帧再生成」。"}
      </p>
    </div>
  ) : null

  const missingFirstFrameNote = !hasFirstFrame ? (
    <p
      className="text-[10px] text-[var(--color-muted)] box-border"
      style={{ boxSizing: "border-box" }}
    >
      缺少首帧路径，无法在此发起视频生成；请先在分镜板或平台侧补齐首帧。
    </p>
  ) : null

  /** 右侧：无候选时的引导（prompt 已在左栏；深度编辑走分镜表，迭代走选片 picking） */
  const emptyCandidatesGuide = (
    <div
      className="text-xs text-[var(--color-muted)] space-y-2 py-2 box-border min-w-0"
      style={{ boxSizing: "border-box" }}
    >
      <p>
        暂无视频候选。提示词与首尾帧已在左侧参考区；需要编辑视频提示词、发起重试请进选片工作台。
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <Link
          to={storyboardUrl}
          className="inline-flex items-center gap-1 font-bold text-[var(--color-primary)] underline underline-offset-2"
        >
          前往分镜板
        </Link>
        <Link
          to={detailUrl}
          className="inline-flex items-center gap-1 font-bold text-[var(--color-primary)] underline underline-offset-2"
        >
          选片工作台
        </Link>
      </div>
    </div>
  )

  return (
    <article
      className="border-2 border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] shadow-[4px_4px_0px_0px_#111111] flex flex-col box-border"
      style={{ boxSizing: "border-box" }}
      tabIndex={onEnterPicking ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onEnterPicking) return
        if (e.key !== "Enter") return
        const t = e.target as HTMLElement
        if (t.closest("a,button,input,textarea,select")) return
        e.preventDefault()
        onEnterPicking(flatIndex)
      }}
    >
      <VideoModeSelector
        open={videoDialogOpen}
        onClose={() => setVideoDialogOpen(false)}
        shotCount={1}
        episodeAssetIds={episodeAssetIds}
        firstLastFrameAllowed={hasEndFramePath}
        onConfirm={(r) => void handleVideoModeConfirm(r)}
      />

      {/* 头部：全局镜头号、运镜/时长摘要、状态点 + 文案标签 */}
      <header
        className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[var(--color-newsprint-black)] bg-[var(--color-divider)] box-border min-w-0"
        style={{ boxSizing: "border-box" }}
      >
        <StatusIndicator status={shot.status} />
        <span className="text-xs font-black text-[var(--color-newsprint-black)] tracking-tight shrink-0">
          S{String(shot.shotNumber).padStart(2, "0")}
        </span>
        <span className="text-[10px] text-[var(--color-muted)] uppercase font-bold truncate max-w-[12rem] min-w-0">
          {shot.cameraMovement} · {shot.duration}s
        </span>
        <span
          className="text-[10px] text-[var(--color-muted)] font-bold border border-dashed border-[var(--color-newsprint-black)] px-1.5 py-0.5 shrink-0"
          title={
            shot.aspectRatio?.trim()
              ? `原始字段: ${shot.aspectRatio} · 分组键: ${aspectRatioGroupKey(shot.aspectRatio)}`
              : `分组键: ${aspectRatioGroupKey(shot.aspectRatio)}`
          }
        >
          {aspectRatioGroupKey(shot.aspectRatio)}
        </span>
        <span className="ml-auto text-[10px] font-black uppercase border border-[var(--color-newsprint-black)] px-2 py-0.5 bg-white shrink-0">
          {shotStatusLabels[shot.status]}
        </span>
        {onEnterPicking ? (
          <button
            type="button"
            className="text-[10px] font-black uppercase border border-[var(--color-primary)] bg-[var(--color-primary)] text-white px-2 py-0.5 shrink-0 hover:opacity-90 box-border"
            style={{ boxSizing: "border-box" }}
            onClick={() => onEnterPicking(flatIndex)}
          >
            进入选片
          </button>
        ) : null}
      </header>

      {/* 主体：lg+ 左右分栏；窄屏上下堆叠（参考在上、候选在下） */}
      <div
        className="flex flex-col lg:flex-row gap-4 p-4 flex-1 min-h-0 min-w-0 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <aside
          className="w-full lg:w-[22rem] xl:w-[24rem] shrink-0 flex flex-col gap-3 min-w-0 box-border"
          style={{ boxSizing: "border-box" }}
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
            className="rounded-sm border border-dashed border-[var(--color-newsprint-black)] p-2 bg-[var(--color-outline-variant)]/20 min-w-0 box-border"
            style={{ boxSizing: "border-box" }}
          >
            <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-1.5">
              提示词摘要
            </p>
            <VideoPickLeftPrompts shot={shot} />
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
                    title={`另有 ${String(extraAssetCount)} 个资产，可在选片工作台或资产库查看`}
                  >
                    +{extraAssetCount}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </aside>

        <main
          className="flex-1 min-w-0 flex flex-col gap-3 box-border"
          style={{ boxSizing: "border-box" }}
        >
          {shot.videoCandidates.length === 0 ? (
            <>
              {regenerateToolbar ?? missingFirstFrameNote}
              {emptyCandidatesGuide}
            </>
          ) : (
            <>
              <div className={gridClass}>
                {shot.videoCandidates.map((c) => {
                  const videoUrl = getFileUrl(c.videoPath, basePath, cacheBust)
                  const resLabel = c.resolution?.trim() || "—"
                  const previewTag = c.isPreview ? " [预览]" : ""
                  const canPromote = candidateCanPromoteToFullQuality(c)
                  const busy = isPromoting(c.id)
                  const newest = isPhysicallyNewest(c, shot.videoCandidates)
                  const borderSelected = c.selected
                    ? "border-[var(--color-primary)]"
                    : "border-[var(--color-border)]"
                  const newestRing =
                    newest && !c.selected
                      ? "ring-2 ring-amber-600 ring-offset-1"
                      : newest && c.selected
                        ? "ring-2 ring-amber-500/60 ring-offset-1"
                        : ""

                  return (
                    <div
                      key={c.id}
                      className={`flex flex-col border-2 ${borderSelected} ${newestRing} p-2 bg-white box-border min-w-0`}
                      style={{ boxSizing: "border-box" }}
                    >
                      {newest ? (
                        <div className="flex flex-wrap items-center gap-1 mb-1 min-w-0 box-border">
                          <span
                            className="text-[9px] font-black uppercase bg-amber-100 text-amber-950 border border-amber-700 px-1.5 py-0.5 shrink-0"
                            title="同一镜头下 createdAt 最新的成片"
                          >
                            最新
                          </span>
                        </div>
                      ) : null}
                      <VideoPlayer
                        src={videoUrl}
                        aspectRatio={shot.aspectRatio}
                      />

                      <div
                        className="mt-2 flex flex-col gap-2 flex-1 min-h-0 box-border"
                        style={{ boxSizing: "border-box" }}
                      >
                        <p className="text-[10px] text-[var(--color-muted)] leading-snug break-words">
                          {c.model} | {resLabel} | {c.mode} | seed {c.seed}
                          {previewTag}
                          {c.promotedFrom ? (
                            <span className="block mt-0.5">
                              来源预览: {c.promotedFrom}
                            </span>
                          ) : null}
                        </p>
                        <div className="flex flex-wrap gap-2 justify-end mt-auto">
                          {canPromote ? (
                            <Button
                              variant="secondary"
                              type="button"
                              disabled={busy}
                              className="text-[10px] px-2 py-1"
                              onClick={() => void promote(c.id)}
                            >
                              {busy ? "精出中…" : "精出 1080p"}
                            </Button>
                          ) : null}
                          <Button
                            variant={c.selected ? "primary" : "secondary"}
                            type="button"
                            className="text-[10px] px-2 py-1"
                            onClick={() =>
                              void selectCandidate(episodeId, shot.shotId, c.id)
                            }
                            disabled={c.selected}
                          >
                            {c.selected ? "已选定" : "选定"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {regenerateToolbar}
              {!hasFirstFrame ? missingFirstFrameNote : null}
            </>
          )}
        </main>
      </div>

      <footer
        className="px-3 py-2 border-t border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] box-border min-w-0"
        style={{ boxSizing: "border-box" }}
      >
        <Link
          to={detailUrl}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-newsprint-black)] hover:text-[var(--color-primary)] transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden />
          选片工作台（提示词 / 候选 / 迭代）
        </Link>
      </footer>
    </article>
  )
}
