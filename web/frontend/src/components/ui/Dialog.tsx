/**
 * Dialog 弹窗组件
 * 居中弹出、遮罩层 bg-black/40 backdrop-blur-sm
 * 点击遮罩关闭（可选）
 */
import { useEffect } from "react"

interface DialogProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  closeOnBackdrop?: boolean
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  closeOnBackdrop = true,
}: DialogProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    if (open) {
      document.addEventListener("keydown", handleEscape)
      document.body.style.overflow = "hidden"
    }
    return () => {
      document.removeEventListener("keydown", handleEscape)
      document.body.style.overflow = ""
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal
      aria-labelledby={title ? "dialog-title" : undefined}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden
      />
      {/* 内容 - Stitch：0px 圆角、硬阴影、newsprint-border */}
      <div
        className="relative bg-[var(--color-newsprint-off-white)] border border-[var(--color-newsprint-black)] shadow-[4px_4px_0px_0px_#111111] max-w-lg w-full max-h-[90vh] overflow-auto p-6 box-border"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 id="dialog-title" className="text-lg font-extrabold uppercase tracking-tight mb-4 text-[var(--color-newsprint-black)] font-headline">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  )
}
