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
 * 从镜头得到剪映字幕用正文（与 `jianying_text_track.subtitle_text_from_shot` 一致）。

 * **不包含** `visualDescription`：画面描述不是台词，不得用于字幕与行数。
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

  return ""
}

/** 与后端 `_JIANYING_SPEC_WORDS_PER_LINE` 一致：约 6～8 词/行取中 */
const WORDS_PER_LINE = 7

function countLatinWords(s: string): number {
  const m = s.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)
  return m ? m.length : 0
}

function countCjkChars(s: string): number {
  const m = s.match(/[\u4e00-\u9fff]/g)
  return m ? m.length : 0
}

/**
 * 单行正文在剪映内自动折行时的估算行数（无 `\\n` 时）。
 * 英文按词数；汉字按「每字约半词宽」与 7 词/行对齐。
 */
function wrapLinesEstimateSingleBlock(text: string): number {
  const t = text.trim()
  if (!t) return 1
  const words = countLatinWords(t)
  const cjk = countCjkChars(t)
  const equiv = words + 0.5 * cjk
  if (equiv <= 0) return Math.max(1, Math.ceil(t.length / 40))
  return Math.max(1, Math.ceil(equiv / WORDS_PER_LINE))
}

/**
 * 规范用「行数」估算（不含 3 行上限，供预览表「换行分段数」列）。
 * 多行显式换行时按行数；否则按词/字宽估算自动折行行数。
 */
export function estimateSubtitleLineCount(text: string): number {
  const lines = text.split(/\r?\n/).filter((ln) => ln.trim())
  if (lines.length > 1) return Math.max(1, lines.length)
  const block = lines.length === 1 ? lines[0]! : text.trim()
  return wrapLinesEstimateSingleBlock(block)
}

/** 剪映规范：参与 Y=-100n-400 的行数 n 上限（与后端 `JIANYING_SPEC_MAX_LINES` 一致）。 */
export const JIANYING_SPEC_MAX_LINES = 3

/**
 * 规范版用于纵轴公式的行数 n（1～`JIANYING_SPEC_MAX_LINES`）。
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

/**
 * 将字幕正文压成一行展示（换行显示为「 / 」），便于在表格里看出显式分段。
 */
export function formatSubtitlePreviewOneLine(body: string, maxLen: number): string {
  const s = body.replace(/\r?\n/g, " / ").trim()
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}…`
}
