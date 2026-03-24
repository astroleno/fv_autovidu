/**
 * 分镜表行内：首帧 / 尾帧小缩略图
 * - 鼠标悬浮：在视口内用 fixed 层展示更大预览（不遮挡点击目标）
 * - 点击缩略图：进入镜头详情（与父级传入的 detailPath 一致）
 *
 * 使用 Portal 挂载到 document.body，避免表格 td 的 overflow 裁剪悬浮层。
 */
import { useCallback, useState } from "react"
import { createPortal } from "react-dom"
import { Link } from "react-router"

/** 悬浮层宽度（px），与分镜表行高协调 */
const PREVIEW_W = 200

interface FrameHoverThumbnailProps {
  /** 图片地址（已由 getFileUrl 处理） */
  src: string
  alt: string
  /** 点击跳转：镜头详情 */
  detailPath: string
  /** 外层与 ShotFrameCompare row 变体中 vc.img 一致 */
  thumbClassName: string
  /** 内层 img，与 row 变体 grayscale 等一致 */
  imgClassName: string
}

export function FrameHoverThumbnail({
  src,
  alt,
  detailPath,
  thumbClassName,
  imgClassName,
}: FrameHoverThumbnailProps) {
  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const handleEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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
  }, [])

  const handleLeave = useCallback(() => {
    setHover(false)
    setPos(null)
  }, [])

  const showPortal = hover && pos !== null && typeof document !== "undefined"

  return (
    <>
      <div 
        className="relative box-border" 
        style={{ boxSizing: "border-box" }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <Link to={detailPath} className="block" aria-label={`${alt}，进入镜头详情`}>
          <div className={thumbClassName}>
            <img src={src} alt={alt} className={imgClassName} />
          </div>
        </Link>
      </div>
      {showPortal && pos &&
        createPortal(
          <div
            className="fixed z-[100] pointer-events-none border-2 border-[var(--color-newsprint-black)] shadow-[4px_4px_0px_0px_#111111] overflow-hidden bg-[var(--color-outline-variant)] box-border"
            style={{
              boxSizing: "border-box",
              left: pos.left,
              top: pos.top,
              width: PREVIEW_W,
              maxHeight: "min(72vh, 420px)",
            }}
            role="presentation"
          >
            <img
              src={src}
              alt=""
              className="w-full h-full max-h-[min(72vh,420px)] object-cover grayscale-img"
            />
          </div>,
          document.body
        )}
    </>
  )
}
