import { describe, it, expect } from "vitest"
import {
  estimateSubtitleLineCount,
  jianyingSpecFontSize,
  jianyingSpecYAndTransformPreview,
} from "./jianyingSubtitleText"

describe("estimateSubtitleLineCount", () => {
  it("按换行计数，至少为 1", () => {
    expect(estimateSubtitleLineCount("a")).toBe(1)
    expect(estimateSubtitleLineCount("a\nb")).toBe(2)
  })
})

describe("jianyingSpecFontSize", () => {
  it("n=1→16，n=2→14，下限 4", () => {
    expect(jianyingSpecFontSize(1)).toBe(16)
    expect(jianyingSpecFontSize(2)).toBe(14)
    expect(jianyingSpecFontSize(99)).toBe(4)
  })
})

describe("jianyingSpecYAndTransformPreview", () => {
  it("1080p 竖屏 H=1920 时 n=1 对应 Y=-500、transform=-500/960", () => {
    const p = jianyingSpecYAndTransformPreview(1, "1080p")
    expect(p.yPixel).toBe(-500)
    expect(p.transformY).toBeCloseTo(-500 / 960, 6)
  })
})
