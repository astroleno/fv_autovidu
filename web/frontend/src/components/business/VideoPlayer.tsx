/**
 * VideoPlayer 视频播放器
 * HTML5 video 封装：播放/暂停/进度条/全屏
 *
 * aspectRatio：与 Shot.aspectRatio 一致（如 9:16 / 16:9）时，竖屏用高度上限 + 水平居中，
 * 避免一律塞进 16:9 可视框导致竖屏成片过小；横屏仍用 aspect-video 宽占满。
 */
import { useRef, useState } from "react"

export interface VideoPlayerProps {
  src: string
  className?: string
  /** 与剧集镜头比例一致，如 "9:16"、"16:9"；缺省按横屏 16:9 区域处理 */
  aspectRatio?: string
}

/**
 * 将 episode 中的比例字符串规整后判断是否竖屏类比例，
 * 用于选择外层布局（居中窄条 vs 宽铺横屏区域）。
 */
function videoLayoutForAspect(aspectRatio: string | undefined): {
  outer: string
  video: string
} {
  const normalized = (aspectRatio ?? "16:9")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "")
    .replace("×", ":")

  const portrait =
    normalized === "9:16" ||
    normalized === "3:4" ||
    normalized === "4:5" ||
    normalized === "2:3" ||
    normalized === "9/16" ||
    normalized === "3/4"

  if (portrait) {
    return {
      outer:
        "flex w-full justify-center items-center bg-black min-h-[140px] box-border py-1",
      video:
        "h-[min(420px,52vh)] w-auto max-w-full object-contain box-border",
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
