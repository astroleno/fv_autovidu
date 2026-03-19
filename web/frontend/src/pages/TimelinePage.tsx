/**
 * 粗剪时间线页
 * 视频预览播放器 + 多轨时间线 + 拖拽排序 + 导出
 */
import { useEffect } from "react"
import { useParams } from "react-router"
import { useEpisodeStore } from "@/stores"
import { Button } from "@/components/ui"
import { VideoPlayer } from "@/components/business"
import { flattenShots } from "@/types"
import { getFileUrl } from "@/utils/file"

export default function TimelinePage() {
  const { episodeId } = useParams<{ episodeId: string }>()
  const { currentEpisode, loading, fetchEpisodeDetail } = useEpisodeStore()

  useEffect(() => {
    if (episodeId) void fetchEpisodeDetail(episodeId)
  }, [episodeId, fetchEpisodeDetail])

  if (!episodeId || loading || !currentEpisode) {
    return (
      <div className="p-8">
        {loading ? "加载中..." : "未找到剧集"}
      </div>
    )
  }

  const shots = flattenShots(currentEpisode).filter((s) => s.status === "selected")
  const basePath = `${currentEpisode.projectId}/${currentEpisode.episodeId}`
  const cacheBust = currentEpisode.pulledAt ?? undefined
  const selectedVideo = shots[0]?.videoCandidates.find((c) => c.selected)
  const previewUrl = selectedVideo
    ? getFileUrl(selectedVideo.videoPath, basePath, cacheBust)
    : ""

  return (
    <div className="p-8 flex flex-col">
      <h1 className="text-4xl font-extrabold uppercase tracking-tighter text-[var(--color-newsprint-black)] mb-8 font-headline">粗剪时间线</h1>
      <div className="mb-6">
        {previewUrl ? (
          <VideoPlayer src={previewUrl} className="max-w-2xl" />
        ) : (
          <div className="aspect-video max-w-2xl bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)] flex items-center justify-center text-[var(--color-muted)]">
            请先选定视频
          </div>
        )}
      </div>
      <div className="border border-[var(--color-newsprint-black)] p-4 mb-6">
        <p className="text-sm text-[var(--color-muted)] mb-2">时间线轨道</p>
        <div className="flex gap-2 overflow-x-auto py-2">
          {shots.map((s) => (
            <div
              key={s.shotId}
              className="shrink-0 w-24 h-14 border border-[var(--color-newsprint-black)] bg-[var(--color-primary-50)] flex items-center justify-center text-xs font-bold uppercase"
            >
              S{String(s.shotNumber).padStart(2, "0")}
            </div>
          ))}
        </div>
      </div>
      <Button variant="primary">导出 MP4</Button>
    </div>
  )
}
