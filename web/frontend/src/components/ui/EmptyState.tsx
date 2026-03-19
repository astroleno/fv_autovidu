/**
 * EmptyState 空状态
 * Stitch 报纸风格：方角、UPPERCASE 标题
 */
import { type LucideIcon, Inbox } from "lucide-react"
import { Button } from "./Button"

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-16 h-16 border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-[var(--color-muted)]" />
      </div>
      <h3 className="text-lg font-extrabold uppercase tracking-tight text-[var(--color-newsprint-black)] mb-2 font-headline">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-[var(--color-muted)] mb-6 max-w-sm uppercase tracking-wide">
          {description}
        </p>
      )}
      {action && (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
