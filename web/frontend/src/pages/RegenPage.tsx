/**
 * 单帧重生路由页
 * --------------
 * 根据 URL 解析 episodeId / shotId，拉取剧集后渲染 RegenFramePanel。
 * 资产列表规则与旧版一致：优先使用 episode.assets，否则从各 shot 去重合并。
 */
import { useEffect, useMemo } from "react"
import { useParams } from "react-router"
import { useEpisodeMediaCacheBust } from "@/hooks"
import { useEpisodeFileBasePath } from "@/hooks/useEpisodeFileBasePath"
import { useEpisodeStore } from "@/stores"
import { RegenFramePanel } from "@/components/business/regen"
import { flattenShots } from "@/types"

export default function RegenPage() {
  const { projectId, episodeId, shotId } = useParams<{
    projectId: string
    episodeId: string
    shotId: string
  }>()
  const { currentEpisode, fetchEpisodeDetail } = useEpisodeStore()
  const cacheBust = useEpisodeMediaCacheBust(currentEpisode?.pulledAt)
  const basePath = useEpisodeFileBasePath()

  useEffect(() => {
    if (episodeId) void fetchEpisodeDetail(episodeId)
  }, [episodeId, fetchEpisodeDetail])

  /** 从全剧 shots 中解析当前镜头；缺失时给出简单提示 */
  const shot = useMemo(() => {
    if (!currentEpisode || !shotId) return undefined
    return flattenShots(currentEpisode).find((s) => s.shotId === shotId)
  }, [currentEpisode, shotId])

  /** 与 RegenFramePanel 一致：episode 级资产库优先 */
  const uniqueAssets = useMemo(() => {
    if (!currentEpisode) return []
    const fromShots = currentEpisode.scenes.flatMap((s) =>
      s.shots.flatMap((sh) => sh.assets)
    )
    const uniqueFromShots = fromShots.filter(
      (a, i, arr) => arr.findIndex((x) => x.assetId === a.assetId) === i
    )
    return currentEpisode.assets && currentEpisode.assets.length > 0
      ? currentEpisode.assets
      : uniqueFromShots
  }, [currentEpisode])

  if (!projectId || !episodeId || !shotId) {
    return (
      <div className="p-8 text-[var(--color-muted)]">路由参数不完整</div>
    )
  }

  if (!currentEpisode) {
    return (
      <div className="p-8 text-[var(--color-muted)]">加载剧集数据中…</div>
    )
  }

  if (!shot) {
    return <div className="p-8">未找到镜头</div>
  }

  return (
    <div className="p-8 box-border" style={{ boxSizing: "border-box" }}>
      <RegenFramePanel
        episodeId={episodeId}
        projectId={projectId}
        shot={shot}
        uniqueAssets={uniqueAssets}
        basePath={basePath}
        episodeCacheBust={cacheBust}
      />
    </div>
  )
}
