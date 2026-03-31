/**
 * 字幕纵向位置示意：纯数学，与剪映客户端像素可能略有偏差，仅作 UI 提示。
 */
import { describe, it, expect } from "vitest"
import { clampTransformY, transformYToPreviewBottomPercent } from "./subtitlePreviewLayout"

describe("clampTransformY", () => {
  it("钳制到 -1～0", () => {
    expect(clampTransformY(-1)).toBe(-1)
    expect(clampTransformY(0)).toBe(0)
    expect(clampTransformY(-0.8)).toBe(-0.8)
    expect(clampTransformY(-2)).toBe(-1)
    expect(clampTransformY(0.5)).toBe(0)
  })
})

describe("transformYToPreviewBottomPercent", () => {
  it("-1 靠近底边，0 明显上移（距底百分比变大）", () => {
    const bottomAtMin = transformYToPreviewBottomPercent(-1)
    const bottomAtMax = transformYToPreviewBottomPercent(0)
    expect(bottomAtMin).toBeLessThan(bottomAtMax)
    expect(bottomAtMin).toBeGreaterThan(0)
    expect(bottomAtMax).toBeLessThan(90)
  })
})
