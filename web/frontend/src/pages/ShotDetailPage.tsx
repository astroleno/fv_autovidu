/**
 * Shot 详情 / 视频对比页
 * 左侧 40%：首尾帧 + prompt + 资产 + 镜头信息
 * 右侧 60%：候选视频列表 + 选定 + 生成新视频弹窗
 */
import { useEffect } from "react"
import { useParams, Link } from "react-router"
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react"
import { useEpisodeStore, useShotStore } from "@/stores"
import { Button } from "@/components/ui"
import { VideoPlayer, ImagePreview, AssetTag } from "@/components/business"
import { flattenShots } from "@/types"
import { getFileUrl } from "@/utils/file"

export default function ShotDetailPage() {
  const { episodeId, shotId } = useParams<{ episodeId: string; shotId: string }>()
  const { currentEpisode, loading, fetchEpisodeDetail } = useEpisodeStore()
  const { selectCandidate } = useShotStore()

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
  const cacheBust = currentEpisode.pulledAt ?? undefined

  if (!shot) {
    return <div className="p-8">未找到该镜头</div>
  }

  const firstFrameUrl = getFileUrl(shot.firstFrame, basePath, cacheBust)
  const endFrameUrl = shot.endFrame ? getFileUrl(shot.endFrame, basePath, cacheBust) : null

  return (
    <div className="p-8 flex flex-col h-full">
      {/* 前后导航 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {prevShot ? (
            <Link to={`/episode/${episodeId}/shot/${prevShot.shotId}`}>
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
            <Link to={`/episode/${episodeId}/shot/${nextShot.shotId}`}>
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
        {/* 左侧 40% */}
        <div className="w-[40%] shrink-0 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-[var(--color-muted)] mb-2">首帧</p>
              {firstFrameUrl ? (
                <ImagePreview
                  src={firstFrameUrl}
                  alt="首帧"
                  className="aspect-video"
                />
              ) : (
                <div className="aspect-video bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)] flex items-center justify-center text-[var(--color-muted)]">
                  暂无
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-[var(--color-muted)] mb-2">尾帧</p>
              {endFrameUrl ? (
                <ImagePreview
                  src={endFrameUrl}
                  alt="尾帧"
                  className="aspect-video"
                />
              ) : (
                <div className="aspect-video bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)] flex items-center justify-center text-[var(--color-muted)]">
                  待生成
                </div>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-[var(--color-muted)] mb-1">画面描述</p>
            <p className="text-sm text-[var(--color-ink)] bg-[var(--color-divider)] border border-[var(--color-newsprint-black)] p-3 max-h-24 overflow-y-auto">
              {shot.imagePrompt}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-muted)] mb-1">视频描述</p>
            <p className="text-sm text-[var(--color-ink)] bg-[var(--color-divider)] border border-[var(--color-newsprint-black)] p-3 max-h-24 overflow-y-auto">
              {shot.videoPrompt}
            </p>
          </div>
          {shot.assets.length > 0 && (
            <div>
              <p className="text-xs text-[var(--color-muted)] mb-2">资产</p>
              <div className="flex flex-wrap gap-2">
                {shot.assets.map((a) => (
                  <AssetTag key={a.assetId} asset={a} />
                ))}
              </div>
            </div>
          )}
          <div className="text-xs text-[var(--color-muted)]">
            {shot.cameraMovement} | {shot.duration}s | {shot.aspectRatio}
          </div>
          <Link to={`/episode/${episodeId}/shot/${shotId}/regen`}>
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
                return (
                  <div
                    key={c.id}
                    className={`border-2 border-[var(--color-newsprint-black)] p-4 ${
                      c.selected
                        ? "border-[var(--color-primary)]"
                        : "border-[var(--color-border)]"
                    }`}
                  >
                    <VideoPlayer src={videoUrl} />
                    <div className="mt-2 flex justify-between items-center">
                      <span className="text-xs text-[var(--color-muted)]">
                        {c.model} | {c.mode} | seed {c.seed}
                      </span>
                      <Button
                        variant={c.selected ? "primary" : "secondary"}
                        onClick={() =>
                          selectCandidate(episodeId, shotId, c.id)
                        }
                        disabled={c.selected}
                      >
                        {c.selected ? "已选定" : "选定"}
                      </Button>
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
