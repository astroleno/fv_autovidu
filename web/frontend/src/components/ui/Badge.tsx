/**
 * Badge 状态标签
 * Stitch：方角 (0px)、newsprint-border
 * 5 种颜色对应 ShotStatus
 */
import type { ShotStatus } from "@/types"

interface BadgeProps {
  status: ShotStatus | "all"
  children: React.ReactNode
  pulse?: boolean
  className?: string
}

const statusStyles: Record<ShotStatus | "all", string> = {
  pending: "bg-[var(--color-outline-variant)] text-[var(--color-ink)]",
  endframe_generating: "bg-[var(--color-primary)] text-white",
  video_generating: "bg-[var(--color-primary)] text-white",
  endframe_done: "bg-[var(--color-primary-50)] text-[var(--color-primary-dark)]",
  video_done: "bg-amber-100 text-amber-800",
  selected: "bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)]",
  error: "bg-red-100 text-red-700",
  all: "bg-[var(--color-outline-variant)] text-[var(--color-ink)]",
}

export function Badge({ status, children, pulse, className = "" }: BadgeProps) {
  const base =
    "inline-flex items-center px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider box-border border border-[var(--color-newsprint-black)]"

  return (
    <span
      className={`${base} ${statusStyles[status]} ${pulse ? "animate-pulse" : ""} ${className}`}
    >
      {children}
    </span>
  )
}
