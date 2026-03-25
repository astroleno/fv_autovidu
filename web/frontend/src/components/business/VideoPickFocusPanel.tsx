/**
 * VideoPickFocusPanel — 选片模式（Picking）单镜头聚焦工作台
 *
 * 布局：顶栏（模式切换、进度、仅待选开关）→ 主体左大右小（候选区 65%～75% / 参考区 25%～35%）
 * → 底栏（上一镜头 / 下一镜头 + 快捷键说明）。
 *
 * 数据与筛选与 Overview 共用 filteredFlatShots；选定仍走 shotStore.selectCandidate。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { ExternalLink, Film, Loader2 } from "lucide-react"
import {
  flattenShots,
  type GenerateVideoRequest,
  type Shot,
  type VideoMode,
} from "@/types"
import { usePromoteCandidate, useVideoPickKeyboard } from "@/hooks"
import {
  useEpisodeStore,
  useShotStore,
  useTaskStore,
  useToastStore,
  useVideoPickStore,
} from "@/stores"
import { Button } from "@/components/ui"
import { generateApi } from "@/api/generate"
import { getFileUrl } from "@/utils/file"
import { routes } from "@/utils/routes"
import {
  getDefaultActiveCandidateId,
  nextNavigatedIndex,
} from "@/utils/videoPickHelpers"
import {
  buildSingleShotVideoQuickRequest,
  toastAfterVideoTasksSettled,
} from "@/utils/videoQuickRegenerate"
import { VideoPickCandidateGrid } from "./VideoPickCandidateGrid"
import { VideoPickReferencePanel } from "./VideoPickReferencePanel"
import { VideoModeSelector, type VideoModeSelectorResult } from "./VideoModeSelector"

export interface VideoPickFocusPanelProps {
  /** 与列表页相同的筛选后扁平镜头列表（叙事顺序） */
  filteredShots: Shot[]
  projectId: string
  episodeId: string
  basePath: string
  cacheBust?: string
}

export function VideoPickFocusPanel({
  filteredShots,
  projectId,
  episodeId,
  basePath,
  cacheBust,
}: VideoPickFocusPanelProps) {
  const currentShotIndex = useVideoPickStore((s) => s.currentShotIndex)
  const setCurrentShotIndex = useVideoPickStore((s) => s.setCurrentShotIndex)
  const activeCandidateId = useVideoPickStore((s) => s.activeCandidateId)
  const setActiveCandidateId = useVideoPickStore((s) => s.setActiveCandidateId)
  const pickingOnlyPending = useVideoPickStore((s) => s.pickingOnlyPending)
  const setPickingOnlyPending = useVideoPickStore((s) => s.setPickingOnlyPending)
  const exitPicking = useVideoPickStore((s) => s.exitPicking)
  const pushUndo = useVideoPickStore((s) => s.pushUndo)
  const peekUndo = useVideoPickStore((s) => s.peekUndo)
  const popUndo = useVideoPickStore((s) => s.popUndo)

  const { selectCandidate, clearSelectedCandidate } = useShotStore()
  const currentEpisode = useEpisodeStore((s) => s.currentEpisode)
  const startPolling = useTaskStore((s) => s.startPolling)
  const pushToast = useToastStore((s) => s.push)

  const shot = filteredShots[currentShotIndex]
  const total = filteredShots.length

  const selectedCount = useMemo(
    () =>
      filteredShots.filter((s) => s.videoCandidates.some((c) => c.selected))
        .length,
    [filteredShots]
  )

  /** 当前镜头在 picking 流中的「位置」与全量筛选下的已选统计 */
  const positionLabel =
    total > 0 ? `当前第 ${currentShotIndex + 1} / ${total} 个镜头` : "当前无镜头"
  const progressLabel =
    total > 0 ? `已选 ${selectedCount} / ${total}` : "已选 0 / 0"

  /**
   * 切换镜头或数据刷新后，将激活候选同步为服务端默认。
   * 注：撤销成功后的 active 已在 handleUndo 内显式设好，避免与旧 shot 引用冲突。
   */
  useEffect(() => {
    if (!shot) return
    setActiveCandidateId(getDefaultActiveCandidateId(shot))
  }, [shot, setActiveCandidateId])

  const episodeAssetIds = useMemo(
    () => (currentEpisode?.assets ?? []).map((a) => a.assetId),
    [currentEpisode?.assets]
  )

  const [submittingVideo, setSubmittingVideo] = useState(false)
  const [submittingEndframe, setSubmittingEndframe] = useState(false)
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)

  const busyEnd = shot?.status === "endframe_generating"
  const busyVid = shot?.status === "video_generating"
  const canSubmitVideo =
    Boolean(shot?.firstFrame?.trim()) &&
    !busyEnd &&
    !busyVid &&
    !submittingVideo
  const canEndframe =
    Boolean(shot?.firstFrame) &&
    !busyEnd &&
    !busyVid &&
    !submittingEndframe
  const defaultVideoMode: VideoMode = shot?.endFrame
    ? "first_last_frame"
    : "first_frame"

  const showEndSkeleton = Boolean(shot && (busyEnd || submittingEndframe))

  const { promote, isPromoting } = usePromoteCandidate({
    episodeId,
    shotId: shot?.shotId ?? "",
  })

  /**
   * 提交当前激活候选为已选；recordUndo 为 true 时写入撤销栈（用户操作或离开镜头前自动提交）
   */
  const commitSelection = useCallback(
    async (
      targetShot: Shot,
      candidateId: string | null,
      recordUndo: boolean
    ): Promise<boolean> => {
      if (!candidateId || targetShot.videoCandidates.length === 0) return true
      const prev =
        targetShot.videoCandidates.find((c) => c.selected)?.id ?? null
      if (prev === candidateId) return true
      try {
        await selectCandidate(episodeId, targetShot.shotId, candidateId)
        if (recordUndo) {
          pushUndo({
            shotId: targetShot.shotId,
            previousCandidateId: prev,
          })
        }
        return true
      } catch (e) {
        pushToast(
          e instanceof Error ? e.message : "选定候选失败",
          "error"
        )
        return false
      }
    },
    [episodeId, pushToast, pushUndo, selectCandidate]
  )

  /**
   * 撤销：先看栈顶 → 请求成功后再 pop，避免失败丢记录。
   * previousCandidateId 为 null 时清空已选（首次选定后的撤销）。
   *
   * 同步 activeCandidateId 仅限「撤销条目所属镜头 === 当前面板镜头」：
   * 栈里可能残留其它镜头在左右键自动提交时产生的记录；若用户已切到别镜再按撤销，
   * 服务端仍会恢复那条镜头的状态，但不得把旧镜头的候选 id 写进当前镜头的激活态。
   */
  const handleUndo = useCallback(async () => {
    const entry = peekUndo()
    if (!entry) {
      pushToast("没有可撤销的操作", "info")
      return
    }
    try {
      if (entry.previousCandidateId) {
        await selectCandidate(
          episodeId,
          entry.shotId,
          entry.previousCandidateId
        )
      } else {
        await clearSelectedCandidate(episodeId, entry.shotId)
      }
      popUndo()
      if (entry.shotId === shot?.shotId) {
        if (entry.previousCandidateId) {
          setActiveCandidateId(entry.previousCandidateId)
        } else {
          const ep = useEpisodeStore.getState().currentEpisode
          const refreshed = ep
            ? flattenShots(ep).find((s) => s.shotId === entry.shotId)
            : undefined
          if (refreshed) {
            setActiveCandidateId(getDefaultActiveCandidateId(refreshed))
          }
        }
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "撤销失败", "error")
    }
  }, [
    episodeId,
    peekUndo,
    popUndo,
    pushToast,
    selectCandidate,
    clearSelectedCandidate,
    setActiveCandidateId,
    shot?.shotId,
  ])

  /** 点击 / Enter 与数字键一致：激活并立即提交已选 */
  const onActivateCandidateCommit = useCallback(
    async (candidateId: string) => {
      if (!shot) return
      setActiveCandidateId(candidateId)
      await commitSelection(shot, candidateId, true)
    },
    [commitSelection, setActiveCandidateId, shot]
  )

  const handleArrow = useCallback(
    async (dir: "prev" | "next") => {
      if (!shot || total === 0) return
      const direction = dir === "next" ? 1 : -1
      const id =
        activeCandidateId ?? getDefaultActiveCandidateId(shot)
      if (shot.videoCandidates.length > 0 && id) {
        const ok = await commitSelection(shot, id, true)
        if (!ok) return
      }
      const nextIdx = nextNavigatedIndex(
        filteredShots,
        currentShotIndex,
        pickingOnlyPending,
        direction as -1 | 1
      )
      if (nextIdx === null) {
        pushToast(
          dir === "next" ? "已是最后一个可用镜头" : "已是第一个镜头",
          "info"
        )
        return
      }
      setCurrentShotIndex(nextIdx)
    },
    [
      activeCandidateId,
      commitSelection,
      currentShotIndex,
      filteredShots,
      pickingOnlyPending,
      pushToast,
      setCurrentShotIndex,
      shot,
      total,
    ]
  )

  const primaryIds = useMemo(
    () => shot?.videoCandidates.slice(0, 4).map((c) => c.id) ?? [],
    [shot?.videoCandidates]
  )

  const allIds = useMemo(
    () => shot?.videoCandidates.map((c) => c.id) ?? [],
    [shot?.videoCandidates]
  )

  const onDigitSelect = useCallback(
    async (digit1To4: number) => {
      if (!shot) return
      const idx = digit1To4 - 1
      const c = shot.videoCandidates[idx]
      if (!c) return
      setActiveCandidateId(c.id)
      await commitSelection(shot, c.id, true)
    },
    [commitSelection, setActiveCandidateId, shot]
  )

  const onTabCycle = useCallback(
    (dir: 1 | -1) => {
      if (!shot || allIds.length === 0) return
      const cur = activeCandidateId
      const curPos = cur ? allIds.indexOf(cur) : 0
      const start = curPos >= 0 ? curPos : 0
      const nextPos = (start + dir + allIds.length) % allIds.length
      const id = allIds[nextPos]
      if (id) setActiveCandidateId(id)
    },
    [activeCandidateId, allIds, setActiveCandidateId, shot]
  )

  /**
   * Enter：提交当前激活候选（与 Tab 流、第 5+ 候选配套；用 getState 避免闭包陈旧）
   */
  const onConfirmActiveCandidate = useCallback(() => {
    if (!shot) return
    const id =
      useVideoPickStore.getState().activeCandidateId ??
      getDefaultActiveCandidateId(shot)
    if (!id) return
    setActiveCandidateId(id)
    void commitSelection(shot, id, true)
  }, [commitSelection, setActiveCandidateId, shot])

  useVideoPickKeyboard({
    enabled: Boolean(shot) && !videoDialogOpen,
    primaryCandidateIds: primaryIds,
    onDigitSelect,
    onTabCycle,
    onConfirmActive: onConfirmActiveCandidate,
    onArrow: handleArrow,
    onExitPicking: exitPicking,
    onUndo: handleUndo,
  })

  const handleEndframe = async () => {
    if (!shot || !canEndframe) return
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
            `尾帧任务已完成（S${String(shot.shotNumber).padStart(2, "0")}）`,
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

  const handleQuickRegenerateVideo = async () => {
    if (!shot || !canSubmitVideo) return
    setSubmittingVideo(true)
    try {
      const body = buildSingleShotVideoQuickRequest(
        episodeId,
        shot.shotId,
        defaultVideoMode
      )
      const res = await generateApi.video(body)
      const ids = res.data.tasks.map((t) => t.taskId)
      pushToast(
        `已提交 ${String(ids.length)} 个视频任务（S${String(shot.shotNumber).padStart(2, "0")}）`,
        "info",
        5000
      )
      startPolling(ids, {
        episodeId,
        onPollAborted: () => {
          pushToast(
            `视频任务轮询中断（S${String(shot.shotNumber).padStart(2, "0")}），请刷新页面后查看结果`,
            "error",
            8000
          )
        },
        onAllSettled: (results) => {
          toastAfterVideoTasksSettled(
            results,
            pushToast,
            `S${String(shot.shotNumber).padStart(2, "0")}`
          )
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "视频生成请求失败", "error")
    } finally {
      setSubmittingVideo(false)
    }
  }

  const handleVideoModeConfirm = async (result: VideoModeSelectorResult) => {
    if (!shot || !canSubmitVideo) return
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
        `已提交 ${String(ids.length)} 个视频任务（S${String(shot.shotNumber).padStart(2, "0")}）`,
        "info",
        5000
      )
      startPolling(ids, {
        episodeId,
        onPollAborted: () => {
          pushToast(
            `视频任务轮询中断（S${String(shot.shotNumber).padStart(2, "0")}），请刷新页面后查看结果`,
            "error",
            8000
          )
        },
        onAllSettled: (results) => {
          toastAfterVideoTasksSettled(
            results,
            pushToast,
            `S${String(shot.shotNumber).padStart(2, "0")}`
          )
        },
      })
      setVideoDialogOpen(false)
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "视频生成请求失败", "error")
    } finally {
      setSubmittingVideo(false)
    }
  }

  if (!shot) {
    return (
      <div
        className="p-8 box-border max-w-xl"
        style={{ boxSizing: "border-box" }}
      >
        <p className="text-sm text-[var(--color-muted)] mb-4">
          当前筛选下没有可展示的镜头。请返回列表调整筛选条件。
        </p>
        <Button type="button" variant="secondary" onClick={() => exitPicking()}>
          返回列表
        </Button>
      </div>
    )
  }

  const shotLabel = `S${String(shot.shotNumber).padStart(2, "0")}`
  const detailUrl = routes.shot(projectId, episodeId, shot.shotId)
  const hasFirstFrame = Boolean(shot.firstFrame?.trim())
  const nCandidates = shot.videoCandidates.length

  const regenerateToolbar = hasFirstFrame ? (
    <div
      className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] p-2 box-border"
      style={{ boxSizing: "border-box" }}
    >
      <span className="text-[9px] font-black uppercase text-[var(--color-muted)] shrink-0 w-full sm:w-auto">
        {nCandidates > 0 ? "增加候选 / 重跑" : "生成视频"}
      </span>
      <Button
        type="button"
        variant="secondary"
        disabled={!canSubmitVideo}
        className="text-[10px] px-2 py-1.5 gap-1.5 h-auto box-border"
        style={{ boxSizing: "border-box" }}
        onClick={() => void handleQuickRegenerateVideo()}
      >
        {submittingVideo ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
        ) : (
          <Film className="w-3.5 h-3.5 shrink-0" aria-hidden />
        )}
        重新生成视频
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
    </div>
  ) : null

  const compareHint =
    hasFirstFrame && nCandidates < 2 ? (
      <div
        className="flex flex-wrap items-center gap-2 rounded-sm border border-dashed border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]/40 p-3 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-[var(--color-newsprint-black)]">
            当前镜头只有 {nCandidates} 个候选，暂时无法比选。
          </p>
          <p className="text-[10px] text-[var(--color-muted)] mt-1">
            选片模式会展示该镜头的全部候选。要进入比选，需要先补生成更多候选视频。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!canSubmitVideo}
            className="text-[10px] px-2 py-1.5 h-auto box-border"
            style={{ boxSizing: "border-box" }}
            onClick={() => void handleQuickRegenerateVideo()}
          >
            再生成 2 个预览候选
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canSubmitVideo}
            className="text-[10px] px-2 py-1.5 h-auto box-border"
            style={{ boxSizing: "border-box" }}
            onClick={() => setVideoDialogOpen(true)}
          >
            自定义生成
          </Button>
        </div>
      </div>
    ) : null

  return (
    <div
      className="flex flex-col gap-4 min-h-0 min-w-0 box-border"
      style={{ boxSizing: "border-box" }}
    >
      <VideoModeSelector
        open={videoDialogOpen}
        onClose={() => setVideoDialogOpen(false)}
        shotCount={1}
        episodeAssetIds={episodeAssetIds}
        onConfirm={(r) => void handleVideoModeConfirm(r)}
      />

      <header
        className="flex flex-wrap items-center gap-3 gap-y-2 border-b border-[var(--color-newsprint-black)] pb-3 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <span className="text-xs font-bold text-[var(--color-newsprint-black)]">
          {positionLabel}
        </span>
        <span className="text-xs font-bold text-[var(--color-muted)]">
          {progressLabel}
        </span>
        <span className="text-[10px] font-black uppercase text-[var(--color-muted)]">
          {shotLabel}
        </span>
        <label
          className="inline-flex items-center gap-2 text-[10px] font-bold cursor-pointer select-none ml-auto box-border"
          style={{ boxSizing: "border-box" }}
        >
          <input
            type="checkbox"
            checked={pickingOnlyPending}
            onChange={(e) => setPickingOnlyPending(e.target.checked)}
            className="rounded border border-[var(--color-newsprint-black)]"
          />
          左右键仅跳待选镜头
        </label>
      </header>

      <div
        className="flex flex-col lg:flex-row gap-4 min-h-0 min-w-0 flex-1 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <section
          className="flex-[1_1_68%] min-w-0 flex flex-col gap-3 box-border"
          style={{ boxSizing: "border-box", flexBasis: "68%" }}
          aria-label="候选视频"
        >
          {compareHint}

          <VideoPickCandidateGrid
            shot={shot}
            activeCandidateId={activeCandidateId}
            onActivateCandidate={(id) => void onActivateCandidateCommit(id)}
            getVideoUrl={(path) => getFileUrl(path, basePath, cacheBust)}
          />

          {shot.videoCandidates.length > 0 ? (
            <div
              className="flex flex-wrap gap-2 justify-end box-border"
              style={{ boxSizing: "border-box" }}
            >
              {shot.videoCandidates.map((c) => {
                const canPromote =
                  Boolean(c.isPreview) &&
                  c.taskStatus === "success" &&
                  c.seed > 0
                const busy = isPromoting(c.id)
                if (!canPromote) return null
                return (
                  <Button
                    key={`promo-${c.id}`}
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    className="text-[10px] px-2 py-1"
                    onClick={() => void promote(c.id)}
                  >
                    {busy ? "精出中…" : `精出 #${shot.videoCandidates.indexOf(c) + 1}`}
                  </Button>
                )
              })}
            </div>
          ) : null}

          {regenerateToolbar}
          {!hasFirstFrame ? (
            <p className="text-[10px] text-[var(--color-muted)] box-border" style={{ boxSizing: "border-box" }}>
              缺少首帧路径，无法在此发起视频生成；请先在分镜板或平台侧补齐首帧。
            </p>
          ) : null}

          <Link
            to={detailUrl}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-newsprint-black)] hover:text-[var(--color-primary)] transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden />
            镜头详情（完整编辑）
          </Link>
        </section>

        <section
          className="flex-[1_1_32%] min-w-0 flex flex-col box-border lg:max-w-md"
          style={{ boxSizing: "border-box", flexBasis: "32%" }}
        >
          <VideoPickReferencePanel
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
        </section>
      </div>

      <footer
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-[var(--color-newsprint-black)] pt-3 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <div className="flex flex-wrap gap-2 box-border" style={{ boxSizing: "border-box" }}>
          <Button
            type="button"
            variant="secondary"
            className="text-[10px] px-3 py-1.5 box-border"
            style={{ boxSizing: "border-box" }}
            onClick={() => void handleArrow("prev")}
          >
            ← 上一镜头
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="text-[10px] px-3 py-1.5 box-border"
            style={{ boxSizing: "border-box" }}
            onClick={() => void handleArrow("next")}
          >
            下一镜头 →
          </Button>
        </div>
        <p className="text-[9px] text-[var(--color-muted)] max-w-xl leading-snug box-border" style={{ boxSizing: "border-box" }}>
          快捷键：1–4 选定前四个候选 · Tab 切换激活 · Enter 确认当前激活候选 · ←
          → 提交并切镜头 · Esc 返回列表 · Ctrl+Z 撤销
        </p>
      </footer>
    </div>
  )
}
