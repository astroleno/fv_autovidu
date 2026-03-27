/**
 * useStoryboardTableColumnWidths — 分镜表列宽：状态 + localStorage 持久化
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  type StoryboardTableColKey,
  buildStoryboardColOrder,
  mergeStoryboardColWidths,
  STORYBOARD_COL_MIN_PX,
  storyboardColWidthsStorageKey,
} from "@/components/business/storyboardTableColumnConfig"

export function useStoryboardTableColumnWidths(
  episodeId: string | undefined,
  pickMode: boolean
) {
  const colOrder = useMemo(() => buildStoryboardColOrder(pickMode), [pickMode])
  const [widths, setWidths] = useState<Record<StoryboardTableColKey, number>>(
    () => mergeStoryboardColWidths(undefined, buildStoryboardColOrder(false))
  )

  useEffect(() => {
    const ord = buildStoryboardColOrder(pickMode)
    if (!episodeId) {
      setWidths(mergeStoryboardColWidths(undefined, ord))
      return
    }
    let raw: string | null = null
    try {
      raw = localStorage.getItem(storyboardColWidthsStorageKey(episodeId))
    } catch {
      raw = null
    }
    let parsed: Partial<Record<StoryboardTableColKey, number>> | undefined
    try {
      parsed = raw ? JSON.parse(raw) : undefined
    } catch {
      parsed = undefined
    }
    setWidths(mergeStoryboardColWidths(parsed, ord))
  }, [episodeId, pickMode])

  const persist = useCallback(
    (next: Record<StoryboardTableColKey, number>) => {
      if (!episodeId) return
      try {
        localStorage.setItem(
          storyboardColWidthsStorageKey(episodeId),
          JSON.stringify(next)
        )
      } catch {
        /* ignore */
      }
    },
    [episodeId]
  )

  const setColumnWidthLive = useCallback(
    (key: StoryboardTableColKey, px: number) => {
      const v = Math.max(STORYBOARD_COL_MIN_PX[key], Math.round(px))
      setWidths((w) => ({ ...w, [key]: v }))
    },
    []
  )

  const commitColumnWidth = useCallback(
    (key: StoryboardTableColKey, px: number) => {
      setWidths((prev) => {
        const v = Math.max(STORYBOARD_COL_MIN_PX[key], Math.round(px))
        const next = { ...prev, [key]: v }
        persist(next)
        return next
      })
    },
    [persist]
  )

  return {
    widths,
    setColumnWidthLive,
    commitColumnWidth,
    colOrder,
  }
}
