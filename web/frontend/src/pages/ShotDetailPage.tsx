/**
 * Shot 详情 / 视频对比页
 * 左侧 40%：首尾帧 + prompt + 资产 + 镜头信息
 * 右侧 60%：候选视频列表 + 选定 + 预览候选「精出 1080p」（锁种 promote）
 */
import { useEffect } from "react"
import { useParams, Link } from "react-router"
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react"
import { useEpisodeMediaCacheBust, usePromoteCandidate } from "@/hooks"
import { useEpisodeStore, useShotStore } from "@/stores"
import { Button } from "@/components/ui"
import { VideoPlayer, AssetTag, ShotFrameCompare } from "@/components/business"
import { flattenShots } from "@/types"
import { getFileUrl } from "@/utils/file"
import { routes } from "@/utils/routes"

export default function ShotDetailPage() {
  const { projectId: routeProjectId, episodeId, shotId } = useParams<{
    projectId?: string
    episodeId: string
    shotId: string
  }>()
  const { currentEpisode, loading, fetchEpisodeDetail } = useEpisodeStore()
  const cacheBust = useEpisodeMediaCacheBust(currentEpisode?.pulledAt)
  const { selectCandidate } = useShotStore()
  /** 必须在任意 early return 之前调用，以满足 React hooks 规则；缺参时 promote 内部直接 return */
  const { promote, isPromoting } = usePromoteCandidate({
    episodeId: episodeId ?? "",
    shotId: shotId ?? "",
  })

  useEffect(() => {
    if (episodeId) void fetchEpisodeDetail(episodeId)
  }, [episodeId, fetchEpisodeDetail])

  if (!episodeId || !shotId || !currentEpisode) {
    return (
      <div className="p-8">
        {loading ? <div>加载中...</div> : <div>未找到</div>}
      </div>
    )
  }

  const shots = flattenShots(currentEpisode)
  const shotIndex = shots.findIndex((s) => s.shotId === shotId)
  const shot = shots[shotIndex]
  const prevShot = shotIndex > 0 ? shots[shotIndex - 1] : null
  const nextShot = shotIndex < shots.length - 1 ? shots[shotIndex + 1] : null
  const basePath = `${currentEpisode.projectId}/${currentEpisode.episodeId}`
  const projectId = routeProjectId ?? currentEpisode.projectId

  if (!shot) {
    return <div className="p-8">未找到该镜头</div>
  }

  return (
    <div className="p-8 flex flex-col h-full">
      {/* 前后导航 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {prevShot ? (
            <Link to={routes.shot(projectId, episodeId, prevShot.shotId)}>
              <Button variant="ghost" className="gap-1">
                <ChevronLeft className="w-5 h-5" />
                上一镜头
              </Button>
            </Link>
          ) : (
            <span className="text-[var(--color-muted)]">上一镜头</span>
          )}
          <span className="font-medium">
            S{String(shot.shotNumber).padStart(2, "0")} / {shots.length}
          </span>
          {nextShot ? (
            <Link to={routes.shot(projectId, episodeId, nextShot.shotId)}>
              <Button variant="ghost" className="gap-1">
                下一镜头
                <ChevronRight className="w-5 h-5" />
              </Button>
            </Link>
          ) : (
            <span className="text-[var(--color-muted)]">下一镜头</span>
          )}
        </div>
      </div>

      <div className="flex gap-8 flex-1 min-h-0">
        {/* 左侧：首尾帧同屏对比 + 文案与资产 */}
        <div className="w-[45%] min-w-[320px] shrink-0 space-y-4 box-border">
          <p className="text-sm font-bold text-[var(--color-newsprint-black)] uppercase tracking-tight mb-2">
            首尾帧对比
          </p>
          <ShotFrameCompare
            shot={shot}
            projectId={projectId}
            episodeId={episodeId}
            basePath={basePath}
            cacheBust={cacheBust}
            variant="detail"
            showEndSkeleton={shot.status === "endframe_generating"}
          />
          {(shot.visualDescription || shot.imagePrompt || shot.videoPrompt) && (
            <>
              <div>
                <p className="text-xs text-[var(--color-muted)] mb-1">画面描述</p>
                <p className="text-sm text-[var(--color-ink)] bg-[var(--color-divider)] border border-[var(--color-newsprint-black)] p-3 max-h-24 overflow-y-auto">
                  {shot.visualDescription || "暂无"}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-muted)] mb-1">图片提示词</p>
                <p className="text-sm text-[var(--color-ink)] bg-[var(--color-divider)] border border-[var(--color-newsprint-black)] p-3 max-h-24 overflow-y-auto">
                  {shot.imagePrompt || "暂无"}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-muted)] mb-1">视频提示词</p>
                <p className="text-sm text-[var(--color-ink)] bg-[var(--color-divider)] border border-[var(--color-newsprint-black)] p-3 max-h-24 overflow-y-auto">
                  {shot.videoPrompt || "暂无"}
                </p>
              </div>
            </>
          )}
          {shot.assets.length > 0 && (
            <div>
              <p className="text-xs text-[var(--color-muted)] mb-2">资产</p>
              <div className="flex flex-wrap gap-2">
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
            </div>
          )}
          <div className="text-xs text-[var(--color-muted)]">
            {shot.cameraMovement} | {shot.duration}s | {shot.aspectRatio}
          </div>
          <Link to={routes.regen(projectId, episodeId, shotId)}>
            <Button variant="secondary" className="gap-2">
              <RotateCcw className="w-4 h-4" />
              单帧重生
            </Button>
          </Link>
        </div>

        {/* 右侧 60% */}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold mb-4">视频候选</h3>
          {shot.videoCandidates.length === 0 ? (
            <div className="text-[var(--color-muted)] py-8">
              暂无视频候选，请先生成视频
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {shot.videoCandidates.map((c) => {
                const videoUrl = getFileUrl(c.videoPath, basePath, cacheBust)
                const resLabel = c.resolution?.trim() || "—"
                const previewTag = c.isPreview ? " [预览]" : ""
                const canPromote =
                  Boolean(c.isPreview) &&
                  c.taskStatus === "success" &&
                  c.seed > 0
                const busy = isPromoting(c.id)
                return (
                  <div
                    key={c.id}
                    className={`border-2 border-[var(--color-newsprint-black)] p-4 box-border ${
                      c.selected
                        ? "border-[var(--color-primary)]"
                        : "border-[var(--color-border)]"
                    }`}
                  >
                    <VideoPlayer src={videoUrl} />
                    <div className="mt-2 flex flex-col gap-2">
                      <span className="text-xs text-[var(--color-muted)]">
                        {c.model} | {resLabel} | {c.mode} | seed {c.seed}
                        {previewTag}
                        {c.promotedFrom ? (
                          <span className="block mt-0.5">
                            来源预览: {c.promotedFrom}
                          </span>
                        ) : null}
                      </span>
                      <div className="flex flex-wrap gap-2 justify-end">
                        {canPromote && (
                          <Button
                            variant="secondary"
                            type="button"
                            disabled={busy}
                            onClick={() => void promote(c.id)}
                          >
                            {busy ? "精出中…" : "精出 1080p"}
                          </Button>
                        )}
                        <Button
                          variant={c.selected ? "primary" : "secondary"}
                          type="button"
                          onClick={() =>
                            selectCandidate(episodeId, shotId, c.id)
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
          )}
        </div>
      </div>
    </div>
  )
}
