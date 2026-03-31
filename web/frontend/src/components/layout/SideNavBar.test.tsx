/**
 * 剧集上下文侧栏：链接顺序与路由生成一致。
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { SideNavBar } from "./SideNavBar"

describe("SideNavBar", () => {
  it("剧集子导航顺序：资产库 → 分镜板 → 选片总览 → 后期制作 → 粗剪预览", () => {
    render(
      <MemoryRouter initialEntries={["/project/proj-a/episode/ep-1/timeline"]}>
        <Routes>
          <Route
            path="/project/:projectId/episode/:episodeId/*"
            element={<SideNavBar collapsed={false} onToggle={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    )

    const nav = screen.getByRole("navigation", { name: "剧集导航" })
    const links = nav.querySelectorAll("a[href]")
    const paths = Array.from(links).map(
      (a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""
    )

    expect(paths).toEqual([
      "/project/proj-a/episode/ep-1/assets",
      "/project/proj-a/episode/ep-1",
      "/project/proj-a/episode/ep-1/pick",
      "/project/proj-a/episode/ep-1/post-production",
      "/project/proj-a/episode/ep-1/timeline",
    ])
  })
})
