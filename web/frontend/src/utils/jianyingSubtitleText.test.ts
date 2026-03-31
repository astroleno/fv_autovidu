import { describe, it, expect } from "vitest"
import type { Shot } from "@/types"
import {
  estimateSubtitleLineCount,
  formatSubtitlePreviewOneLine,
  JIANYING_SPEC_FONT_SIZE,
  JIANYING_SPEC_MAX_LINES,
  jianyingSpecLineCount,
  jianyingSpecYAndTransformPreview,
  subtitlePreviewSourceHint,
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
  it("无台词时使用画面描述并可含换行", () => {
    const shot = buildShot({
      visualDescription: "行一\n行二",
    })
    expect(subtitleTextFromShot(shot)).toBe("行一\n行二")
    expect(subtitlePreviewSourceHint(shot)).toBe("来源：画面描述")
  })

  it("接受 dialogue_translation 蛇形键（兼容旧 JSON）", () => {
    const shot = buildShot({
      dialogue_translation: "译",
    } as Shot)
    expect(subtitleTextFromShot(shot)).toBe("译")
    expect(subtitlePreviewSourceHint(shot)).toBeNull()
  })
})

describe("formatSubtitlePreviewOneLine", () => {
  it("将换行显示为斜杠分隔", () => {
    expect(formatSubtitlePreviewOneLine("a\nb", 80)).toBe("a / b")
  })
})

describe("estimateSubtitleLineCount", () => {
  it("按换行计数，至少为 1", () => {
    expect(estimateSubtitleLineCount("a")).toBe(1)
    expect(estimateSubtitleLineCount("a\nb")).toBe(2)
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
  it("1080p 竖屏 H=1920 时 n=1 对应 Y=-500、transform=-500/960", () => {
    const p = jianyingSpecYAndTransformPreview(1, "1080p")
    expect(p.yPixel).toBe(-500)
    expect(p.transformY).toBeCloseTo(-500 / 960, 6)
  })

  it("n>3 时按 n=3 计算（与五段换行 capped 一致）", () => {
    const p3 = jianyingSpecYAndTransformPreview(3, "1080p")
    const p5 = jianyingSpecYAndTransformPreview(5, "1080p")
    expect(p5.yPixel).toBe(-700)
    expect(p5.transformY).toBeCloseTo(p3.transformY, 6)
  })
})
