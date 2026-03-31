/**
 * 剪映规范模式：按当前剧集镜头预估行数 n、规范字号与 Y / transform_y 示意（导出仍以服务端为准）。
 */
import type { Episode } from "@/types"
import { flattenShots } from "@/types"
import {
  estimateSubtitleLineCount,
  formatSubtitlePreviewOneLine,
  JIANYING_SPEC_FONT_SIZE,
  jianyingSpecLineCount,
  jianyingSpecYAndTransformPreview,
  subtitleTextFromShot,
} from "@/utils/jianyingSubtitleText"

export interface JianyingSpecPreviewTableProps {
  episode: Episode
  canvasSize: "720p" | "1080p"
}

export function JianyingSpecPreviewTable({
  episode,
  canvasSize,
}: JianyingSpecPreviewTableProps) {
  const shots = flattenShots(episode)

  return (
    <div
      className="overflow-x-auto border border-[var(--color-divider)] text-[11px] box-border"
      style={{ boxSizing: "border-box" }}
      data-testid="jianying-spec-preview-table"
    >
      <table className="w-full border-collapse min-w-[720px]">
        <thead>
          <tr className="bg-[var(--color-outline-variant)]/40 text-left text-[var(--color-muted)]">
            <th className="py-1.5 px-2 font-bold">镜号</th>
            <th className="py-1.5 px-2 font-bold min-w-[140px]">字幕预览</th>
            <th className="py-1.5 px-2 font-bold">换行分段数</th>
            <th className="py-1.5 px-2 font-bold">n（公式，≤3）</th>
            <th className="py-1.5 px-2 font-bold">规范字号</th>
            <th className="py-1.5 px-2 font-bold">Y（像素）</th>
            <th className="py-1.5 px-2 font-bold">transform_y 示意</th>
          </tr>
        </thead>
        <tbody>
          {shots.map((shot) => {
            const body = subtitleTextFromShot(shot)
            const has = body.trim().length > 0
            /** 按换行统计的原始非空行数（无上限），便于与 capped 的 n 对照。 */
            const rawLines = has ? estimateSubtitleLineCount(body) : 0
            /** 参与 Y=-100n-400 的 n，与导出一致，最大 3。 */
            const nFormula = has ? jianyingSpecLineCount(body) : 0
            const fs = has ? JIANYING_SPEC_FONT_SIZE : 0
            const preview = has
              ? jianyingSpecYAndTransformPreview(nFormula, canvasSize)
              : { yPixel: 0, transformY: 0 }
            const previewOneLine = has
              ? formatSubtitlePreviewOneLine(body, 72)
              : ""
            return (
              <tr
                key={shot.shotId}
                className="border-t border-[var(--color-outline-variant)] align-top"
              >
                <td className="py-1.5 px-2">{shot.shotNumber}</td>
                <td className="py-1.5 px-2 text-[var(--color-newsprint-black)]">
                  {has ? (
                    <span className="break-words leading-snug">{previewOneLine}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-1.5 px-2">{has ? rawLines : "—"}</td>
                <td className="py-1.5 px-2">{has ? nFormula : "—"}</td>
                <td className="py-1.5 px-2">{has ? fs : "—"}</td>
                <td className="py-1.5 px-2 font-mono">{has ? preview.yPixel : "—"}</td>
                <td className="py-1.5 px-2 font-mono">
                  {has ? preview.transformY.toFixed(3) : "—"}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="p-2 text-[10px] text-[var(--color-muted)] leading-snug box-border">
        无台词（译文/原文/结构化对白）时整行显示「—」。换行分段数：有显式换行时按非空行数；无换行时按约
        <strong className="text-[var(--color-newsprint-black)]">7 英文词/行</strong>
        与汉字「约两字等效一词宽」估算自动折行行数（与剪映竖屏常见密度接近）。公式用 n = min(估算行数,
        3)。「字幕预览」中多行显式换行以「 / 」连接。
      </p>
    </div>
  )
}
