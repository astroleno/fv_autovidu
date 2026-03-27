/**
 * StoryboardResizableTh — 分镜表表头：右缘拖拽调整列宽（类似 Excel）
 *
 * - mousedown 在拖动手柄上开始，document 级 mousemove 实时改宽，mouseup 提交并持久化。
 * - `stopPropagation` 降低与 MarqueeGrid 框选的冲突概率。
 */
import { useCallback, useRef, type ReactNode } from "react"
import type { StoryboardTableColKey } from "@/components/business/storyboardTableColumnConfig"
import { STORYBOARD_COL_MIN_PX } from "@/components/business/storyboardTableColumnConfig"

export interface StoryboardResizableThProps {
  colKey: StoryboardTableColKey
  widthPx: number
  onDragWidth: (key: StoryboardTableColKey, px: number) => void
  onCommitWidth: (key: StoryboardTableColKey, px: number) => void
  children: ReactNode
  /** 列的完整名称，用于 aria-label */
  ariaLabel: string
  /** 是否为最后一列：最后一列不画右分隔，避免表格右缘双线 */
  isLastColumn?: boolean
  /** 是否在标题前显示竖点握把提示（首列通常关闭，避免左侧多余符号） */
  showLeadingGrip?: boolean
  className?: string
}

export function StoryboardResizableTh({
  colKey,
  widthPx,
  onDragWidth,
  onCommitWidth,
  children,
  ariaLabel,
  isLastColumn = false,
  showLeadingGrip = true,
  className = "",
}: StoryboardResizableThProps) {
  const startRef = useRef<{ x: number; w: number } | null>(null)

  const onResizeHandleDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      startRef.current = { x: e.clientX, w: widthPx }
      const minW = STORYBOARD_COL_MIN_PX[colKey]

      const onMove = (ev: MouseEvent) => {
        const s = startRef.current
        if (!s) return
        const next = Math.max(minW, Math.round(s.w + ev.clientX - s.x))
        onDragWidth(colKey, next)
      }

      const onUp = (ev: MouseEvent) => {
        const s = startRef.current
        startRef.current = null
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        if (!s) return
        const next = Math.max(minW, Math.round(s.w + ev.clientX - s.x))
        onCommitWidth(colKey, next)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [colKey, onCommitWidth, onDragWidth, widthPx]
  )

  return (
    <th
      className={`relative select-none box-border py-2 px-3 text-left text-xs text-[var(--color-muted)] align-bottom bg-[var(--color-newsprint-off-white)]/80 ${
        isLastColumn ? "" : "border-r border-[var(--color-newsprint-black)]/15"
      } ${className}`}
      style={{
        boxSizing: "border-box",
        width: widthPx,
        minWidth: STORYBOARD_COL_MIN_PX[colKey],
        maxWidth: widthPx,
      }}
    >
      <div className="flex min-w-0 items-end justify-start gap-0.5 pr-3">
        {showLeadingGrip ? (
          <span
            className="mr-0.5 shrink-0 select-none text-[11px] leading-none tracking-tighter text-[var(--color-muted)]"
            aria-hidden
          >
            ⋮
          </span>
        ) : null}
        <span className="min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
          {children}
        </span>
      </div>
      {/* 拖动手柄：覆盖列右缘，与竖分割线重合便于发现 */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`调整「${ariaLabel}」列宽`}
        title="在此拖拽调整列宽"
        className="absolute right-0 top-0 z-10 h-full w-2.5 cursor-col-resize border-0 bg-transparent p-0 hover:bg-[var(--color-primary)]/25 box-border"
        style={{ boxSizing: "border-box" }}
        onMouseDown={onResizeHandleDown}
        onClick={(e) => e.preventDefault()}
      />
    </th>
  )
}
