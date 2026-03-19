/**
 * ShotCard Shot 卡片
 * Stitch 报纸风格：newsprint-card、灰度图、方角、UPPERCASE 标签
 */
import { Link } from "react-router"
import type { Shot } from "@/types"
import { Badge } from "@/components/ui"
import { StatusIndicator, AssetTag } from "@/components/business"
import { shotStatusLabels } from "@/utils/format"
import { getFileUrl } from "@/utils/file"

interface ShotCardProps {
  shot: Shot
  episodeId: string
  basePath?: string
  /** 缓存破坏，重新拉取后图片刷新 */
  cacheBust?: string
}

export function ShotCard({ shot, episodeId, basePath = "", cacheBust }: ShotCardProps) {
  const firstFrameUrl = getFileUrl(shot.firstFrame, basePath, cacheBust)
  const endFrameUrl = shot.endFrame ? getFileUrl(shot.endFrame, basePath, cacheBust) : null

  return (
    <div className="newsprint-card p-4 box-border">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--color-newsprint-black)] border-dashed">
        <span className="text-[10px] font-black uppercase tracking-tighter text-[var(--color-newsprint-black)] opacity-80">
          S{String(shot.shotNumber).padStart(2, "0")} | {shot.cameraMovement} | {shot.duration}s
        </span>
        <StatusIndicator status={shot.status} />
      </div>
      <Link to={`/episode/${episodeId}/shot/${shot.shotId}`} className="group block">
        <div className="relative aspect-video overflow-hidden bg-[var(--color-outline-variant)] mb-4 border border-[var(--color-newsprint-black)]">
          {firstFrameUrl ? (
            <img
              src={firstFrameUrl}
              alt={`Shot ${shot.shotNumber}`}
              className="w-full h-full object-cover grayscale-img"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[var(--color-muted)] text-sm uppercase">
              暂无首帧
            </div>
          )}
        </div>
      </Link>
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2 text-[10px] font-black uppercase tracking-wider">
          <span className="text-[var(--color-muted)]">尾帧</span>
          <Badge status={shot.status} pulse={
            shot.status === "endframe_generating" || shot.status === "video_generating"
          }>
            {shotStatusLabels[shot.status]}
          </Badge>
        </div>
        {endFrameUrl ? (
          <img
            src={endFrameUrl}
            alt="尾帧"
            className="h-12 w-16 object-cover border border-[var(--color-newsprint-black)] grayscale-img"
          />
        ) : (
          <div className="h-12 w-16 border border-dashed border-[var(--color-newsprint-black)] flex items-center justify-center text-[10px] text-[var(--color-muted)] uppercase">
            待生成
          </div>
        )}
      </div>
      {shot.assets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {shot.assets.map((a) => (
            <AssetTag key={a.assetId} asset={a} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1">
        <Link to={`/episode/${episodeId}/shot/${shot.shotId}/regen`}>
          <button
            type="button"
            className="w-full py-1.5 text-[10px] font-black uppercase tracking-wider border border-[var(--color-newsprint-black)] bg-transparent hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
          >
            重生
          </button>
        </Link>
        <button
          type="button"
          className="w-full py-1.5 text-[10px] font-black uppercase tracking-wider border border-[var(--color-newsprint-black)] bg-transparent hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
        >
          尾帧
        </button>
        <Link to={`/episode/${episodeId}/shot/${shot.shotId}`}>
          <button
            type="button"
            className="w-full py-1.5 text-[10px] font-black uppercase tracking-wider bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)] border border-[var(--color-newsprint-black)] hover:bg-[var(--color-primary)] hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
          >
            出视频
          </button>
        </Link>
      </div>
    </div>
  )
}
