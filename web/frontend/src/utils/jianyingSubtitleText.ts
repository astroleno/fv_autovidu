/**
 * 与后端 `jianying_text_track.subtitle_text_from_shot` / 规范版行数、字号规则对齐，
 * 供后期制作页「应用剪映规范」预览表使用（非导出逻辑本身）。
 */
import type { Shot } from "@/types"

/**
 * 从镜头得到剪映字幕用正文（与 Python 优先级一致）。
 */
export function subtitleTextFromShot(shot: Shot): string {
  const translated = (shot.dialogueTranslation ?? "").trim()
  if (translated) return translated
  const line = (shot.dialogue ?? "").trim()
  if (line) return line
  const ad = shot.associatedDialogue
  if (!ad) return ""
  const role = (ad.role ?? "").trim()
  const content = (ad.content ?? "").trim()
  if (!role && !content) return ""
  if (role && content) return `${role}：${content}`
  return content
}

/**
 * 按换行分段统计行数 n（忽略空行），至少为 1。
 */
export function estimateSubtitleLineCount(text: string): number {
  const lines = text.split(/\r?\n/).filter((ln) => ln.trim())
  return Math.max(1, lines.length)
}

/** 剪映规范模式：与后端 `JIANYING_SPEC_FONT_SIZE` 一致，固定字号。 */
export const JIANYING_SPEC_FONT_SIZE = 13


/** 竖屏画布高度（与 jianying_protocol.canvas_wh_vertical_9_16 一致） */
export function canvasHeightVertical(canvasSize: "720p" | "1080p"): number {
  return canvasSize === "1080p" ? 1920 : 1280
}

/**
 * 规范版像素 Y 与 transform_y（半画布高单位）示意，用于预览表。
 */
export function jianyingSpecYAndTransformPreview(
  n: number,
  canvasSize: "720p" | "1080p",
): { yPixel: number; transformY: number } {
  const nn = Math.max(1, Math.floor(n))
  const yPixel = -100 * nn - 400
  const h = canvasHeightVertical(canvasSize)
  const half = h / 2
  return { yPixel, transformY: half > 0 ? yPixel / half : -0.8 }
}
