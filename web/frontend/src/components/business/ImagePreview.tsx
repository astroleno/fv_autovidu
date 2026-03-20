/**
 * ImagePreview 图片预览
 * Stitch：默认彩色、0px 圆角、newsprint 边框（与全局 .grayscale-img 一致现为彩色）
 */
import { useState } from "react"

interface ImagePreviewProps {
  src: string
  alt?: string
  className?: string
}

export function ImagePreview({ src, alt = "", className = "" }: ImagePreviewProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group block overflow-hidden border border-[var(--color-newsprint-black)] ${className}`}
      >
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover grayscale-img"
        />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-full object-contain border-2 border-[var(--color-newsprint-black)]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
