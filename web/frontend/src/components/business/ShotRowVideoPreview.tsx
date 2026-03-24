/**
 * 分镜表「视频」列单元
 *
 * - 展示当前镜头的主视频缩略（优先「已选定」候选，否则第一条候选）
 * - 鼠标悬浮：在页面固定层播放静音循环预览，便于快速浏览
 * - 点击：进入镜头详情页（与首尾帧一致）
 *
 * 无候选时仍提供进入详情的文字链，便于用户去生成视频。
 */
import { useCallback, useState } from "react"
import { createPortal } from "react-dom"
import { Link } from "react-router"
import { Film } from "lucide-react"
import type { Shot } from "@/types"
import { getFileUrl } from "@/utils/file"
import { routes } from "@/utils/routes"

const PREVIEW_W = 200

interface ShotRowVideoPreviewProps {
  shot: Shot
  projectId: string
  episodeId: string
  basePath: string
  cacheBust?: string
}

export function ShotRowVideoPreview({
  shot,
  projectId,
  episodeId,
  basePath,
  cacheBust,
}: ShotRowVideoPreviewProps) {
  const detailPath = routes.shot(projectId, episodeId, shot.shotId)
  const selected = shot.videoCandidates.find((c) => c.selected)
  const primary = selected ?? shot.videoCandidates[0]

  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const videoUrl = primary ? getFileUrl(primary.videoPath, basePath, cacheBust) : ""
  const posterUrl =
    primary?.thumbnailPath && primary.thumbnailPath.trim()
      ? getFileUrl(primary.thumbnailPath, basePath, cacheBust)
      : ""

  const handleEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!primary || !videoUrl) return
      const r = e.currentTarget.getBoundingClientRect()
      const gap = 8
      let left = r.right + gap
      if (left + PREVIEW_W > window.innerWidth - 16) {
        left = r.left - PREVIEW_W - gap
      }
      if (left < 8) left = 8
      const maxH = Math.min(window.innerHeight * 0.72, 420)
      let top = r.top
      if (top + maxH > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - 8 - maxH)
      }
      if (top < 8) top = 8
      setPos({ left, top })
      setHover(true)
    },
    [primary, videoUrl]
  )

  const handleLeave = useCallback(() => {
    setHover(false)
    setPos(null)
  }, [])

  const showPortal = hover && pos !== null && typeof document !== "undefined"

  if (!primary || !videoUrl) {
    return (
      <Link
        to={detailPath}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-primary)] underline-offset-2 hover:underline box-border"
        style={{ boxSizing: "border-box" }}
      >
        <Film className="w-4 h-4 shrink-0 opacity-50" aria-hidden />
        无视频 · 去详情
      </Link>
    )
  }

  return (
    <>
      <div
        className="relative inline-block align-top box-border"
        style={{ boxSizing: "border-box" }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <Link
          to={detailPath}
          className="block"
          aria-label="视频预览，进入镜头详情"
        >
          <div className="relative w-[5rem] h-[7.5rem] shrink-0 overflow-hidden bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)] box-border">
            <video
              src={videoUrl}
              poster={posterUrl || undefined}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
            {selected ? (
              <span className="absolute bottom-0.5 left-0.5 text-[8px] font-black uppercase bg-[var(--color-primary)] text-white px-1 border border-[var(--color-newsprint-black)]">
                已选
              </span>
            ) : null}
          </div>
        </Link>
      </div>
      {showPortal && pos &&
        createPortal(
          <div
            className="fixed z-[100] pointer-events-none border-2 border-[var(--color-newsprint-black)] shadow-[4px_4px_0px_0px_#111111] overflow-hidden bg-black box-border"
            style={{
              boxSizing: "border-box",
              left: pos.left,
              top: pos.top,
              width: PREVIEW_W,
              maxHeight: "min(72vh, 420px)",
            }}
            role="presentation"
          >
            <video
              src={videoUrl}
              poster={posterUrl || undefined}
              className="w-full h-full max-h-[min(72vh,420px)] object-cover"
              muted
              playsInline
              loop
              autoPlay
            />
          </div>,
          document.body
        )}
    </>
  )
}
