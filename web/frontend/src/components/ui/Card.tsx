/**
 * Card 卡片组件
 * Stitch newsprint-card：0px 圆角、1px solid #111、hover 硬阴影 + translate(-2px,-2px)
 */
interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: boolean
}

export function Card({
  children,
  className = "",
  padding = true,
}: CardProps) {
  const base =
    "newsprint-card box-border"

  return (
    <div className={`${base} ${padding ? "p-4" : ""} ${className}`}>
      {children}
    </div>
  )
}
