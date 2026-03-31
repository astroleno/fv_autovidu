/**
 * 剧集子路由面包屑文案：与 AppLayout 顶栏最后一级一致。
 */
import { describe, it, expect } from "vitest"
import { getEpisodeSubpageLabel } from "./episodeRouteLabels"

describe("getEpisodeSubpageLabel", () => {
  it("strip 查询串与尾部斜杠后再判断", () => {
    expect(getEpisodeSubpageLabel("/project/a/episode/b/post-production?tab=jianying")).toBe(
      "后期制作"
    )
    expect(getEpisodeSubpageLabel("/project/a/episode/b/pick/")).toBe("选片总览")
  })

  it("后期制作 / 选片 / 粗剪 / 资产库", () => {
    expect(getEpisodeSubpageLabel("/project/p/episode/e/post-production")).toBe("后期制作")
    expect(getEpisodeSubpageLabel("/project/p/episode/e/pick")).toBe("选片总览")
    expect(getEpisodeSubpageLabel("/project/p/episode/e/timeline")).toBe("粗剪预览")
    expect(getEpisodeSubpageLabel("/project/p/episode/e/assets")).toBe("资产库")
  })

  it("分镜板根路径（仅 project/episode 两段后无子路径）", () => {
    expect(getEpisodeSubpageLabel("/project/p/episode/ep-1")).toBe("分镜板")
  })

  it("镜头与单帧重生（regen 优先于普通镜头）", () => {
    expect(getEpisodeSubpageLabel("/project/p/episode/e/shot/s1")).toBe("镜头")
    expect(getEpisodeSubpageLabel("/project/p/episode/e/shot/s1/regen")).toBe("单帧重生")
  })

  it("无匹配子页时返回空串", () => {
    expect(getEpisodeSubpageLabel("/project/p")).toBe("")
  })
})
