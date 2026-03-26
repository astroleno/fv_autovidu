/**
 * VideoPlayer 视频播放器
 * HTML5 video 封装：播放/暂停/进度条/全屏
 *
 * 进度条：使用 `@/components/ui/VideoSeekBar`（剪映式圆形可拖拽拇指 + 底层已播轨道），
 * 避免原生 range 默认样式「看不见指针」的问题；播放控制使用 lucide Play/Pause，与粗剪台一致。
 *
 * aspectRatio：与 Shot.aspectRatio 一致时，经由 utils/aspectRatio 解析为多类布局：
 * - 竖屏：高度上限 + 水平居中
 * - 方屏 1:1：限制最大边长 + aspect-square
 * - 横屏：宽铺 aspect-video；超宽（约 2:1 及以上）用 aspect-[2/1] 减少上下留黑
 */
import { useEffect, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"
import { VideoSeekBar } from "@/components/ui/VideoSeekBar"
import {
  classifyAspectRatio,
  isUltrawideLandscape,
} from "@/utils/aspectRatio"

export interface VideoPlayerProps {
  src: string
  className?: string
  /** 与剧集镜头比例一致，如 "9:16"、"16:9"、"1080x1920"；缺省按横屏处理 */
  aspectRatio?: string
  /** 选片模式：当前激活候选自动播放 */
  autoPlay?: boolean
  /** 选片模式：播放结束后循环（与 autoPlay 配合） */
  loop?: boolean
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
  autoPlay = false,
  loop = false,
}: VideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null)
  /** 用户拖拽进度条时为 true，避免 timeupdate 与受控滑块抢进度导致无法拖拽 */
  const scrubbingRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const layout = videoLayoutForAspect(aspectRatio)

  /** 选片：激活态自动播；失活暂停，避免多路同时出声 */
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (autoPlay) {
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      v.pause()
      setPlaying(false)
    }
  }, [autoPlay, src])

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
    if (!v || !v.duration) return
    if (scrubbingRef.current) return
    setProgress((v.currentTime / v.duration) * 100)
  }

  const handleSeek = (p: number) => {
    const v = ref.current
    if (!v || !v.duration) return
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
          loop={loop}
          onEnded={() => {
            if (!loop) setPlaying(false)
          }}
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
          className="flex shrink-0 items-center justify-center p-1.5 text-white hover:bg-white/20"
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? (
            <Pause className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          ) : (
            <Play className="h-4 w-4" fill="currentColor" aria-hidden />
          )}
        </button>
        <VideoSeekBar
          value={progress}
          onChange={handleSeek}
          variant="onDark"
          className="min-w-0 flex-1"
          aria-label="播放进度"
          onSeekStart={() => {
            scrubbingRef.current = true
          }}
          onSeekEnd={() => {
            scrubbingRef.current = false
          }}
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
