/**
 * 根据当前路由/store 中的剧集与上下文选择器，生成 getFileUrl 所需的 basePath。
 */
import { useContextStore, useEpisodeStore } from "@/stores"
import { buildEpisodeFileBasePath } from "@/utils/episodeFileBasePath"

export function useEpisodeFileBasePath(): string {
  const currentEpisode = useEpisodeStore((s) => s.currentEpisode)
  const currentContextId = useContextStore((s) => s.currentContextId)
  if (!currentEpisode) return ""
  return buildEpisodeFileBasePath(
    currentContextId,
    currentEpisode.projectId,
    currentEpisode.episodeId
  )
}
