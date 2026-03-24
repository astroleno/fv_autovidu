/**
 * 批量操作范围：下拉选择「全部符合条件」或「框选（仅勾选）」
 *
 * 框选模式下展示：已选数量、全选当前筛选、清空、退出框选。
 * 网格内左键拖拽矩形框选见 MarqueeGrid；退出也可通过点击分镜工作区外（见 StoryboardPage）。
 */
import { useEffect, useRef, useState } from "react"
import { ChevronDown, LogOut, SquareDashedMousePointer } from "lucide-react"
import type { BatchPickMode } from "@/stores/shotStore"

export interface BatchPickScopeControlProps {
  /** 当前模式 */
  mode: BatchPickMode
  onModeChange: (mode: BatchPickMode) => void
  /** 已勾选镜头数（manual 时） */
  pickedCount: number
  /** 当前状态筛选下可见的镜头 id（用于「全选当前筛选」） */
  visibleShotIds: string[]
  /** 合并勾选 id */
  onPickMany: (shotIds: string[]) => void
  onClearPicks: () => void
}

export function BatchPickScopeControl({
  mode,
  onModeChange,
  pickedCount,
  visibleShotIds,
  onPickMany,
  onClearPicks,
}: BatchPickScopeControlProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  return (
    <div ref={rootRef} className="relative inline-flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-wider border border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] hover:bg-[var(--color-outline-variant)] transition-colors box-border"
          style={{ boxSizing: "border-box" }}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <SquareDashedMousePointer className="w-4 h-4 shrink-0" aria-hidden />
          {mode === "all_eligible" ? "批量范围：全部符合条件" : "批量范围：框选勾选"}
          <ChevronDown
            className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>

        {open && (
          <ul
            className="absolute left-0 top-full z-[80] mt-1 min-w-[16rem] border-2 border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] shadow-[4px_4px_0px_0px_#111111] py-1 box-border"
            style={{ boxSizing: "border-box" }}
            role="listbox"
          >
            <li>
              <button
                type="button"
                role="option"
                className={`w-full text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide hover:bg-[var(--color-outline-variant)] ${
                  mode === "all_eligible" ? "bg-[var(--color-primary)]/15" : ""
                }`}
                onClick={() => {
                  onModeChange("all_eligible")
                  setOpen(false)
                }}
              >
                默认：全部符合当前批量条件的镜头
              </button>
            </li>
            <li>
              <button
                type="button"
                role="option"
                className={`w-full text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide hover:bg-[var(--color-outline-variant)] ${
                  mode === "manual" ? "bg-[var(--color-primary)]/15" : ""
                }`}
                onClick={() => {
                  onModeChange("manual")
                  setOpen(false)
                }}
              >
                框选模式：仅勾选镜头（列表/网格勾选）
              </button>
            </li>
          </ul>
        )}
      </div>

      {mode === "manual" && (
        <span className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
          <span className="text-[var(--color-newsprint-black)]">已选 {pickedCount}</span>
          <button
            type="button"
            className="underline decoration-dotted hover:text-[var(--color-primary)]"
            onClick={() => onPickMany(visibleShotIds)}
          >
            全选当前筛选
          </button>
          <button
            type="button"
            className="underline decoration-dotted hover:text-[var(--color-primary)]"
            onClick={onClearPicks}
          >
            清空
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] text-[var(--color-newsprint-black)] hover:bg-[var(--color-primary)]/20 box-border"
            style={{ boxSizing: "border-box" }}
            onClick={() => onModeChange("all_eligible")}
            title="结束框选模式，恢复为「全部符合条件」"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden />
            退出框选
          </button>
        </span>
      )}
    </div>
  )
}
