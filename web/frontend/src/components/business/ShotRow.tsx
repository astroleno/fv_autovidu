/**
 * ShotRow 列表视图行
 * 表格形式：编号 | 首帧缩略 | 尾帧缩略 | 状态 | prompt 摘要 | 资产 | 视频候选数 | 操作
 */
import { Link } from "react-router"
import type { Shot } from "@/types"
import { Badge } from "@/components/ui"
import { StatusIndicator } from "@/components/business"
import { shotStatusLabels } from "@/utils/format"
import { getFileUrl } from "@/utils/file"

interface ShotRowProps {
  shot: Shot
  episodeId: string
  basePath?: string
  /** 缓存破坏，重新拉取后图片刷新 */
  cacheBust?: string
}

export function ShotRow({ shot, episodeId, basePath = "", cacheBust }: ShotRowProps) {
  const firstFrameUrl = getFileUrl(shot.firstFrame, basePath, cacheBust)
  const endFrameUrl = shot.endFrame ? getFileUrl(shot.endFrame, basePath, cacheBust) : null

  return (
    <tr className="border-b border-[var(--color-divider)] hover:bg-[var(--color-divider)]/50">
      <td className="py-3 px-4 text-sm font-medium">{shot.shotNumber}</td>
      <td className="py-3 px-4">
        {firstFrameUrl ? (
          <img
            src={firstFrameUrl}
            alt=""
            className="w-12 h-8 object-cover border border-[var(--color-newsprint-black)] grayscale-img"
          />
        ) : (
          <div className="w-12 h-8 bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)]" />
        )}
      </td>
      <td className="py-3 px-4">
        {endFrameUrl ? (
          <img
            src={endFrameUrl}
            alt=""
            className="w-12 h-8 object-cover border border-[var(--color-newsprint-black)] grayscale-img"
          />
        ) : (
          <div className="w-12 h-8 bg-[var(--color-outline-variant)] border border-dashed border-[var(--color-newsprint-black)]" />
        )}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <StatusIndicator status={shot.status} />
          <Badge status={shot.status}>{shotStatusLabels[shot.status]}</Badge>
        </div>
      </td>
      <td className="py-3 px-4 text-xs text-[var(--color-muted)] max-w-[200px] truncate">
        {shot.imagePrompt.slice(0, 40)}...
      </td>
      <td className="py-3 px-4 text-xs">{shot.assets.map((a) => a.name).join(", ") || "-"}</td>
      <td className="py-3 px-4 text-sm">{shot.videoCandidates.length}</td>
      <td className="py-3 px-4">
        <Link to={`/episode/${episodeId}/shot/${shot.shotId}`}>
          <button
            type="button"
            className="text-xs text-[var(--color-primary)] hover:underline"
          >
            详情
          </button>
        </Link>
      </td>
    </tr>
  )
}
