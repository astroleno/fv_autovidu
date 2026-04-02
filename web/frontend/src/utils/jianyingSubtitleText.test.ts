import { describe, it, expect } from "vitest"
import type { Shot } from "@/types"
import {
  estimateSubtitleLineCount,
  formatSubtitlePreviewOneLine,
  JIANYING_SPEC_FONT_SIZE,
  JIANYING_SPEC_MAX_LINES,
  jianyingSpecLineCount,
  jianyingSpecYAndTransformPreview,
  subtitleTextFromShot,
} from "./jianyingSubtitleText"

/**
 * 构造满足 Shot 必填字段的最小合法对象，便于单测覆盖字幕解析逻辑。
 * 注意：`Partial<Shot>` 与展开合并时，若缺少 duration 等必填项，TS 会报类型错误。
 */
function buildShot(over: Partial<Shot>): Shot {
  const base: Shot = {
    shotId: "s",
    shotNumber: 1,
    imagePrompt: "",
    videoPrompt: "",
    duration: 5,
    cameraMovement: "",
    aspectRatio: "9:16",
    firstFrame: "",
    assets: [],
    status: "pending",
    endFrame: null,
    videoCandidates: [],
  }
  return { ...base, ...over }
}

describe("subtitleTextFromShot", () => {
  it("不使用画面描述", () => {
    const shot = buildShot({
      dialogue: "",
      visualDescription: "深夜客厅沙发……",
    })
    expect(subtitleTextFromShot(shot)).toBe("")
  })

  it("接受 dialogue_translation 蛇形键", () => {
    // 平台/JSON 可能仅带蛇形键；subtitleTextFromShot 内按字符串键读取，此处用断言模拟扩展字段
    const shot = { ...buildShot({}), dialogue_translation: "译" } as Shot
    expect(subtitleTextFromShot(shot)).toBe("译")
  })
})

describe("estimateSubtitleLineCount / 无换行折行估算", () => {
  it("显式多行按行数", () => {
    expect(estimateSubtitleLineCount("a\nb")).toBe(2)
  })

  it("长英文无换行按约 7 词/行估算", () => {
    const text = Array.from({ length: 21 }, (_, i) => `w${i}`).join(" ")
    expect(estimateSubtitleLineCount(text)).toBe(3)
    expect(jianyingSpecLineCount(text)).toBe(3)
  })

  it("长中文无换行按字宽估算并可超过 3（预览列），公式 n 封顶 3", () => {
    const text = "字".repeat(80)
    expect(estimateSubtitleLineCount(text)).toBeGreaterThan(3)
    expect(jianyingSpecLineCount(text)).toBe(3)
  })

  it("无换行中文 13 字时按 CJK/12 估为 2 行（与剪映自动折行更一致）", () => {
    const thirteen = "字".repeat(13)
    expect(estimateSubtitleLineCount(thirteen)).toBe(2)
    expect(jianyingSpecLineCount(thirteen)).toBe(2)
  })
})

describe("formatSubtitlePreviewOneLine", () => {
  it("将换行显示为斜杠分隔", () => {
    expect(formatSubtitlePreviewOneLine("a\nb", 80)).toBe("a / b")
  })
})

describe("JIANYING_SPEC_FONT_SIZE", () => {
  it("与后端规范固定字号一致", () => {
    expect(JIANYING_SPEC_FONT_SIZE).toBe(13)
  })
})

describe("jianyingSpecLineCount", () => {
  it("与换行分段一致且封顶为 JIANYING_SPEC_MAX_LINES", () => {
    expect(JIANYING_SPEC_MAX_LINES).toBe(3)
    expect(jianyingSpecLineCount("a")).toBe(1)
    expect(jianyingSpecLineCount("a\nb\nc")).toBe(3)
    expect(jianyingSpecLineCount("a\nb\nc\nd\ne")).toBe(3)
  })
})

describe("jianyingSpecYAndTransformPreview", () => {
  it("1080p 竖屏 H=1920 时 n=1 对应 Y=-500、transform=-500/1920（与界面读数一致）", () => {
    const p = jianyingSpecYAndTransformPreview(1, "1080p")
    expect(p.yPixel).toBe(-500)
    expect(p.transformY).toBeCloseTo(-500 / 1920, 6)
  })

  it("n>3 时按 n=3 计算（与五段换行 capped 一致）", () => {
    const p3 = jianyingSpecYAndTransformPreview(3, "1080p")
    const p5 = jianyingSpecYAndTransformPreview(5, "1080p")
    expect(p5.yPixel).toBe(-700)
    expect(p5.transformY).toBeCloseTo(p3.transformY, 6)
  })
})
