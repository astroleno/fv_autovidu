/**
 * Progress 线性进度条
 * 带百分比文字，0-100
 */
interface ProgressProps {
  value: number // 0-100
  max?: number
  showLabel?: boolean
  className?: string
}

export function Progress({
  value,
  max = 100,
  showLabel = true,
  className = "",
}: ProgressProps) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <div className={`w-full ${className}`}>
      <div className="h-2 bg-[var(--color-outline-variant)] overflow-hidden box-border border border-[var(--color-newsprint-black)]">
        <div
          className="h-full bg-[var(--color-primary)] transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-[var(--color-muted)] mt-1">
          {Math.round(percent)}%
        </span>
      )}
    </div>
  )
}
