/**
 * Skeleton 骨架屏
 * 加载态占位，脉冲动画
 */
interface SkeletonProps {
  className?: string
  width?: string | number
  height?: string | number
}

export function Skeleton({
  className = "",
  width,
  height,
}: SkeletonProps) {
  const style: React.CSSProperties = {}
  if (width) style.width = typeof width === "number" ? `${width}px` : width
  if (height) style.height = typeof height === "number" ? `${height}px` : height

  return (
    <div
      className={`animate-pulse bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)] ${className}`}
      style={style}
    />
  )
}
