/**
 * 剪映规范模式：按当前剧集镜头预估行数 n、规范字号与 Y / transform_y 示意（导出仍以服务端为准）。
 */
import type { Episode } from "@/types"
import { flattenShots } from "@/types"
import {
  estimateSubtitleLineCount,
  JIANYING_SPEC_FONT_SIZE,
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
      <table className="w-full border-collapse min-w-[520px]">
        <thead>
          <tr className="bg-[var(--color-outline-variant)]/40 text-left text-[var(--color-muted)]">
            <th className="py-1.5 px-2 font-bold">镜号</th>
            <th className="py-1.5 px-2 font-bold">行数 n</th>
            <th className="py-1.5 px-2 font-bold">规范字号</th>
            <th className="py-1.5 px-2 font-bold">Y（像素）</th>
            <th className="py-1.5 px-2 font-bold">transform_y 示意</th>
          </tr>
        </thead>
        <tbody>
          {shots.map((shot) => {
            const body = subtitleTextFromShot(shot)
            const has = body.trim().length > 0
            const n = has ? estimateSubtitleLineCount(body) : 0
            const fs = has ? JIANYING_SPEC_FONT_SIZE : 0
            const preview = has
              ? jianyingSpecYAndTransformPreview(n, canvasSize)
              : { yPixel: 0, transformY: 0 }
            return (
              <tr
                key={shot.shotId}
                className="border-t border-[var(--color-outline-variant)] align-top"
              >
                <td className="py-1.5 px-2">{shot.shotNumber}</td>
                <td className="py-1.5 px-2">{has ? n : "—"}</td>
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
      <p className="p-2 text-[10px] text-[var(--color-muted)] leading-snug">
        无台词的镜头显示「—」。行数按文案中的换行符统计；仅自动换行无法在此预估。
      </p>
    </div>
  )
}
