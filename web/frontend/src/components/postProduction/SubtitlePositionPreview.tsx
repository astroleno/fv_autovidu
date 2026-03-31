/**
 * 字幕纵向位置（transform_y）双比例示意：竖屏 9:16 与横屏 16:9。
 *
 * 本应用剪映导出主流程为竖屏 9:16；横屏框用于帮助理解同一参数在不同画幅下的相对位置。
 * 条带位置由 subtitlePreviewLayout.transformYToPreviewBottomPercent 换算，仅供预期管理，非像素级预览。
 */
import { transformYToPreviewBottomPercent } from "./subtitlePreviewLayout"

export interface SubtitlePositionPreviewProps {
  /** 与表单 slider 同步的 ClipSettings.transform_y（-1～0） */
  transformY: number
}

/** 示意条高度占画框高度比例（仅视觉，与剪映字号无关） */
const BAR_H_FRAC = 0.08

export function SubtitlePositionPreview({ transformY }: SubtitlePositionPreviewProps) {
  const bottomPct = transformYToPreviewBottomPercent(transformY)

  return (
    <div
      className="flex flex-wrap items-end gap-6 p-3 border border-dashed border-[var(--color-divider)] bg-[var(--color-newsprint-off-white)]/50 box-border"
      style={{ boxSizing: "border-box" }}
      data-testid="subtitle-position-preview"
    >
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
          竖屏 9:16
        </span>
        <AspectPreviewFrame aspect="9/16" bottomPct={bottomPct} barHeightFrac={BAR_H_FRAC} />
      </div>
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
          横屏 16:9
        </span>
        <AspectPreviewFrame aspect="16/9" bottomPct={bottomPct} barHeightFrac={BAR_H_FRAC} />
      </div>
      <p className="w-full text-[10px] leading-snug text-[var(--color-muted)] mt-1">
        滑块越接近 0，示意条越靠上；越接近 -1 越靠下。与剪映内实际像素可能略有差异。
      </p>
    </div>
  )
}

interface AspectPreviewFrameProps {
  /** Tailwind aspect ratio token：9/16 或 16/9 */
  aspect: "9/16" | "16/9"
  bottomPct: number
  barHeightFrac: number
}

/**
 * 单画框 + 底部对齐的示意字幕条（absolute + bottom %）。
 */
function AspectPreviewFrame({ aspect, bottomPct, barHeightFrac }: AspectPreviewFrameProps) {
  const aspectClass = aspect === "9/16" ? "aspect-[9/16] w-[100px]" : "aspect-video w-[min(100%,200px)] min-w-[140px]"

  return (
    <div
      className={`relative overflow-hidden rounded border-2 border-[var(--color-newsprint-black)] bg-gradient-to-b from-zinc-200 to-zinc-400 ${aspectClass} box-border`}
      style={{ boxSizing: "border-box" }}
    >
      <div
        className="absolute left-1 right-1 rounded-sm bg-[var(--color-newsprint-black)]/85 text-center text-[8px] font-bold uppercase tracking-tight text-white flex items-center justify-center box-border px-0.5"
        style={{
          boxSizing: "border-box",
          bottom: `${bottomPct}%`,
          height: `${barHeightFrac * 100}%`,
        }}
      >
        字幕
      </div>
    </div>
  )
}
