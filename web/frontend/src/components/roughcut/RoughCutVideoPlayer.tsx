/**
 * 粗剪台 — 预览播放器（对齐原型：黑底画面 + 底部白底控制条、时间码、上/下镜头）
 * 在通用 VideoPlayer 基础上增强布局与镜头级跳转，不修改原组件以免影响其他页面。
 *
 * 播放行为：
 * - 当前镜播放结束时，若存在下一可播镜头，自动切换并继续播放（连续预览）。
 * - 在「正在播放」状态下通过按钮或键盘切换上/下一段时，新片段加载后继续播放。
 * - 键盘：←/→ 快退/快进（默认 5s）；↑/↓ 上一段/下一段。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { SkipBack, SkipForward, Volume2, Maximize2, Settings } from "lucide-react"

/** 默认单次快进/快退步长（秒） */
const DEFAULT_SEEK_STEP_SEC = 5

/**
 * 判断事件是否来自可编辑区域，避免在输入框里抢方向键。
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (target.isContentEditable) return true
  return !!target.closest('[contenteditable="true"]')
}

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
  /**
   * 键盘 ←/→ 每次调整的秒数（默认 5）。
   * 若设为 0 或负数则回退为 DEFAULT_SEEK_STEP_SEC。
   */
  seekStepSec?: number
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
  seekStepSec = DEFAULT_SEEK_STEP_SEC,
}: RoughCutVideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progressPct, setProgressPct] = useState(0)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)

  /**
   * 切换 src 后是否应在资源就绪时自动 play。
   * - 片尾自动接下一镜
   * - 正在播放时用户点了上/下一段或按 ↑/↓
   */
  const autoplayAfterSrcChangeRef = useRef(false)

  const stepSec =
    seekStepSec > 0 && Number.isFinite(seekStepSec) ? seekStepSec : DEFAULT_SEEK_STEP_SEC

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

  /**
   * 在「当前正在播放」的前提下切换镜头时，标记下一镜加载完成后自动续播。
   */
  const markAutoplayIfPlayingBeforeClipChange = useCallback(() => {
    const v = ref.current
    if (v && !v.paused) {
      autoplayAfterSrcChangeRef.current = true
    }
  }, [])

  /** 用户点击「上一段」：若正在播则切镜后继续播 */
  const handlePrevClipClick = useCallback(() => {
    if (disablePrev || !onPrevClip) return
    markAutoplayIfPlayingBeforeClipChange()
    onPrevClip()
  }, [disablePrev, onPrevClip, markAutoplayIfPlayingBeforeClipChange])

  /** 用户点击「下一段」：若正在播则切镜后继续播 */
  const handleNextClipClick = useCallback(() => {
    if (disableNext || !onNextClip) return
    markAutoplayIfPlayingBeforeClipChange()
    onNextClip()
  }, [disableNext, onNextClip, markAutoplayIfPlayingBeforeClipChange])

  /**
   * 片尾：有下一段则自动切镜并标记 autoplay；否则仅停在本镜末尾。
   */
  const handleEnded = useCallback(() => {
    if (!disableNext && onNextClip) {
      autoplayAfterSrcChangeRef.current = true
      onNextClip()
      return
    }
    setPlaying(false)
  }, [disableNext, onNextClip])

  /**
   * src 变化时重置进度条显示；若需要连播则在 canplay 后 play()。
   */
  useEffect(() => {
    setProgressPct(0)
    setCur(0)
    setDur(0)

    const v = ref.current
    if (!v) return

    const shouldAutoplay = autoplayAfterSrcChangeRef.current
    autoplayAfterSrcChangeRef.current = false

    if (!shouldAutoplay) {
      setPlaying(false)
      return
    }

    setPlaying(false)

    const tryPlay = () => {
      void v
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false))
    }

    // 已缓存时可能立即就绪，避免漏掉 canplay
    if (v.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      tryPlay()
      return
    }

    const onCanPlay = () => {
      v.removeEventListener("canplay", onCanPlay)
      tryPlay()
    }
    v.addEventListener("canplay", onCanPlay)
    return () => v.removeEventListener("canplay", onCanPlay)
  }, [src])

  /**
   * 全局快捷键：←/→ 快进快退，↑/↓ 上/下一段（不在输入框内时生效）。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (isTypingTarget(e.target)) return

      const v = ref.current
      if (!v) return

      switch (e.key) {
        case "ArrowLeft": {
          e.preventDefault()
          const t = Math.max(0, v.currentTime - stepSec)
          v.currentTime = t
          handleTimeUpdate()
          break
        }
        case "ArrowRight": {
          e.preventDefault()
          const end = v.duration && !Number.isNaN(v.duration) ? v.duration : v.currentTime + stepSec
          const t = Math.min(end, v.currentTime + stepSec)
          v.currentTime = t
          handleTimeUpdate()
          break
        }
        case "ArrowUp": {
          e.preventDefault()
          if (disablePrev || !onPrevClip) return
          markAutoplayIfPlayingBeforeClipChange()
          onPrevClip()
          break
        }
        case "ArrowDown": {
          e.preventDefault()
          if (disableNext || !onNextClip) return
          markAutoplayIfPlayingBeforeClipChange()
          onNextClip()
          break
        }
        default:
          break
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [
    stepSec,
    disablePrev,
    disableNext,
    onPrevClip,
    onNextClip,
    handleTimeUpdate,
    markAutoplayIfPlayingBeforeClipChange,
  ])

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
      tabIndex={0}
      role="region"
      aria-label="粗剪预览：左右键快进，上下键切镜"
    >
      {/** 画面区域随父级限高收缩，避免 flex-1 在整页无限撑高 */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={ref}
          src={src}
          className="h-full w-full object-contain opacity-90"
          onEnded={handleEnded}
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
                onClick={handlePrevClipClick}
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
                onClick={handleNextClipClick}
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
          {/* 快捷键说明（与实现一致，避免用户误解方向键） */}
          <p className="text-[9px] leading-tight text-[var(--color-muted)]">
            ← → 快退/快进 {stepSec}s · ↑ ↓ 上/下一段 · 片尾自动播下一段
          </p>
        </div>
      </div>
    </div>
  )
}
