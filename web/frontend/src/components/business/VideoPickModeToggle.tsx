/**
 * VideoPickModeToggle — 选片页 Overview / Picking 显式切换
 *
 * 设计：低学习成本的分段按钮；Picking 时额外提供「返回列表」文案，与 Esc 行为一致。
 *
 * onEnterPicking：从「列表」点「选片」时由页面注入（例如定位到第一个待选镜头），
 * 若省略则仅 setMode("picking")（不推荐，易停留在索引 0）。
 */
import { useVideoPickStore } from "@/stores"

export interface VideoPickModeToggleProps {
  /** 用户点击「选片」分段按钮时调用（应 enterPicking + 默认镜头索引） */
  onEnterPicking?: () => void
}

export function VideoPickModeToggle({
  onEnterPicking,
}: VideoPickModeToggleProps) {
  const mode = useVideoPickStore((s) => s.mode)
  const exitPicking = useVideoPickStore((s) => s.exitPicking)

  return (
    <div
      className="inline-flex rounded-sm border border-[var(--color-newsprint-black)] overflow-hidden box-border"
      style={{ boxSizing: "border-box" }}
      role="group"
      aria-label="选片视图模式"
    >
      <button
        type="button"
        className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors box-border ${
          mode === "overview"
            ? "bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)]"
            : "bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-outline-variant)]"
        }`}
        style={{ boxSizing: "border-box" }}
        onClick={() => exitPicking()}
      >
        列表
      </button>
      <button
        type="button"
        className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors border-l border-[var(--color-newsprint-black)] box-border ${
          mode === "picking"
            ? "bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)]"
            : "bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-outline-variant)]"
        }`}
        style={{ boxSizing: "border-box" }}
        onClick={() => {
          if (onEnterPicking) onEnterPicking()
        }}
      >
        选片
      </button>
      {mode === "picking" ? (
        <button
          type="button"
          className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border-l border-[var(--color-newsprint-black)] bg-[var(--color-primary)] text-white hover:opacity-90 box-border"
          style={{ boxSizing: "border-box" }}
          onClick={() => exitPicking()}
        >
          返回列表
        </button>
      ) : null}
    </div>
  )
}
