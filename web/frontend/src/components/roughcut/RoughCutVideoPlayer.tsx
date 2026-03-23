/**
 * 粗剪台 — 预览播放器（对齐原型：黑底画面 + 底部白底控制条、时间码、上/下镜头）
 * 在通用 VideoPlayer 基础上增强布局与镜头级跳转，不修改原组件以免影响其他页面。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { SkipBack, SkipForward, Volume2, Maximize2, Settings } from "lucide-react"

export interface RoughCutVideoPlayerProps {
  /** 当前镜头 mp4 地址 */
  src: string
  /** 上一镜头（无可点时禁用） */
  onPrevClip?: () => void
  /** 下一镜头 */
  onNextClip?: () => void
  disablePrev?: boolean
  disableNext?: boolean
  /** 用于时间轴游标：当前播放时间、当前片段时长 */
  onTimeUpdate?: (currentSec: number, durationSec: number) => void
  className?: string
}

/**
 * 原型风格：画面区 + 底部固定控制条（白底黑字）
 */
export function RoughCutVideoPlayer({
  src,
  onPrevClip,
  onNextClip,
  disablePrev = false,
  disableNext = false,
  onTimeUpdate,
  className = "",
}: RoughCutVideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progressPct, setProgressPct] = useState(0)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)

  const togglePlay = useCallback(() => {
    const v = ref.current
    if (!v) return
    if (v.paused) {
      void v.play()
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const v = ref.current
    if (!v || !v.duration) return
    const d = v.duration
    setDur(d)
    setCur(v.currentTime)
    setProgressPct((v.currentTime / d) * 100)
    onTimeUpdate?.(v.currentTime, d)
  }, [onTimeUpdate])

  /** 切换 src 时重置进度显示 */
  useEffect(() => {
    setProgressPct(0)
    setCur(0)
    setDur(0)
    setPlaying(false)
  }, [src])

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = ref.current
    if (!v || !v.duration) return
    const p = Number(e.target.value)
    v.currentTime = (p / 100) * v.duration
    setProgressPct(p)
  }

  const fullscreen = () => {
    ref.current?.requestFullscreen?.()
  }

  const mmss = (s: number) => {
    const x = Math.floor(s)
    const m = Math.floor(x / 60)
    const ss = x % 60
    return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
  }

  return (
    <div
      className={`flex h-full max-h-full min-h-0 w-full flex-col overflow-hidden border border-[var(--color-newsprint-black)] bg-black ${className}`}
      style={{ boxSizing: "border-box" }}
    >
      {/** 画面区域随父级限高收缩，避免 flex-1 在整页无限撑高 */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={ref}
          src={src}
          className="h-full w-full object-contain opacity-90"
          onEnded={() => setPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleTimeUpdate}
          onClick={togglePlay}
        />
        {/* 底部控制条：原型为白底顶边 */}
        <div
          className="absolute inset-x-0 bottom-0 flex flex-col gap-2 border-t border-[var(--color-newsprint-black)] bg-white px-3 py-2 text-[var(--color-newsprint-black)] box-border"
          style={{ boxSizing: "border-box" }}
        >
          {/* 进度：底层浅轨 + range 控件（同原型进度条交互） */}
          <div className="relative h-2 w-full">
            <div className="pointer-events-none absolute inset-y-0 left-0 right-0 overflow-hidden bg-black/10">
              <div
                className="h-full bg-[var(--color-primary)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={progressPct}
              onChange={handleSeek}
              className="relative z-10 h-2 w-full cursor-pointer opacity-80 accent-[var(--color-primary)]"
              aria-label="进度"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => onPrevClip?.()}
                disabled={disablePrev}
                className="hover:text-[var(--color-primary)] disabled:opacity-30"
                aria-label="上一镜头"
              >
                <SkipBack className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                className="flex h-8 w-8 items-center justify-center bg-[var(--color-newsprint-black)] text-white hover:bg-[var(--color-primary)]"
                aria-label={playing ? "暂停" : "播放"}
              >
                {playing ? (
                  <span className="text-xs">⏸</span>
                ) : (
                  <span className="text-xs">▶</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onNextClip?.()}
                disabled={disableNext}
                className="hover:text-[var(--color-primary)] disabled:opacity-30"
                aria-label="下一镜头"
              >
                <SkipForward className="h-5 w-5" />
              </button>
              <div className="text-[10px] font-mono font-bold">
                {mmss(cur)} / {dur > 0 ? mmss(dur) : "--:--"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="hover:text-[var(--color-primary)]" aria-label="音量">
                <Volume2 className="h-4 w-4" />
              </button>
              <button type="button" className="hover:text-[var(--color-primary)]" aria-label="设置">
                <Settings className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={fullscreen}
                className="hover:text-[var(--color-primary)]"
                aria-label="全屏"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
