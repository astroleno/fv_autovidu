/**
 * VideoSeekBar — 视频进度条（剪映式：底层已播轨道 + 可拖拽圆形指针）
 *
 * 设计说明：
 * - 仅用原生 `<input type="range">` 时，默认样式在 Chrome/Safari 上几乎看不到拇指，
 *   拖拽感差；本组件在底层叠「已播进度」条，并对 range 做跨浏览器 thumb 样式（见 index.css）。
 * - `variant` 区分深色底栏（选片/详情通用播放器）与粗剪台白底控制条，拇指对比度不同。
 * - 父级已设置全局 `box-sizing: border-box`；本组件内联 padding 的容器仍显式声明。
 *
 * 拖拽与受控组件：
 * - 父组件若用 `<video>.currentTime` 驱动 `value`，`timeupdate` 会与用户拖拽「抢进度」，
 *   表现为滑块拖不动或跳回。请在 `onSeekStart` / `onSeekEnd` 之间暂停用 timeupdate 写回 value。
 * - Safari 等对 range 更依赖 `input` 事件，故同时绑定 `onInput` 与 `onChange`。
 * - 使用 Pointer Capture，避免拖拽过程中指针移出控件导致松手不触发 end。
 */
import { useRef, type ChangeEvent, type FormEvent, type PointerEvent } from "react"

export interface VideoSeekBarProps {
  /** 当前进度 0–100 */
  value: number
  /** 用户拖动或点击后提交的新进度 0–100 */
  onChange: (value: number) => void
  /**
   * onDark：深灰底控制条（如 VideoPlayer 底部栏），拇指偏亮；
   * onLight：白底控制条（如粗剪台），拇指与轨道对比符合剪映式清晰指针。
   */
  variant?: "onDark" | "onLight"
  className?: string
  /** 无障碍：读屏器标签 */
  "aria-label"?: string
  /** 用户按下进度条（开始 scrub）：父组件应停止用 timeupdate 覆盖 value */
  onSeekStart?: () => void
  /** 用户释放指针（结束 scrub）：父组件恢复 timeupdate 同步 */
  onSeekEnd?: () => void
}

/**
 * 将 0–100 限制在合法区间，避免 NaN 或越界导致样式异常。
 */
function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

export function VideoSeekBar({
  value,
  onChange,
  variant = "onDark",
  className = "",
  "aria-label": ariaLabel = "播放进度",
  onSeekStart,
  onSeekEnd,
}: VideoSeekBarProps) {
  const pct = clampPct(value)
  /** 防止 pointerup 与 lostpointercapture 连续触发时重复 onSeekEnd */
  const seekSessionRef = useRef(false)

  const applyValue = (raw: number) => {
    onChange(clampPct(raw))
  }

  /** React 的 change；部分浏览器 range 拖拽时与 input 同时触发，值相同，重复 apply 无害 */
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    applyValue(Number(e.target.value))
  }

  /** Safari 等：拖拽过程中更稳定地触发 */
  const handleInput = (e: FormEvent<HTMLInputElement>) => {
    applyValue(Number(e.currentTarget.value))
  }

  const beginSeek = () => {
    if (seekSessionRef.current) return
    seekSessionRef.current = true
    onSeekStart?.()
  }

  const endSeek = () => {
    if (!seekSessionRef.current) return
    seekSessionRef.current = false
    onSeekEnd?.()
  }

  const handlePointerDown = (e: PointerEvent<HTMLInputElement>) => {
    beginSeek()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 忽略：极少数环境不支持 capture */
    }
  }

  const handlePointerUp = (e: PointerEvent<HTMLInputElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      /* ignore */
    }
    endSeek()
  }

  /** 已播段高亮：深浅控制条均使用主色条（与剪映时间轴「已播」色块一致） */
  const fillClass = "bg-[var(--color-primary)]"

  /** 未播轨道底色 */
  const trackBgClass =
    variant === "onDark" ? "bg-white/15" : "bg-black/10"

  /** range 上附加的类名：与 index.css 中 .video-seek-bar* 配对 */
  const rangeClass =
    variant === "onDark"
      ? "video-seek-bar video-seek-bar--on-dark"
      : "video-seek-bar video-seek-bar--on-light"

  return (
    <div
      className={`relative flex h-7 w-full min-w-0 items-center box-border ${className}`}
      style={{ boxSizing: "border-box" }}
    >
      {/** 轨道槽：固定高度 4px，与 CSS 中 runnable-track 高度一致 */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden ${trackBgClass} box-border`}
        style={{ boxSizing: "border-box" }}
        aria-hidden
      />
      {/** 已播进度填充（宽度随 value 变化，与 range 同步） */}
      <div
        className={`pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 ${fillClass} box-border`}
        style={{
          boxSizing: "border-box",
          width: `${pct}%`,
        }}
        aria-hidden
      />
      {/** 可交互层：透明轨道 + 显式拇指（样式在全局 CSS）；touch-action 避免触控板/触摸把拖拽当成滚动 */}
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={pct}
        onChange={handleChange}
        onInput={handleInput}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={endSeek}
        className={`relative z-10 h-7 w-full min-w-0 cursor-pointer touch-none ${rangeClass}`}
        style={{ boxSizing: "border-box" }}
        aria-label={ariaLabel}
      />
    </div>
  )
}
