/**
 * 分镜板总览页（核心）
 * Scene 分组 + Shot 卡片/行 + 状态筛选 + 批量操作 + 视图切换
 * 批量生成尾帧 / 批量生成视频：调用 generateApi，taskStore 轮询并在完成后 Toast
 */
import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router"
import { Grid3X3, List, Film, ImagePlus, Loader2 } from "lucide-react"
import { useEpisodeStore, useShotStore, useTaskStore, useToastStore } from "@/stores"
import { Button, Skeleton } from "@/components/ui"
import {
  BatchResultSummary,
  DubPanel,
  ExportPanel,
  SceneGroup,
  ShotCard,
  ShotRow,
  VideoModeSelector,
  type VideoModeSelectorResult,
} from "@/components/business"
import { flattenShots } from "@/types"
import type { ShotStatus } from "@/types"
import type { GenerateVideoRequest, TaskStatusResponse } from "@/types"
import { generateApi } from "@/api/generate"

const STATUS_FILTERS: { value: ShotStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待处理" },
  { value: "endframe_done", label: "尾帧完成" },
  { value: "video_done", label: "视频完成" },
  { value: "selected", label: "已选定" },
]

export default function StoryboardPage() {
  const { episodeId } = useParams<{ episodeId: string }>()
  const { currentEpisode, loading, fetchEpisodeDetail } = useEpisodeStore()
  const { statusFilter, viewMode, setFilter, setViewMode, setShots } =
    useShotStore()
  const startPolling = useTaskStore((s) => s.startPolling)
  const pushToast = useToastStore((s) => s.push)

  const [batchEndBusy, setBatchEndBusy] = useState(false)
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)
  /** 批量结果汇总弹窗（尾帧 / 视频） */
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryKind, setSummaryKind] = useState<"endframe" | "video">("video")
  const [summaryTaskToShot, setSummaryTaskToShot] = useState<Record<string, string>>({})
  const [summaryResults, setSummaryResults] = useState<TaskStatusResponse[]>([])
  /** 上一次批量视频请求参数，用于「重试失败镜头」保持一致 mode/model */
  const lastVideoBatchParamsRef = useRef<GenerateVideoRequest | null>(null)

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
    return (
      <div className="p-8 text-center text-[var(--color-muted)]">
        未找到该剧集
      </div>
    )
  }

  const allShots = flattenShots(currentEpisode)
  /** 待生成尾帧：pending 且已配置首帧 */
  const pendingShots = allShots.filter(
    (s) => s.status === "pending" && Boolean(s.firstFrame?.trim())
  )
  /** 尾帧已完成：可用于首尾帧 / 多参考等模式批量视频 */
  const endframeDoneShots = allShots.filter((s) => s.status === "endframe_done")
  /**
   * 首帧图生视频（first_frame）批量目标：只要有首帧路径且当前未在生成流程中即可。
   * 覆盖 pending、endframe_done、video_done、error、selected 等，不仅限于 pending。
   */
  const firstFrameBatchShots = allShots.filter((s) => {
    if (!s.firstFrame?.trim()) return false
    if (s.status === "endframe_generating" || s.status === "video_generating") {
      return false
    }
    return true
  })
  const basePath = `${currentEpisode.projectId}/${currentEpisode.episodeId}`
  const cacheBust = currentEpisode.pulledAt ?? undefined
  const episodeAssetIds = (currentEpisode.assets ?? []).map((a) => a.assetId)

  const handleBatchEndframe = async () => {
    if (!episodeId || pendingShots.length === 0) return
    setBatchEndBusy(true)
    try {
      const res = await generateApi.endframe({
        episodeId,
        shotIds: pendingShots.map((s) => s.shotId),
      })
      const taskToShot: Record<string, string> = {}
      res.data.tasks.forEach((t) => {
        taskToShot[t.taskId] = t.shotId
      })
      const ids = res.data.tasks.map((t) => t.taskId)
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
    if (!episodeId || endframeDoneShots.length === 0) return
    try {
      const body: GenerateVideoRequest = {
        episodeId,
        shotIds: endframeDoneShots.map((s) => s.shotId),
        mode: result.mode,
        model: result.model,
        resolution: result.resolution,
        referenceAssetIds: result.referenceAssetIds,
      }
      lastVideoBatchParamsRef.current = body
      const res = await generateApi.video(body)
      const taskToShot: Record<string, string> = {}
      res.data.tasks.forEach((t) => {
        taskToShot[t.taskId] = t.shotId
      })
      const ids = res.data.tasks.map((t) => t.taskId)
      startPolling(ids, {
        episodeId,
        onAllSettled: (results) => {
          setSummaryKind("video")
          setSummaryTaskToShot(taskToShot)
          setSummaryResults(results)
          setSummaryOpen(true)
          pushToast("批量视频任务已全部结束", "success")
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "批量视频请求失败", "error")
    }
  }

  /**
   * 批量首帧视频（mode=first_frame）：目标为 firstFrameBatchShots，与尾帧是否完成无关。
   */
  const handleBatchFirstFrameVideo = async () => {
    if (!episodeId || firstFrameBatchShots.length === 0) return
    try {
      const body: GenerateVideoRequest = {
        episodeId,
        shotIds: firstFrameBatchShots.map((s) => s.shotId),
        mode: "first_frame",
        model: "viduq2-pro-fast",
        resolution: "720p",
      }
      lastVideoBatchParamsRef.current = body
      const res = await generateApi.video(body)
      const taskToShot: Record<string, string> = {}
      res.data.tasks.forEach((t) => {
        taskToShot[t.taskId] = t.shotId
      })
      const ids = res.data.tasks.map((t) => t.taskId)
      startPolling(ids, {
        episodeId,
        onAllSettled: (results) => {
          setSummaryKind("video")
          setSummaryTaskToShot(taskToShot)
          setSummaryResults(results)
          setSummaryOpen(true)
          pushToast("批量首帧视频任务已全部结束", "success")
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "批量首帧视频请求失败", "error")
    }
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
            const base = lastVideoBatchParamsRef.current
            if (!base) {
              pushToast("无法重试：缺少上一次批量视频参数", "error")
              return
            }
            void generateApi
              .video({
                episodeId,
                shotIds: failedShotIds,
                mode: base.mode,
                model: base.model,
                resolution: base.resolution,
                referenceAssetIds: base.referenceAssetIds,
              })
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
                      setSummaryKind("video")
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
          }
        }}
      />

      <VideoModeSelector
        open={videoDialogOpen}
        onClose={() => setVideoDialogOpen(false)}
        shotCount={endframeDoneShots.length}
        episodeAssetIds={episodeAssetIds}
        onConfirm={handleVideoModeConfirm}
      />

      <div className="mb-10 border-l-4 border-[var(--color-primary)] pl-6">
        <h1 className="text-4xl font-extrabold tracking-tighter text-[var(--color-newsprint-black)] uppercase mb-1 font-headline">
          {currentEpisode.episodeTitle} - 分镜板总览
        </h1>
        <p className="text-[var(--color-newsprint-black)] font-medium opacity-70 text-sm uppercase tracking-tight">
          {flattenShots(currentEpisode).length} 个镜头
        </p>
      </div>

      {/* 筛选 + 批量操作 + 视图切换 */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
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
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="gap-2"
              disabled={pendingShots.length === 0 || batchEndBusy}
              onClick={() => void handleBatchEndframe()}
            >
              {batchEndBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ImagePlus className="w-4 h-4" />
              )}
              批量生成尾帧 ({pendingShots.length})
            </Button>
            <Button
              variant="secondary"
              className="gap-2"
              disabled={endframeDoneShots.length === 0}
              onClick={() => setVideoDialogOpen(true)}
              title="针对尾帧已完成镜头，可选首尾帧/多参考等模式"
            >
              <Film className="w-4 h-4" />
              批量视频·尾帧已完成 ({endframeDoneShots.length})
            </Button>
            <Button
              variant="secondary"
              className="gap-2"
              disabled={firstFrameBatchShots.length === 0}
              onClick={() => void handleBatchFirstFrameVideo()}
              title="凡有首帧且未在生成中的镜头均可批量走首帧图生视频（含尾帧已完成等）"
            >
              <Film className="w-4 h-4" />
              批量视频·首帧模式 ({firstFrameBatchShots.length})
            </Button>
            <ExportPanel episodeId={episodeId} />
          </div>
        </div>
      </div>

      <div className="mb-8">
        <DubPanel episodeId={episodeId} />
      </div>

      {/* Scene 分组 */}
      {currentEpisode.scenes.map((scene) => {
        const sceneShots = scene.shots.filter((s) =>
          statusFilter === "all" ? true : s.status === statusFilter
        )
        if (sceneShots.length === 0) return null
        return (
          <SceneGroup key={scene.sceneId} scene={{ ...scene, shots: sceneShots }}>
            {viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {sceneShots.map((shot) => (
                  <ShotCard
                    key={shot.shotId}
                    shot={shot}
                    episodeId={episodeId!}
                    basePath={basePath}
                    cacheBust={cacheBust}
                  />
                ))}
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-[var(--color-muted)] border-b border-[var(--color-divider)]">
                    <th className="py-2 px-4">编号</th>
                    <th className="py-2 px-4 min-w-[11rem]">首尾帧</th>
                    <th className="py-2 px-4">状态</th>
                    <th className="py-2 px-4">画面描述</th>
                    <th className="py-2 px-4">图片提示词</th>
                    <th className="py-2 px-4">视频提示词</th>
                    <th className="py-2 px-4">资产</th>
                    <th className="py-2 px-4">候选数</th>
                    <th className="py-2 px-4">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sceneShots.map((shot) => (
                    <ShotRow
                      key={shot.shotId}
                      shot={shot}
                      episodeId={episodeId!}
                      basePath={basePath}
                      cacheBust={cacheBust}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </SceneGroup>
        )
      })}
    </div>
  )
}
