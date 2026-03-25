/**
 * 视频候选「精出 1080p」（锁种 promote）共享逻辑
 *
 * 从 ShotDetailPage 抽离，供镜头详情与选片总览卡片复用：
 * - 同一 candidateId 在请求进行中不允许重复提交（ref + state 双轨，避免连点竞态）
 * - 任务结束后刷新剧集详情并 Toast 汇总结果
 */
import { useCallback, useRef, useState } from "react"
import { useEpisodeStore, useTaskStore, useToastStore } from "@/stores"
import { generateApi } from "@/api/generate"

/** Hook 入参：当前剧集与镜头（精出 API 按 shot + candidate 粒度提交） */
export interface UsePromoteCandidateOptions {
  episodeId: string
  shotId: string
}

/** Hook 返回值：进行中的候选、发起精出、查询是否繁忙 */
export interface UsePromoteCandidateReturn {
  /** 正在精出中的候选 id 列表（用于 UI 展示多条并行） */
  promotingIds: string[]
  /** 对指定预览候选发起 viduq3-pro + 1080p 精出 */
  promote: (candidateId: string) => Promise<void>
  /** 某候选是否仍处于精出轮询生命周期内 */
  isPromoting: (candidateId: string) => boolean
}

export function usePromoteCandidate({
  episodeId,
  shotId,
}: UsePromoteCandidateOptions): UsePromoteCandidateReturn {
  const fetchEpisodeDetail = useEpisodeStore((s) => s.fetchEpisodeDetail)
  const startPolling = useTaskStore((s) => s.startPolling)
  const pushToast = useToastStore((s) => s.push)

  /**
   * 精出进行中的候选 id（多路并行：不同 candidate 可同时各占一条）。
   * promotingIdsRef 同步互斥位，避免 React 批处理下连续双击重复请求。
   */
  const [promotingIds, setPromotingIds] = useState<string[]>([])
  const promotingIdsRef = useRef<Set<string>>(new Set())

  /** 单路精出结束时：从 Set 与数组中同步移除，恢复按钮可点状态 */
  const removePromotingId = useCallback((id: string) => {
    promotingIdsRef.current.delete(id)
    setPromotingIds((prev) => prev.filter((x) => x !== id))
  }, [])

  const isPromoting = useCallback(
    (candidateId: string) => promotingIds.includes(candidateId),
    [promotingIds]
  )

  const promote = useCallback(
    async (candidateId: string) => {
      if (!episodeId || !shotId) return
      if (promotingIdsRef.current.has(candidateId)) return
      promotingIdsRef.current.add(candidateId)
      setPromotingIds((prev) =>
        prev.includes(candidateId) ? prev : [...prev, candidateId]
      )
      try {
        const res = await generateApi.promote({
          episodeId,
          items: [{ shotId, candidateId }],
          model: "viduq3-pro",
          resolution: "1080p",
        })
        const ids = res.data.tasks.map((t) => t.taskId)
        pushToast(
          `已提交 ${ids.length} 个精出任务，生成完成后将自动刷新`,
          "info"
        )
        startPolling(ids, {
          episodeId,
          onAllSettled: (results) => {
            void fetchEpisodeDetail(episodeId)
            const nFail = results.filter((r) => r.status === "failed").length
            const nOk = results.filter((r) => r.status === "success").length
            if (nFail > 0) {
              pushToast(
                nFail === results.length
                  ? "精出任务失败，请查看任务汇总或重试"
                  : `精出完成：${nOk} 个成功，${nFail} 个失败`,
                "error"
              )
            } else {
              pushToast("精出任务已完成", "success")
            }
            removePromotingId(candidateId)
          },
          onPollAborted: () => {
            removePromotingId(candidateId)
            pushToast("精出状态轮询中断，请手动刷新页面", "error")
          },
        })
      } catch (e) {
        pushToast(e instanceof Error ? e.message : "精出请求失败", "error")
        removePromotingId(candidateId)
      }
    },
    [
      episodeId,
      shotId,
      fetchEpisodeDetail,
      pushToast,
      removePromotingId,
      startPolling,
    ]
  )

  return { promotingIds, promote, isPromoting }
}
