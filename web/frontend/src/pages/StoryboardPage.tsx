/**
 * 分镜板总览页（核心）
 * Scene 分组 + Shot 卡片/行 + 状态筛选 + 批量操作 + 视图切换
 * 批量生成尾帧 / 批量生成视频：均先弹窗确认再调用 generateApi，taskStore 轮询并在完成后 Toast
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router"
import {
  Clapperboard,
  CheckSquare,
  Grid3X3,
  List,
  Film,
  ImagePlus,
  Loader2,
  Package,
  Sparkles,
} from "lucide-react"
import { useEpisodeMediaCacheBust, useStoryboardTableColumnWidths } from "@/hooks"
import { useEpisodeFileBasePath } from "@/hooks/useEpisodeFileBasePath"
import { useEpisodeStore, useShotStore, useTaskStore, useToastStore } from "@/stores"
import { filterShotsByBatchPick } from "@/utils/batchPick"
import { Button, Skeleton } from "@/components/ui"
import {
  BatchPickScopeControl,
  BatchResultSummary,
  BatchTaskProgressBanner,
  MarqueeGrid,
  SceneGroup,
  STORYBOARD_COL_HEADER_LABEL,
  ShotCard,
  ShotRow,
  StoryboardResizableTh,
  sumStoryboardTableWidthPx,
  VideoModeSelector,
  type VideoModeSelectorInitialValue,
  type VideoModeSelectorResult,
  BatchOperationConfirmDialog,
} from "@/components/business"
import { flattenShots } from "@/types"
import type { ShotStatus } from "@/types"
import type { GenerateVideoRequest, TaskStatusResponse } from "@/types"
import { generateApi } from "@/api/generate"
import { buildRetryVideoDialogConfig } from "@/utils/videoBatchRetry"
import { routes } from "@/utils/routes"

const STATUS_FILTERS: { value: ShotStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待处理" },
  { value: "endframe_done", label: "尾帧完成" },
  { value: "video_done", label: "视频完成" },
  { value: "selected", label: "已选定" },
]

export default function StoryboardPage() {
  const { projectId: routeProjectId, episodeId } = useParams<{
    projectId?: string
    episodeId: string
  }>()
  const {
    currentEpisode,
    loading,
    error: episodeError,
    fetchEpisodeDetail,
  } = useEpisodeStore()
  /** 尾帧/视频写入后 pulledAt 不变，需与 localMediaEpoch 组合才能刷新缩略图 */
  const cacheBust = useEpisodeMediaCacheBust(currentEpisode?.pulledAt)
  const {
    statusFilter,
    viewMode,
    setFilter,
    setViewMode,
    setShots,
    batchPickMode,
    batchPickedShotIds,
    setBatchPickMode,
    toggleBatchPickShot,
    addBatchPickShots,
    clearBatchPicks,
  } = useShotStore()
  const startPolling = useTaskStore((s) => s.startPolling)
  const pushToast = useToastStore((s) => s.push)

  /** 列表视图列宽：拖拽调整 + localStorage 按剧集记忆 */
  const storyboardListPickMode = batchPickMode === "manual"
  const {
    widths: storyboardColWidths,
    setColumnWidthLive: onStoryboardColDrag,
    commitColumnWidth: onStoryboardColCommit,
    colOrder: storyboardColOrder,
  } = useStoryboardTableColumnWidths(episodeId, storyboardListPickMode)
  const storyboardTableWidthPx = useMemo(
    () => sumStoryboardTableWidthPx(storyboardColOrder, storyboardColWidths),
    [storyboardColOrder, storyboardColWidths]
  )

  const [batchEndBusy, setBatchEndBusy] = useState(false)
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)
  /** 批量尾帧：二次确认（与视频批量「先弹窗再提交」一致） */
  const [endframeConfirmOpen, setEndframeConfirmOpen] = useState(false)
  /**
   * null：批量「尾帧已完成」——完整模式选择器；
   * first_frame：批量「首帧模式」——锁定仅首帧 i2v，弹窗内自选模型/分辨率（曾硬编码 2fast+720p）。
   */
  const [videoDialogLockedMode, setVideoDialogLockedMode] = useState<
    null | "first_frame"
  >(null)
  const [videoDialogInitialValue, setVideoDialogInitialValue] =
    useState<VideoModeSelectorInitialValue>()
  const [videoDialogTitle, setVideoDialogTitle] = useState<string>()
  const [videoRetryShotIds, setVideoRetryShotIds] = useState<string[] | null>(null)
  /** 批量结果汇总弹窗（尾帧 / 视频） */
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryKind, setSummaryKind] = useState<"endframe" | "video">("video")
  const [summaryTaskToShot, setSummaryTaskToShot] = useState<Record<string, string>>({})
  const [summaryResults, setSummaryResults] = useState<TaskStatusResponse[]>([])
  /** 上一次批量视频请求参数，用于「重试失败镜头」保持一致 mode/model */
  const lastVideoBatchParamsRef = useRef<GenerateVideoRequest | null>(null)
  /** 分镜「工作区」：筛选/批量/镜头列表；框选模式下点击此区域外则退出框选（弹窗内点击不退出） */
  const storyboardWorkAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (episodeId) {
      void fetchEpisodeDetail(episodeId)
    }
  }, [episodeId, fetchEpisodeDetail])

  useEffect(() => {
    if (currentEpisode) {
      setShots(flattenShots(currentEpisode))
    }
  }, [currentEpisode, setShots])

  /** 切换剧集时重置为「全部符合条件」，避免沿用上一集的勾选 id */
  useEffect(() => {
    setBatchPickMode("all_eligible")
  }, [episodeId, setBatchPickMode])

  /**
   * 框选模式：在分镜工作区外按下鼠标时退出（返回「全部符合条件」）
   * 捕获阶段先于子组件处理；若点击在 Dialog 内或遮罩上则不退出（避免与弹窗冲突）
   */
  useEffect(() => {
    if (batchPickMode !== "manual") return
    const onDown = (e: MouseEvent) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (storyboardWorkAreaRef.current?.contains(t)) return
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest('[role="dialog"]')) return
      if (el?.closest("[aria-modal]")) return
      setBatchPickMode("all_eligible")
    }
    document.addEventListener("mousedown", onDown, true)
    return () => document.removeEventListener("mousedown", onDown, true)
  }, [batchPickMode, setBatchPickMode])

  /**
   * 以下 useMemo 必须在任何 early return 之前调用，否则 loading/无数据时少跑 hooks，
   * 会在「有数据后」触发 Rendered more hooks than during the previous render。
   */
  const allShots = useMemo(
    () => (currentEpisode ? flattenShots(currentEpisode) : []),
    [currentEpisode]
  )
  const pendingShots = useMemo(
    () =>
      allShots.filter(
        (s) => s.status === "pending" && Boolean(s.firstFrame?.trim())
      ),
    [allShots]
  )
  const endframeDoneShots = useMemo(
    () => allShots.filter((s) => s.status === "endframe_done"),
    [allShots]
  )
  const firstFrameBatchShots = useMemo(
    () =>
      allShots.filter((s) => {
        if (!s.firstFrame?.trim()) return false
        if (s.status === "endframe_generating" || s.status === "video_generating") {
          return false
        }
        return true
      }),
    [allShots]
  )
  const pendingForBatch = useMemo(
    () => filterShotsByBatchPick(batchPickMode, batchPickedShotIds, pendingShots),
    [batchPickMode, batchPickedShotIds, pendingShots]
  )
  const endframeForBatch = useMemo(
    () => filterShotsByBatchPick(batchPickMode, batchPickedShotIds, endframeDoneShots),
    [batchPickMode, batchPickedShotIds, endframeDoneShots]
  )
  const firstFrameForBatch = useMemo(
    () => filterShotsByBatchPick(batchPickMode, batchPickedShotIds, firstFrameBatchShots),
    [batchPickMode, batchPickedShotIds, firstFrameBatchShots]
  )
  const visibleShotIds = useMemo(
    () =>
      allShots
        .filter((s) => statusFilter === "all" || s.status === statusFilter)
        .map((s) => s.shotId),
    [allShots, statusFilter]
  )
  const basePath = useEpisodeFileBasePath()

  if (!episodeId) return null
  if (loading && !currentEpisode) {
    return (
      <div className="p-8">
        <Skeleton height={48} className="mb-8" />
        <div className="grid grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={200} />
          ))}
        </div>
      </div>
    )
  }
  if (!currentEpisode) {
    const is404 =
      episodeError?.toLowerCase().includes("not found") ||
      episodeError?.includes("未找到")
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-4">
        <p className="text-[var(--color-newsprint-black)] font-bold">
          {is404 ? "本地尚未找到该剧集数据" : "未找到该剧集"}
        </p>
        <p className="text-sm text-[var(--color-muted)]">
          {is404
            ? "请从对应项目详情页使用「拉取后进入」，或顶部「从平台拉取」写入本地后再打开。"
            : episodeError || "请确认路由中的剧集 ID 是否正确。"}
        </p>
        {routeProjectId ? (
          <Link
            to={routes.project(routeProjectId)}
            className="inline-block text-sm font-bold text-[var(--color-primary)] underline"
          >
            返回项目详情
          </Link>
        ) : null}
      </div>
    )
  }

  /** 新路由 URL 中带 projectId；兼容时回退到 episode.json */
  const projectId = routeProjectId ?? currentEpisode.projectId
  const episodeAssetIds = (currentEpisode.assets ?? []).map((a) => a.assetId)

  const handleBatchEndframe = async () => {
    if (!episodeId || pendingForBatch.length === 0) {
      if (batchPickMode === "manual" && pendingShots.length > 0) {
        pushToast("框选模式下请勾选待生成尾帧的镜头，或改回「全部符合条件」", "info")
      }
      return
    }
    setBatchEndBusy(true)
    try {
      const res = await generateApi.endframe({
        episodeId,
        shotIds: pendingForBatch.map((s) => s.shotId),
      })
      const taskToShot: Record<string, string> = {}
      res.data.tasks.forEach((t) => {
        taskToShot[t.taskId] = t.shotId
      })
      const ids = res.data.tasks.map((t) => t.taskId)
      pushToast(
        `已提交 ${ids.length} 个尾帧任务，镜头将显示「尾帧生成中」；完成后会弹出汇总`,
        "info"
      )
      startPolling(ids, {
        episodeId,
        onAllSettled: (results) => {
          setSummaryKind("endframe")
          setSummaryTaskToShot(taskToShot)
          setSummaryResults(results)
          setSummaryOpen(true)
          pushToast("批量尾帧任务已全部结束", "success")
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "批量尾帧请求失败", "error")
    } finally {
      setBatchEndBusy(false)
    }
  }

  const handleVideoModeConfirm = async (result: VideoModeSelectorResult) => {
    if (!episodeId || endframeForBatch.length === 0) {
      if (batchPickMode === "manual" && endframeDoneShots.length > 0) {
        pushToast("框选模式下请勾选尾帧已完成的镜头，或改回「全部符合条件」", "info")
      }
      return
    }
    try {
      const body: GenerateVideoRequest = {
        episodeId,
        shotIds: endframeForBatch.map((s) => s.shotId),
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
      lastVideoBatchParamsRef.current = body
      const res = await generateApi.video(body)
      const taskToShot: Record<string, string> = {}
      res.data.tasks.forEach((t) => {
        taskToShot[t.taskId] = t.shotId
      })
      const ids = res.data.tasks.map((t) => t.taskId)
      pushToast(
        `已提交 ${ids.length} 个视频任务，镜头将显示「视频生成中」；完成后会弹出汇总`,
        "info"
      )
      startPolling(ids, {
        episodeId,
        onAllSettled: (results) => {
          setSummaryKind("video")
          setSummaryTaskToShot(taskToShot)
          setSummaryResults(results)
          setSummaryOpen(true)
          const nFail = results.filter((r) => r.status === "failed").length
          if (nFail > 0) {
            pushToast(
              `批量视频已结束：${nFail} 个失败，请查看汇总`,
              "error"
            )
          } else {
            pushToast("批量视频任务已全部结束", "success")
          }
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "批量视频请求失败", "error")
    }
  }

  /**
   * 批量首帧视频（mode=first_frame）：目标为 firstFrameBatchShots，与尾帧是否完成无关。
   * 模型/分辨率由 VideoModeSelector（lockedMode=first_frame）传入，与「尾帧已完成」批量一致可配置。
   */
  const handleFirstFrameBatchVideoConfirm = async (
    result: VideoModeSelectorResult
  ) => {
    if (!episodeId || firstFrameForBatch.length === 0) {
      if (batchPickMode === "manual" && firstFrameBatchShots.length > 0) {
        pushToast("框选模式下请勾选需要首帧视频的镜头，或改回「全部符合条件」", "info")
      }
      return
    }
    try {
      const body: GenerateVideoRequest = {
        episodeId,
        shotIds: firstFrameForBatch.map((s) => s.shotId),
        mode: "first_frame",
        model: result.model,
        resolution: result.resolution,
      }
      lastVideoBatchParamsRef.current = body
      const res = await generateApi.video(body)
      const taskToShot: Record<string, string> = {}
      res.data.tasks.forEach((t) => {
        taskToShot[t.taskId] = t.shotId
      })
      const ids = res.data.tasks.map((t) => t.taskId)
      pushToast(
        `已提交 ${ids.length} 个首帧视频任务；完成后会弹出汇总`,
        "info"
      )
      startPolling(ids, {
        episodeId,
        onAllSettled: (results) => {
          setSummaryKind("video")
          setSummaryTaskToShot(taskToShot)
          setSummaryResults(results)
          setSummaryOpen(true)
          const nFail = results.filter((r) => r.status === "failed").length
          pushToast(
            nFail > 0
              ? `批量首帧视频已结束：${nFail} 个失败，请查看汇总`
              : "批量首帧视频任务已全部结束",
            nFail > 0 ? "error" : "success"
          )
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "批量首帧视频请求失败", "error")
    }
  }

  const handleRetryVideoConfirm = async (
    shotIds: string[],
    result: VideoModeSelectorResult
  ) => {
    if (!episodeId || shotIds.length === 0) return
    try {
      const body: GenerateVideoRequest = {
        episodeId,
        shotIds,
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
      lastVideoBatchParamsRef.current = body
      const res = await generateApi.video(body)
      const taskToShot: Record<string, string> = {}
      res.data.tasks.forEach((t) => {
        taskToShot[t.taskId] = t.shotId
      })
      const ids = res.data.tasks.map((t) => t.taskId)
      pushToast(`已重试 ${ids.length} 个视频任务；完成后会弹出汇总`, "info")
      startPolling(ids, {
        episodeId,
        onAllSettled: (results) => {
          setSummaryKind("video")
          setSummaryTaskToShot(taskToShot)
          setSummaryResults(results)
          setSummaryOpen(true)
          const nFail = results.filter((r) => r.status === "failed").length
          pushToast(
            nFail > 0
              ? `重试任务已结束：${nFail} 个失败，请查看汇总`
              : "重试任务已全部结束",
            nFail > 0 ? "error" : "success"
          )
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "重试失败", "error")
    }
  }

  const resetVideoDialogState = () => {
    setVideoDialogOpen(false)
    setVideoDialogLockedMode(null)
    setVideoDialogInitialValue(undefined)
    setVideoDialogTitle(undefined)
    setVideoRetryShotIds(null)
  }

  const openRetryVideoDialog = (failedShotIds: string[]) => {
    const base = lastVideoBatchParamsRef.current
    if (!base) {
      pushToast("无法重试：缺少上一次批量视频参数", "error")
      return
    }
    const cfg = buildRetryVideoDialogConfig(base)
    setSummaryOpen(false)
    setVideoDialogLockedMode(cfg.lockedMode ?? null)
    setVideoDialogInitialValue(cfg.initialValue)
    setVideoDialogTitle(cfg.dialogTitle)
    setVideoRetryShotIds(failedShotIds)
    setVideoDialogOpen(true)
  }

  return (
    <div className="p-8">
      <BatchResultSummary
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        kind={summaryKind}
        taskToShotId={summaryTaskToShot}
        results={summaryResults}
        onRetryFailed={(failedShotIds) => {
          if (!episodeId || failedShotIds.length === 0) return
          if (summaryKind === "endframe") {
            void generateApi
              .endframe({ episodeId, shotIds: failedShotIds })
              .then((res) => {
                const taskToShot: Record<string, string> = {}
                res.data.tasks.forEach((t) => {
                  taskToShot[t.taskId] = t.shotId
                })
                startPolling(
                  res.data.tasks.map((t) => t.taskId),
                  {
                    episodeId,
                    onAllSettled: (results) => {
                      setSummaryKind("endframe")
                      setSummaryTaskToShot(taskToShot)
                      setSummaryResults(results)
                      setSummaryOpen(true)
                    },
                  }
                )
              })
              .catch((e: unknown) =>
                pushToast(e instanceof Error ? e.message : "重试失败", "error")
              )
          } else {
            openRetryVideoDialog(failedShotIds)
          }
        }}
      />

      <BatchOperationConfirmDialog
        open={endframeConfirmOpen}
        onClose={() => setEndframeConfirmOpen(false)}
        kind="endframe"
        shotCount={pendingForBatch.length}
        onConfirm={() => {
          setEndframeConfirmOpen(false)
          void handleBatchEndframe()
        }}
      />

      <VideoModeSelector
        key={videoDialogLockedMode === "first_frame" ? "sb-ff" : "sb-main"}
        open={videoDialogOpen}
        onClose={resetVideoDialogState}
        shotCount={
          videoRetryShotIds?.length
            ? videoRetryShotIds.length
            : videoDialogLockedMode === "first_frame"
            ? firstFrameForBatch.length
            : endframeForBatch.length
        }
        lockedMode={videoDialogLockedMode ?? undefined}
        dialogTitle={videoDialogTitle}
        initialValue={videoDialogInitialValue}
        episodeAssetIds={episodeAssetIds}
        onConfirm={(r) => {
          if (videoRetryShotIds?.length) {
            void handleRetryVideoConfirm(videoRetryShotIds, r)
          } else if (videoDialogLockedMode === "first_frame") {
            void handleFirstFrameBatchVideoConfirm(r)
          } else {
            void handleVideoModeConfirm(r)
          }
        }}
      />

      <BatchTaskProgressBanner />

      <div className="mb-10 border-l-4 border-[var(--color-primary)] pl-6">
        <h1 className="text-4xl font-extrabold tracking-tighter text-[var(--color-newsprint-black)] uppercase mb-1 font-headline">
          {currentEpisode.episodeTitle} - 分镜板总览
        </h1>
        <p className="text-[var(--color-newsprint-black)] font-medium opacity-70 text-sm uppercase tracking-tight">
          {flattenShots(currentEpisode).length} 个镜头
        </p>
        {/* 子页面入口：粗剪台、资产库；看单条视频需进镜头详情（卡片可点） */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold uppercase tracking-wider">
          <span className="text-[var(--color-muted)] font-medium normal-case tracking-normal text-[13px]">
            点击镜头进入选片工作台：查看候选、编辑视频提示词、快速重试
          </span>
          <Link
            to={routes.timeline(projectId, episodeId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-newsprint-black)] bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity box-border"
            style={{ boxSizing: "border-box" }}
          >
            <Clapperboard className="w-4 h-4 shrink-0" aria-hidden />
            粗剪预览
          </Link>
          <Link
            to={routes.videopick(projectId, episodeId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-newsprint-black)] bg-transparent hover:bg-[var(--color-outline-variant)] transition-colors box-border"
            style={{ boxSizing: "border-box" }}
          >
            <CheckSquare className="w-4 h-4 shrink-0" aria-hidden />
            选片总览
          </Link>
          <Link
            to={routes.assets(projectId, episodeId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-newsprint-black)] bg-transparent hover:bg-[var(--color-outline-variant)] transition-colors box-border"
            style={{ boxSizing: "border-box" }}
          >
            <Package className="w-4 h-4 shrink-0" aria-hidden />
            资产库
          </Link>
          <Link
            to={routes.postProduction(projectId, episodeId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] hover:bg-[var(--color-outline-variant)] transition-colors box-border"
            style={{ boxSizing: "border-box" }}
          >
            <Sparkles className="w-4 h-4 shrink-0" aria-hidden />
            后期制作
          </Link>
        </div>
      </div>

      {/* 剧集语言：只读；编辑与配音/剪映全量能力在后期制作页（设计 §11.6） */}
      <div
        className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 p-4 border border-[var(--color-divider)] bg-[var(--color-newsprint-off-white)]/40 box-border text-sm"
        style={{ boxSizing: "border-box" }}
      >
        <div className="flex flex-wrap gap-x-6 gap-y-1 min-w-0">
          <p className="text-[var(--color-ink)]">
            <span className="text-[10px] font-black uppercase text-[var(--color-muted)] mr-2">
              配音目标语
            </span>
            <span className="font-mono">
              {(currentEpisode.dubTargetLocale ?? "").trim() || "—"}
            </span>
          </p>
          <p className="text-[var(--color-ink)]">
            <span className="text-[10px] font-black uppercase text-[var(--color-muted)] mr-2">
              原文语言
            </span>
            <span className="font-mono">
              {(currentEpisode.sourceLocale ?? "").trim() || "—"}
            </span>
          </p>
        </div>
        <Link
          to={routes.postProduction(projectId, episodeId)}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--color-primary)] hover:underline shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden />
          到后期制作修改
        </Link>
      </div>

      {/* 分镜工作区：筛选、批量、镜头列表；框选模式下点击此区域外退出框选 */}
      <div
        ref={storyboardWorkAreaRef}
        className="space-y-0 box-border"
        style={{ boxSizing: "border-box" }}
        data-storyboard-work-area
      >
      {/* 筛选 + 批量操作 + 视图切换；框选模式下禁止选中文字，避免与拖拽框选、勾选冲突 */}
      <div
        className={`mb-8 space-y-2 box-border ${
          batchPickMode === "manual"
            ? "select-none [-webkit-user-select:none]"
            : ""
        }`}
        style={{ boxSizing: "border-box" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border transition-colors ${
                statusFilter === f.value
                  ? "bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)] border-[var(--color-newsprint-black)]"
                  : "bg-transparent text-[var(--color-ink)] border-[var(--color-newsprint-black)] hover:bg-[var(--color-outline-variant)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 border border-[var(--color-newsprint-black)] overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`p-2 ${viewMode === "grid" ? "bg-[var(--color-primary)] text-white" : ""}`}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`p-2 ${viewMode === "list" ? "bg-[var(--color-primary)] text-white" : ""}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BatchPickScopeControl
              mode={batchPickMode}
              onModeChange={setBatchPickMode}
              pickedCount={batchPickedShotIds.length}
              visibleShotIds={visibleShotIds}
              onPickMany={addBatchPickShots}
              onClearPicks={clearBatchPicks}
            />
            <Button
              variant="secondary"
              className="gap-2"
              disabled={pendingForBatch.length === 0 || batchEndBusy}
              onClick={() => setEndframeConfirmOpen(true)}
              title="先确认镜头数量与说明，再提交尾帧任务"
            >
              {batchEndBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ImagePlus className="w-4 h-4" />
              )}
              批量生成尾帧 ({pendingForBatch.length})
            </Button>
            <Button
              variant="secondary"
              className="gap-2"
              disabled={endframeForBatch.length === 0}
              onClick={() => {
                setVideoDialogLockedMode(null)
                setVideoDialogInitialValue(undefined)
                setVideoDialogTitle(undefined)
                setVideoRetryShotIds(null)
                setVideoDialogOpen(true)
              }}
              title="针对尾帧已完成镜头，可选首尾帧/多参考等模式"
            >
              <Film className="w-4 h-4" />
              批量视频·尾帧已完成 ({endframeForBatch.length})
            </Button>
            <Button
              variant="secondary"
              className="gap-2"
              disabled={firstFrameForBatch.length === 0}
              onClick={() => {
                setVideoDialogLockedMode("first_frame")
                setVideoDialogInitialValue(undefined)
                setVideoDialogTitle(undefined)
                setVideoRetryShotIds(null)
                setVideoDialogOpen(true)
              }}
              title="凡有首帧且未在生成中的镜头均可批量走首帧图生视频；打开弹窗可选模型与分辨率（默认 540p+turbo）"
            >
              <Film className="w-4 h-4" />
              批量视频·首帧模式 ({firstFrameForBatch.length})
            </Button>
            <Link
              to={routes.postProduction(projectId, episodeId)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border-2 border-[var(--color-newsprint-black)] bg-white hover:bg-[var(--color-outline-variant)] transition-colors box-border"
              style={{ boxSizing: "border-box" }}
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden />
              导出 / 剪映
            </Link>
          </div>
        </div>
        </div>
        {batchPickMode === "manual" && (
          <p className="text-[10px] text-[var(--color-muted)] max-w-3xl leading-relaxed">
            框选模式：列表勾选首列；网格可勾选「选」或在卡片区左键拖拽矩形框选；指针靠近主内容区上下左右边缘时会自动滚动。点击本页上方剧集标题区、侧栏、或点「退出框选」结束。三项批量（尾帧 / 两路视频）均先弹窗确认再提交任务，且仅作用于「已勾选且符合条件」的镜头。
          </p>
        )}
      </div>

      {/* Scene 分组（框选模式下同样禁止选中表格/卡片内文案） */}
      <div
        className={
          batchPickMode === "manual"
            ? "select-none [-webkit-user-select:none] box-border"
            : "box-border"
        }
        style={{ boxSizing: "border-box" }}
      >
      {currentEpisode.scenes.map((scene) => {
        const sceneShots = scene.shots.filter((s) =>
          statusFilter === "all" ? true : s.status === statusFilter
        )
        if (sceneShots.length === 0) return null
        return (
          <SceneGroup key={scene.sceneId} scene={{ ...scene, shots: sceneShots }}>
            {viewMode === "grid" ? (
              <MarqueeGrid
                enabled={batchPickMode === "manual"}
                onPickShotIds={addBatchPickShots}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {sceneShots.map((shot) => (
                    <ShotCard
                      key={shot.shotId}
                      shot={shot}
                      projectId={projectId}
                      episodeId={episodeId!}
                      basePath={basePath}
                      cacheBust={cacheBust}
                      pickMode={batchPickMode === "manual"}
                      batchPicked={batchPickedShotIds.includes(shot.shotId)}
                      onBatchPickToggle={() => toggleBatchPickShot(shot.shotId)}
                    />
                  ))}
                </div>
              </MarqueeGrid>
            ) : (
              <MarqueeGrid
                enabled={batchPickMode === "manual"}
                onPickShotIds={addBatchPickShots}
              >
                <div
                  className="w-full overflow-x-auto box-border"
                  style={{ boxSizing: "border-box" }}
                >
                  <table
                    className="border-collapse"
                    style={{
                      tableLayout: "fixed",
                      width: storyboardTableWidthPx,
                      boxSizing: "border-box",
                    }}
                  >
                    <colgroup>
                      {storyboardColOrder.map((k) => (
                        <col
                          key={k}
                          style={{ width: storyboardColWidths[k] }}
                        />
                      ))}
                    </colgroup>
                    <thead>
                      <tr className="border-b border-[var(--color-divider)]">
                        {storyboardColOrder.map((k, i) => (
                          <StoryboardResizableTh
                            key={k}
                            colKey={k}
                            widthPx={storyboardColWidths[k]}
                            onDragWidth={onStoryboardColDrag}
                            onCommitWidth={onStoryboardColCommit}
                            ariaLabel={STORYBOARD_COL_HEADER_LABEL[k]}
                            isLastColumn={
                              i === storyboardColOrder.length - 1
                            }
                            showLeadingGrip={i > 0}
                            className={
                              k === "duration" ? "whitespace-nowrap" : ""
                            }
                          >
                            {STORYBOARD_COL_HEADER_LABEL[k]}
                          </StoryboardResizableTh>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sceneShots.map((shot) => (
                        <ShotRow
                          key={shot.shotId}
                          shot={shot}
                          projectId={projectId}
                          episodeId={episodeId!}
                          basePath={basePath}
                          cacheBust={cacheBust}
                          pickMode={batchPickMode === "manual"}
                          batchPicked={batchPickedShotIds.includes(
                            shot.shotId
                          )}
                          onBatchPickToggle={() =>
                            toggleBatchPickShot(shot.shotId)
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </MarqueeGrid>
            )}
          </SceneGroup>
        )
      })}
      </div>
      </div>
    </div>
  )
}
