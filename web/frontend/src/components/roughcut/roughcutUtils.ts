/**
 * 粗剪时间线（Rough Cut）通用工具函数
 * —— 时长格式化、标尺刻度、安全除法等，供 Timeline / Player 复用
 */

/**
 * 将秒数格式化为 MM:SS（不足 1 小时时使用，与原型稿时间码风格一致）
 */
export function formatTimeMmSs(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00"
  const s = Math.floor(totalSeconds)
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

/**
 * 将秒数格式化为 HH:MM:SS（时间轴标尺用，与原型 00:00:00 一致）
 */
export function formatTimeHhMmSs(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00:00"
  const s = Math.floor(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

/**
 * 根据总时长生成标尺刻度点（秒），避免刻度过密
 */
export function buildRulerTicks(totalSec: number): number[] {
  const t = Math.max(0, totalSec)
  if (t <= 0) return [0]
  const step =
    t <= 30 ? 5 : t <= 90 ? 10 : t <= 300 ? 15 : t <= 600 ? 30 : 60
  const ticks: number[] = [0]
  for (let x = step; x <= t + 0.001; x += step) {
    ticks.push(Math.min(x, t))
  }
  if (ticks[ticks.length - 1]! < t) ticks.push(t)
  return ticks
}

/**
 * 镜头用于布局的时长（秒）：至少 1s，避免宽度为 0
 */
export function layoutDurationSec(shotDuration: number | undefined): number {
  const d = typeof shotDuration === "number" && shotDuration > 0 ? shotDuration : 1
  return d
}
