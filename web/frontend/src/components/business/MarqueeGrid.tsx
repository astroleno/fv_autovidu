/**
 * 网格视图下的左键拖拽矩形框选
 *
 * - 子元素需带 `data-batch-pick-item="<shotId>"`，用于与选区矩形求交
 * - 从链接上起拖时，移动超过阈值后再锁定，避免误触跳转
 * - 边缘自动滚动：指针靠近可滚动祖先（如主内容区 overflow-y-auto）上下左右边缘时持续 scroll，
 *   并用 rAF 在鼠标停在边缘时也能继续滚动（mousemove 不会重复触发）
 */
import { useCallback, useRef, useState } from "react"

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

/** 距容器边缘多少像素内开始加速滚动 */
const EDGE_PX = 44
/** 最大单帧滚动量（像素），近边缘越大 */
const MAX_STEP = 36

/**
 * 自 root 向上查找第一个可滚动祖先（与分镜页所在 AppLayout 主内容区 overflow-y-auto 对齐）
 */
function getScrollableParent(start: HTMLElement | null): HTMLElement {
  let p: HTMLElement | null = start
  while (p) {
    const s = getComputedStyle(p)
    const oy = s.overflowY
    const ox = s.overflowX
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 2) {
      return p
    }
    if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth + 2) {
      return p
    }
    p = p.parentElement
  }
  return (document.scrollingElement as HTMLElement) || document.documentElement
}

/**
 * 优先使用 AppLayout 上标记的主滚动容器（`data-app-main-scroll`），
 * 避免误用 documentElement 导致 scrollTop 始终为 0、边缘滚动无效。
 */
function resolveScrollContainer(root: HTMLElement | null): HTMLElement {
  const marked = document.querySelector<HTMLElement>("[data-app-main-scroll]")
  if (marked) return marked
  return getScrollableParent(root)
}

/**
 * 根据指针在容器可视区域内的位置，在边缘带内施加滚动（二次曲线加速）
 */
function applyEdgeScroll(el: HTMLElement, cx: number, cy: number) {
  const rect = el.getBoundingClientRect()
  let dy = 0
  let dx = 0

  const distTop = cy - rect.top
  if (distTop >= 0 && distTop < EDGE_PX) {
    const t = (EDGE_PX - distTop) / EDGE_PX
    dy = -Math.max(1, Math.ceil(t * t * MAX_STEP))
  }
  const distBottom = rect.bottom - cy
  if (distBottom >= 0 && distBottom < EDGE_PX) {
    const t = (EDGE_PX - distBottom) / EDGE_PX
    dy = Math.max(1, Math.ceil(t * t * MAX_STEP))
  }
  const distLeft = cx - rect.left
  if (distLeft >= 0 && distLeft < EDGE_PX) {
    const t = (EDGE_PX - distLeft) / EDGE_PX
    dx = -Math.max(1, Math.ceil(t * t * MAX_STEP))
  }
  const distRight = rect.right - cx
  if (distRight >= 0 && distRight < EDGE_PX) {
    const t = (EDGE_PX - distRight) / EDGE_PX
    dx = Math.max(1, Math.ceil(t * t * MAX_STEP))
  }

  if (dy !== 0) {
    el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + dy))
  }
  if (dx !== 0) {
    el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + dx))
  }
}

export interface MarqueeGridProps {
  children: React.ReactNode
  enabled: boolean
  onPickShotIds: (shotIds: string[]) => void
}

export function MarqueeGrid({ children, enabled, onPickShotIds }: MarqueeGridProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null
  )
  const suppressClickRef = useRef(false)

  const scrollElRef = useRef<HTMLElement | null>(null)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const draggingRef = useRef(false)
  const rafIdRef = useRef(0)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled || e.button !== 0) return
      const t = e.target as HTMLElement
      // 提示词预览按钮带 data-prompt-preview，允许从该处起拖框选；其它 button 仍排除
      if (
        (t.closest("button") && !t.closest("[data-prompt-preview]")) ||
        t.closest("input") ||
        t.closest("label") ||
        t.closest("[data-shot-checkbox]") ||
        t.closest("textarea")
      ) {
        return
      }

      const startX = e.clientX
      const startY = e.clientY
      let dragActive = false
      const prevUserSelect = document.body.style.userSelect

      const stopEdgeScrollLoop = () => {
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current)
          rafIdRef.current = 0
        }
      }

      /**
       * 单一 rAF 循环：每帧只 schedule 下一帧一次，避免嵌套 requestAnimationFrame 与 id 覆盖问题；
       * 指针停在边缘时仍持续滚动。
       */
      const edgeScrollTick = () => {
        if (!draggingRef.current) {
          rafIdRef.current = 0
          return
        }
        const scrollEl = scrollElRef.current
        if (scrollEl) {
          const { x, y } = lastMouseRef.current
          applyEdgeScroll(scrollEl, x, y)
        }
        rafIdRef.current = requestAnimationFrame(edgeScrollTick)
      }

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (!dragActive && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          dragActive = true
          draggingRef.current = true
          document.body.style.userSelect = "none"
          scrollElRef.current = resolveScrollContainer(rootRef.current)
          stopEdgeScrollLoop()
          rafIdRef.current = requestAnimationFrame(edgeScrollTick)
          ev.preventDefault()
        }
        if (!dragActive) return

        lastMouseRef.current = { x: ev.clientX, y: ev.clientY }
        const left = Math.min(startX, ev.clientX)
        const top = Math.min(startY, ev.clientY)
        const width = Math.abs(ev.clientX - startX)
        const height = Math.abs(ev.clientY - startY)
        setBox({ left, top, width, height })
      }

      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        draggingRef.current = false
        stopEdgeScrollLoop()
        scrollElRef.current = null
        document.body.style.userSelect = prevUserSelect
        setBox(null)

        if (!dragActive) return

        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)

        const left = Math.min(startX, ev.clientX)
        const top = Math.min(startY, ev.clientY)
        const right = Math.max(startX, ev.clientX)
        const bottom = Math.max(startY, ev.clientY)
        if (right - left < 5 || bottom - top < 5) return

        const sel = { left, top, right, bottom }
        const root = rootRef.current
        if (!root) return

        const ids: string[] = []
        root.querySelectorAll("[data-batch-pick-item]").forEach((node) => {
          const el = node as HTMLElement
          const id = el.dataset.batchPickItem
          if (!id) return
          const r = el.getBoundingClientRect()
          const br = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
          if (rectsIntersect(sel, br)) ids.push(id)
        })
        if (ids.length > 0) {
          onPickShotIds(ids)
        }
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [enabled, onPickShotIds]
  )

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className={`relative box-border ${enabled ? "select-none outline outline-1 outline-dashed outline-[var(--color-muted)]/40 [-webkit-user-select:none]" : ""}`}
      style={{ boxSizing: "border-box" }}
      onMouseDown={onMouseDown}
      onClickCapture={onClickCapture}
    >
      {children}
      {box && (
        <div
          className="fixed z-[90] pointer-events-none border-2 border-dashed border-[var(--color-primary)] bg-[var(--color-primary)]/15 box-border"
          style={{
            boxSizing: "border-box",
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
          }}
          aria-hidden
        />
      )}
    </div>
  )
}
