/**
 * VideoPlayer 视频播放器
 * HTML5 video 封装：播放/暂停/进度条/全屏
 *
 * aspectRatio：与 Shot.aspectRatio 一致时，经由 utils/aspectRatio 解析为多类布局：
 * - 竖屏：高度上限 + 水平居中
 * - 方屏 1:1：限制最大边长 + aspect-square
 * - 横屏：宽铺 aspect-video；超宽（约 2:1 及以上）用 aspect-[2/1] 减少上下留黑
 */
import { useRef, useState } from "react"
import {
  classifyAspectRatio,
  isUltrawideLandscape,
} from "@/utils/aspectRatio"

export interface VideoPlayerProps {
  src: string
  className?: string
  /** 与剧集镜头比例一致，如 "9:16"、"16:9"、"1080x1920"；缺省按横屏处理 */
  aspectRatio?: string
}

function videoLayoutForAspect(aspectRatio: string | undefined): {
  outer: string
  video: string
} {
  const kind = classifyAspectRatio(aspectRatio)

  if (kind === "square") {
    return {
      outer:
        "flex w-full justify-center items-center bg-black min-h-[120px] box-border py-1",
      video:
        "w-[min(100%,360px)] aspect-square max-h-[min(360px,50vh)] object-contain box-border",
    }
  }
  if (kind === "portrait") {
    return {
      outer:
        "flex w-full justify-center items-center bg-black min-h-[140px] box-border py-1",
      video:
        "h-[min(420px,52vh)] w-auto max-w-full object-contain box-border",
    }
  }
  /** landscape */
  if (isUltrawideLandscape(aspectRatio)) {
    return {
      outer: "w-full box-border",
      video: "w-full aspect-[2/1] max-h-[min(240px,40vh)] object-contain box-border",
    }
  }
  return {
    outer: "w-full box-border",
    video: "w-full aspect-video object-contain box-border",
  }
}

export function VideoPlayer({
  src,
  className = "",
  aspectRatio,
}: VideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const layout = videoLayoutForAspect(aspectRatio)

  const togglePlay = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) {
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  const handleTimeUpdate = () => {
    const v = ref.current
    if (v && v.duration) setProgress((v.currentTime / v.duration) * 100)
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = ref.current
    if (!v || !v.duration) return
    const p = Number(e.target.value)
    v.currentTime = (p / 100) * v.duration
    setProgress(p)
  }

  const handleFullscreen = () => {
    void ref.current?.requestFullscreen()
  }

  return (
    <div
      className={`overflow-hidden bg-black border border-[var(--color-newsprint-black)] box-border ${className}`}
      style={{ boxSizing: "border-box" }}
    >
      <div
        className={layout.outer}
        style={{ boxSizing: "border-box" }}
      >
        <video
          ref={ref}
          src={src}
          className={layout.video}
          style={{ boxSizing: "border-box" }}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onClick={togglePlay}
        />
      </div>
      <div
        className="flex items-center gap-2 p-2 bg-gray-900 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <button
          type="button"
          onClick={togglePlay}
          className="p-1 text-white hover:bg-white/20"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={progress}
          onChange={handleSeek}
          className="flex-1 h-1"
        />
        <button
          type="button"
          onClick={handleFullscreen}
          className="p-1 text-white hover:bg-white/20 text-xs"
        >
          全屏
        </button>
      </div>
    </div>
  )
}
