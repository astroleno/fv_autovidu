/**
 * Toast 通知组件
 * 右上角显示，success/error/info 三种类型
 * 需配合 toastStore 或 context 使用
 */
export type ToastType = "success" | "error" | "info"

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  duration?: number
}

interface ToastProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

const typeStyles: Record<ToastType, string> = {
  success: "bg-[var(--color-primary)] text-white",
  error: "bg-[var(--color-error)] text-white",
  info: "bg-gray-700 text-white",
}

export function Toast({ toasts, onDismiss }: ToastProps) {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-3 border border-[var(--color-newsprint-black)] shadow-[4px_4px_0px_0px_#111111] ${typeStyles[t.type]} opacity-95`}
          role="alert"
        >
          <div className="flex items-center justify-between gap-4">
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="opacity-80 hover:opacity-100 text-sm"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
