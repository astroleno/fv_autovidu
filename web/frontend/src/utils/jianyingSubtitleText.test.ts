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

function buildShot(over: Partial<Shot>): Shot {
  return {
    shotId: "s",
    shotNumber: 1,
    imagePrompt: "",
    videoPrompt: "",
    firstFrame: "",
    assets: [],
    status: "pending",
    endFrame: null,
    videoCandidates: [],
    ...over,
  }
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
    const shot = buildShot({
      dialogue_translation: "译",
    } as Shot)
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
