/**
 * StatusIndicator 状态指示灯
 * 小圆点 + 可选脉冲动画（generating 状态）
 */
import type { ShotStatus } from "@/types"

interface StatusIndicatorProps {
  status: ShotStatus
  className?: string
}

const statusColors: Record<ShotStatus, string> = {
  pending: "bg-gray-400",
  endframe_generating: "bg-[var(--color-primary)]",
  video_generating: "bg-[var(--color-primary)]",
  endframe_done: "bg-[var(--color-primary-light)]",
  video_done: "bg-amber-500",
  selected: "bg-[var(--color-primary)]",
  error: "bg-[var(--color-error)]",
}

const isPulsing = (s: ShotStatus) =>
  s === "endframe_generating" || s === "video_generating"

export function StatusIndicator({ status, className = "" }: StatusIndicatorProps) {
  const pulse = isPulsing(status)
  return (
    <span
      className={`inline-block w-2.5 h-2.5 border border-[var(--color-newsprint-black)] ${statusColors[status]} ${pulse ? "animate-pulse" : ""} ${className}`}
    />
  )
}
