import { describe, it, expect } from "vitest"
import {
  estimateSubtitleLineCount,
  JIANYING_SPEC_FONT_SIZE,
  jianyingSpecYAndTransformPreview,
} from "./jianyingSubtitleText"

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

describe("jianyingSpecYAndTransformPreview", () => {
  it("1080p 竖屏 H=1920 时 n=1 对应 Y=-500、transform=-500/960", () => {
    const p = jianyingSpecYAndTransformPreview(1, "1080p")
    expect(p.yPixel).toBe(-500)
    expect(p.transformY).toBeCloseTo(-500 / 960, 6)
  })
})
