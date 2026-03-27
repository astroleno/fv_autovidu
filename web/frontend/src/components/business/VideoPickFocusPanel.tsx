/**
 * VideoPickFocusPanel — 选片模式（Picking）单镜头聚焦工作台
 *
 * 布局：顶栏（进度、仅待选开关）→ 主体左大右小（候选区约 65–68% / 参考区约 32–35%）→ 底栏快捷键说明。
 *
 * ## 生成与再生成
 * 所有「生成视频 / 尾帧 / 自定义参数」已收口至右侧 `VideoPickReferencePanel`，候选区仅保留候选网格与精出按钮，
 * 避免与参考区重复维护两套逻辑。
 *
 * ## 键盘
 * `useVideoPickKeyboard` 在以下情况禁用：无当前镜头、参考区/时长编辑中、自定义参数弹窗打开（由工具条上报）。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { ExternalLink } from "lucide-react"
import { flattenShots, type Shot } from "@/types"
import { usePromoteCandidate, useVideoPickKeyboard } from "@/hooks"
import {
  useEpisodeStore,
  useShotStore,
  useToastStore,
  useVideoPickStore,
} from "@/stores"
import { Button } from "@/components/ui"
import { getFileUrl } from "@/utils/file"
import { routes } from "@/utils/routes"
import {
  getDefaultActiveCandidateId,
  nextNavigatedIndex,
} from "@/utils/videoPickHelpers"
import { VideoPickCandidateGrid } from "./VideoPickCandidateGrid"
import { VideoPickReferencePanel } from "./VideoPickReferencePanel"

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
  const pushToast = useToastStore((s) => s.push)

  /** 参考区：视频提示词 / 时长编辑态，或工具条弹窗 — 暂停全局快捷键 */
  const [detailEditing, setDetailEditing] = useState(false)
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)

  const shot = filteredShots[currentShotIndex]
  const total = filteredShots.length

  const selectedCount = useMemo(
    () =>
      filteredShots.filter((s) => s.videoCandidates.some((c) => c.selected))
        .length,
    [filteredShots]
  )

  const positionLabel =
    total > 0 ? `当前第 ${currentShotIndex + 1} / ${total} 个镜头` : "当前无镜头"
  const progressLabel =
    total > 0 ? `已选 ${selectedCount} / ${total}` : "已选 0 / 0"

  useEffect(() => {
    if (!shot) return
    setActiveCandidateId(getDefaultActiveCandidateId(shot))
  }, [shot, setActiveCandidateId])

  const showEndSkeleton = Boolean(shot && (shot.status === "endframe_generating"))

  const { promote, isPromoting } = usePromoteCandidate({
    episodeId,
    shotId: shot?.shotId ?? "",
  })

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
    enabled: Boolean(shot) && !videoDialogOpen && !detailEditing,
    primaryCandidateIds: primaryIds,
    onDigitSelect,
    onTabCycle,
    onConfirmActive: onConfirmActiveCandidate,
    onArrow: handleArrow,
    onExitPicking: exitPicking,
    onUndo: handleUndo,
  })

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
  const storyboardUrl = routes.episode(projectId, episodeId)
  const hasFirstFrame = Boolean(shot.firstFrame?.trim())
  const nCandidates = shot.videoCandidates.length

  const fewCandidatesHint =
    hasFirstFrame && nCandidates < 2 ? (
      <div
        className="rounded-sm border border-dashed border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]/40 p-3 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <p className="text-[11px] font-bold text-[var(--color-newsprint-black)]">
          当前镜头只有 {nCandidates} 个候选，暂时难以比选。
        </p>
        <p className="text-[10px] text-[var(--color-muted)] mt-1 leading-snug">
          需要追加生成时请在<strong>右侧参考区</strong>使用「生成视频」工具条（仅首帧 / 首尾帧 / 自定义参数）。
        </p>
      </div>
    ) : null

  return (
    <div
      className="flex flex-col gap-4 min-h-0 min-w-0 box-border"
      style={{ boxSizing: "border-box" }}
    >
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
          {fewCandidatesHint}

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

          {!hasFirstFrame ? (
            <p
              className="text-[10px] text-[var(--color-muted)] box-border"
              style={{ boxSizing: "border-box" }}
            >
              缺少首帧路径，无法发起视频生成；请先在分镜板或平台侧补齐首帧。
            </p>
          ) : null}

          <Link
            to={storyboardUrl}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-newsprint-black)] hover:text-[var(--color-primary)] transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden />
            分镜表（完整编辑画面描述 / 图像提示词 / 台词）
          </Link>
        </section>

        <section
          className="flex-[1_1_32%] min-w-0 flex flex-col box-border w-[22rem] max-w-[24rem] xl:w-[24rem]"
          style={{ boxSizing: "border-box", flexBasis: "32%" }}
          aria-label="参考与迭代"
        >
          <VideoPickReferencePanel
            shot={shot}
            projectId={projectId}
            episodeId={episodeId}
            basePath={basePath}
            cacheBust={cacheBust}
            showEndSkeleton={showEndSkeleton}
            onEditingChange={setDetailEditing}
            onVideoDialogOpenChange={setVideoDialogOpen}
          />
        </section>
      </div>

      <footer
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-[var(--color-newsprint-black)] pt-3 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <div
          className="flex flex-wrap gap-2 box-border"
          style={{ boxSizing: "border-box" }}
        >
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
        <p
          className="text-[9px] text-[var(--color-muted)] max-w-xl leading-snug box-border"
          style={{ boxSizing: "border-box" }}
        >
          快捷键：1–4 选定前四个候选 · Tab 切换激活 · Enter 确认当前激活候选 · ←
          → 提交并切镜头 · Esc 返回列表 · Ctrl+Z 撤销
        </p>
      </footer>
    </div>
  )
}
