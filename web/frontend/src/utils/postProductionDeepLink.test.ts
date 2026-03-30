/**
 * 后期制作深链 URL 与选片页共用逻辑
 */
import { describe, it, expect } from "vitest"
import { postProductionHrefWithShot } from "./postProductionDeepLink"

describe("postProductionHrefWithShot", () => {
  it("无 shotId 时等于 routes.post-production 路径", () => {
    expect(postProductionHrefWithShot("proj", "ep1")).toBe(
      "/project/proj/episode/ep1/post-production"
    )
  })

  it("有 shotId 时附加编码后的查询参数", () => {
    expect(postProductionHrefWithShot("p", "e", "shot-abc")).toBe(
      "/project/p/episode/e/post-production?shotId=shot-abc"
    )
  })

  it("空白 shotId 视为无", () => {
    expect(postProductionHrefWithShot("p", "e", "   ")).toBe(
      "/project/p/episode/e/post-production"
    )
  })
})
