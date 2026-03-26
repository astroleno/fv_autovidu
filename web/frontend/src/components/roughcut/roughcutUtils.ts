/**
 * 粗剪时间线（Rough Cut）通用工具函数
 * —— 时长格式化、标尺刻度、安全除法等，供 Timeline / Player 复用
 */
import type { RoughCutTrackItem } from "./RoughCutTimeline"

/**
 * 将秒数格式化为 MM:SS（不足 1 小时时使用，与原型稿时间码风格一致）
 */
export function formatTimeMmSs(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00"
  const s = Math.floor(totalSeconds)
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

/**
 * 将秒数格式化为 HH:MM:SS（时间轴标尺用，与原型 00:00:00 一致）
 */
export function formatTimeHhMmSs(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00:00"
  const s = Math.floor(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

/**
 * 根据总时长生成标尺刻度点（秒），避免刻度过密
 */
export function buildRulerTicks(totalSec: number): number[] {
  const t = Math.max(0, totalSec)
  if (t <= 0) return [0]
  const step =
    t <= 30 ? 5 : t <= 90 ? 10 : t <= 300 ? 15 : t <= 600 ? 30 : 60
  const ticks: number[] = [0]
  for (let x = step; x <= t + 0.001; x += step) {
    ticks.push(Math.min(x, t))
  }
  if (ticks[ticks.length - 1]! < t) ticks.push(t)
  return ticks
}

/**
 * 镜头用于布局的时长（秒）：至少 1s，避免宽度为 0
 */
export function layoutDurationSec(shotDuration: number | undefined): number {
  const d = typeof shotDuration === "number" && shotDuration > 0 ? shotDuration : 1
  return d
}

export interface TimelineSeekTarget {
  shotId: string
  clipTimeSec: number
  globalTimeSec: number
}

/**
 * 将指针横坐标映射为时间线右侧内容区内的百分比。
 */
export function timelinePercentFromClientX(clientX: number, rect: Pick<DOMRect, "left" | "width">): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(rect.width) || rect.width <= 0) return 0
  const raw = ((clientX - rect.left) / rect.width) * 100
  return Math.min(100, Math.max(0, raw))
}

/**
 * 根据全局时间求出应 seek 到的镜头与镜头内时间。
 * 若落在 pending 片段，优先吸附到最近的可播放镜头边界。
 */
export function getTimelineSeekTarget(
  items: RoughCutTrackItem[],
  globalTimeSec: number
): TimelineSeekTarget | null {
  if (items.length === 0) return null

  const totalSec = items.reduce((sum, item) => sum + Math.max(item.durationSec, 0), 0)
  const clampedGlobalSec = Math.min(Math.max(globalTimeSec, 0), Math.max(totalSec, 0))

  let offsetSec = 0
  let previousClip: TimelineSeekTarget | null = null

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const durationSec = Math.max(item.durationSec, 0)
    const startSec = offsetSec
    const endSec = offsetSec + durationSec

    if (clampedGlobalSec <= endSec || index === items.length - 1) {
      if (item.kind === "clip") {
        return {
          shotId: item.shot.shotId,
          clipTimeSec: Math.min(Math.max(clampedGlobalSec - startSec, 0), durationSec),
          globalTimeSec: clampedGlobalSec,
        }
      }

      let nextClip: TimelineSeekTarget | null = null
      let nextOffsetSec = endSec

      for (let nextIndex = index + 1; nextIndex < items.length; nextIndex += 1) {
        const nextItem = items[nextIndex]!
        if (nextItem.kind === "clip") {
          nextClip = {
            shotId: nextItem.shot.shotId,
            clipTimeSec: 0,
            globalTimeSec: clampedGlobalSec,
          }
          break
        }
        nextOffsetSec += Math.max(nextItem.durationSec, 0)
      }

      if (!previousClip) return nextClip
      if (!nextClip) return previousClip

      const distanceToPrevious = Math.abs(clampedGlobalSec - startSec)
      const distanceToNext = Math.abs(nextOffsetSec - clampedGlobalSec)
      return distanceToPrevious <= distanceToNext ? previousClip : nextClip
    }

    if (item.kind === "clip") {
      previousClip = {
        shotId: item.shot.shotId,
        clipTimeSec: durationSec,
        globalTimeSec: clampedGlobalSec,
      }
    }

    offsetSec = endSec
  }

  return previousClip
}
