/**
 * 配音状态徽标：根据 shot.dub.status 显示简短文案与样式
 */
import type { DubStatus } from "@/types"

export interface DubStatusBadgeProps {
  dub?: DubStatus
  className?: string
}

const LABELS: Record<string, string> = {
  pending: "待配音",
  processing: "配音中",
  completed: "已配音",
  failed: "失败",
  stale: "需重配",
}

export function DubStatusBadge({ dub, className = "" }: DubStatusBadgeProps) {
  const st = dub?.status ?? "pending"
  const label = LABELS[st] ?? st
  const tone =
    st === "completed"
      ? "bg-emerald-100 text-emerald-900 border-emerald-800"
      : st === "failed"
        ? "bg-red-100 text-red-900 border-red-800"
        : st === "processing"
          ? "bg-amber-100 text-amber-900 border-amber-800"
          : st === "stale"
            ? "bg-orange-100 text-orange-900 border-orange-800"
            : "bg-[var(--color-outline-variant)] text-[var(--color-muted)] border-[var(--color-newsprint-black)]"

  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone} ${className}`}
      style={{ boxSizing: "border-box" }}
      title={dub?.error ?? ""}
    >
      {label}
    </span>
  )
}
