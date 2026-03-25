/**
 * useEpisodeMediaCacheBust
 *
 * 订阅 episodeStore.localMediaEpoch，与 pulledAt 组合成稳定传给 ShotCard / getFileUrl 的 cacheBust。
 * 避免每个页面手写 `[pulledAt, epoch]` 拼接逻辑。
 */
import { useMemo } from "react"
import { useEpisodeStore } from "@/stores"
import { buildEpisodeMediaCacheBust } from "@/utils/episodeCacheBust"

export function useEpisodeMediaCacheBust(
  pulledAt: string | undefined | null
): string | undefined {
  const localMediaEpoch = useEpisodeStore((s) => s.localMediaEpoch)
  return useMemo(
    () => buildEpisodeMediaCacheBust(pulledAt, localMediaEpoch),
    [pulledAt, localMediaEpoch]
  )
}
