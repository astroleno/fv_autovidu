/**
 * VideoPlayer 视频播放器
 * HTML5 video 封装：播放/暂停/进度条/全屏
 */
import { useRef, useState } from "react"

interface VideoPlayerProps {
  src: string
  className?: string
}

export function VideoPlayer({ src, className = "" }: VideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  const togglePlay = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) {
      v.play()
      setPlaying(true)
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
    ref.current?.requestFullscreen()
  }

  return (
    <div className={`overflow-hidden bg-black border border-[var(--color-newsprint-black)] ${className}`}>
      <video
        ref={ref}
        src={src}
        className="w-full aspect-video object-contain"
        onEnded={() => setPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onClick={togglePlay}
      />
      <div className="flex items-center gap-2 p-2 bg-gray-900">
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
