/**
 * 镜头画幅（aspectRatio）解析与归类
 *
 * 一集内可能同时存在多组比例（竖屏 / 横屏 / 方屏 / 超宽等），用于：
 * - VideoPlayer：按类别选不同的可视区域 class，避免 9:16、1:1、21:9 混用一套 16:9 盒子
 * - VideoPickPage：按「约化比例」分桶统计，多组时提供比例筛选（同一分辨率如 1080×1920 与 9:16 合并为一组）
 */

/** 三类布局：竖屏、横屏、接近 1:1 的方屏；超宽仍归 landscape，由 isUltrawide 单独加固栏高度 */
export type AspectKind = "portrait" | "landscape" | "square"

const RATIO_EPS = 0.07 /** |w/h - 1| < 此阈值视为方屏 */

/**
 * 最大公约数，用于将 1080×1920 约化为 9:16 等整数比展示与分桶
 */
function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

/**
 * 把像素尺寸或比例约成最简整数比（仅用于分组 key 与筛选标签）
 */
export function simplifyRatio(w: number, h: number): [number, number] {
  if (!(w > 0) || !(h > 0)) return [16, 9]
  const g = gcd(w, h)
  return [w / g, h / g]
}

/**
 * 从 episode 字段解析为 [宽, 高] 正数；无法解析时返回 null。
 * 支持：`9:16`、`9/16`、`1080x1920`、`1080×1920`（单位按宽×高）
 */
export function parseAspectDimensions(
  aspect: string | undefined
): [number, number] | null {
  if (aspect == null || !String(aspect).trim()) return null
  const raw = String(aspect).trim().toLowerCase().replace(/\s/g, "")
  const colon = raw.match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/)
  if (colon) {
    const w = Number(colon[1])
    const h = Number(colon[2])
    if (w > 0 && h > 0) return [w, h]
  }
  const xy = raw.replace("×", "x").match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i)
  if (xy) {
    const w = Number(xy[1])
    const h = Number(xy[2])
    if (w > 0 && h > 0) return [w, h]
  }
  return null
}

/**
 * 用于选片页多组比例：**同一物理比例**合并（如 1080×1920 与 9:16 → `9:16` key）。
 * 无法解析时用原文字符串，空则用「未标注」。
 */
export function aspectRatioGroupKey(aspect: string | undefined): string {
  const parsed = parseAspectDimensions(aspect)
  if (parsed) {
    const [sw, sh] = simplifyRatio(parsed[0], parsed[1])
    return `${sw}:${sh}`
  }
  const t = (aspect ?? "").trim()
  return t || "未标注"
}

/**
 * 播放区域布局：竖 / 横 / 方 / 超宽横屏
 */
export function classifyAspectRatio(aspect: string | undefined): AspectKind {
  const parsed = parseAspectDimensions(aspect)
  if (parsed) {
    const [w, h] = parsed
    const r = w / h
    if (Math.abs(r - 1) < RATIO_EPS) return "square"
    if (r < 1) return "portrait"
    return "landscape"
  }
  const s = (aspect ?? "16:9")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "")
    .replace("×", ":")
  if (
    s.includes("9:16") ||
    s === "9/16" ||
    s.includes("3:4") ||
    s.includes("4:5") ||
    s.includes("2:3")
  ) {
    return "portrait"
  }
  if (s.includes("1:1") || s === "1/1") return "square"
  return "landscape"
}

/**
 * 典型电影超宽 2.35:1～2.4:1：用更长条区域，减少上下黑边浪费
 */
export function isUltrawideLandscape(aspect: string | undefined): boolean {
  const parsed = parseAspectDimensions(aspect)
  if (!parsed) return false
  const [w, h] = parsed
  return w / h >= 1.78 /** 约 16:9 以上视为可考虑 ultrawide；21:9≈2.33 */
}
