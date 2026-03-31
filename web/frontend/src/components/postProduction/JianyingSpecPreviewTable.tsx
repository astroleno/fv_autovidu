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
  subtitlePreviewSourceHint,
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
            const sourceHint = subtitlePreviewSourceHint(shot)
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
                    <span className="inline-flex flex-col gap-0.5">
                      <span className="break-words leading-snug">{previewOneLine}</span>
                      {sourceHint ? (
                        <span className="text-[9px] text-[var(--color-muted)]">
                          {sourceHint}
                        </span>
                      ) : null}
                    </span>
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
        无可用字幕文案时整行显示「—」。正文优先级：译文 → 台词原文 → 结构化对白 →
        <strong className="text-[var(--color-newsprint-black)]">画面描述</strong>
        （平台未单独填台词时）。换行分段数按正文中的换行符统计；多行在「字幕预览」列以「 / 」连接以便辨认。公式用
        n = min(分段数, 3)。仅靠剪映内自动换行、未在文案里打换行时，分段数为 1。
      </p>
    </div>
  )
}
