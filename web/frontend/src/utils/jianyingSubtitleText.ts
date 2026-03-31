/**
 * 与后端 `jianying_text_track.subtitle_text_from_shot` / 规范版行数、字号规则对齐，
 * 供后期制作页「应用剪映规范」预览表使用（非导出逻辑本身）。
 */
import type { Shot } from "@/types"

/**
 * 从 Shot 上按多个候选键取第一条非空字符串（兼容 camelCase / snake_case / 平台 Dialogue）。
 */
function pickShotString(shot: Shot, keys: string[]): string {
  const ext = shot as Shot & Record<string, unknown>
  for (const k of keys) {
    const v = ext[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

/**
 * 从镜头得到剪映字幕用正文（与 `jianying_text_track.subtitle_text_from_shot` 优先级一致）。
 *
 * 顺序：译文 → 原文台词 → 结构化对白 → **画面描述**（许多项目仅在 visualDescription 有文案）。
 */
export function subtitleTextFromShot(shot: Shot): string {
  const translated = pickShotString(shot, [
    "dialogueTranslation",
    "dialogue_translation",
  ])
  if (translated) return translated
  const line = pickShotString(shot, ["dialogue", "Dialogue"])
  if (line) return line

  const ad = shot.associatedDialogue
  if (ad) {
    const role = (ad.role ?? "").trim()
    const content = (ad.content ?? "").trim()
    if (role && content) return `${role}：${content}`
    if (content) return content
  }

  const vis = pickShotString(shot, ["visualDescription", "visual_description"])
  if (vis) return vis

  return ""
}

/**
 * 若当前字幕正文仅来自 `visualDescription`（无译文/台词/结构化对白），返回提示文案，否则返回 null。
 * 供预览表标注来源，避免误以为「台词列为空」却仍有行数。
 */
export function subtitlePreviewSourceHint(shot: Shot): string | null {
  if (!subtitleTextFromShot(shot).trim()) return null
  if (pickShotString(shot, ["dialogueTranslation", "dialogue_translation"])) return null
  if (pickShotString(shot, ["dialogue", "Dialogue"])) return null
  const ad = shot.associatedDialogue
  if (ad) {
    const role = (ad.role ?? "").trim()
    const content = (ad.content ?? "").trim()
    if (role && content) return null
    if (content) return null
  }
  if (pickShotString(shot, ["visualDescription", "visual_description"])) {
    return "来源：画面描述"
  }
  return null
}

/**
 * 将字幕正文压成一行展示（换行显示为「 / 」），便于在表格里看出多行分段。
 */
export function formatSubtitlePreviewOneLine(body: string, maxLen: number): string {
  const s = body.replace(/\r?\n/g, " / ").trim()
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}…`
}

/**
 * 按换行分段统计「原始」行数（忽略空行），至少为 1；**不含上限**。
 * 规范版公式用 `jianyingSpecLineCount`（n≤3）。
 */
export function estimateSubtitleLineCount(text: string): number {
  const lines = text.split(/\r?\n/).filter((ln) => ln.trim())
  return Math.max(1, lines.length)
}

/** 剪映规范：参与 Y=-100n-400 的行数 n 上限（与后端 `JIANYING_SPEC_MAX_LINES` 一致）。 */
export const JIANYING_SPEC_MAX_LINES = 3

/**
 * 规范版用于纵轴公式的行数 n（1～`JIANYING_SPEC_MAX_LINES`）。
 *
 * 规则：按 `\\n` / `\\r\\n` 拆行，忽略空行；非空行数至少为 1；再 `min(行数, JIANYING_SPEC_MAX_LINES)`。
 * 无换行符的长句（仅靠剪映自动折行）在此视为 1 行。
 */
export function jianyingSpecLineCount(text: string): number {
  const raw = estimateSubtitleLineCount(text)
  return Math.min(raw, JIANYING_SPEC_MAX_LINES)
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
  const nn = Math.min(
    JIANYING_SPEC_MAX_LINES,
    Math.max(1, Math.floor(n)),
  )
  const yPixel = -100 * nn - 400
  const h = canvasHeightVertical(canvasSize)
  const half = h / 2
  return { yPixel, transformY: half > 0 ? yPixel / half : -0.8 }
}
