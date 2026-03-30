/**
 * 后期制作页：验证 ?shotId= 深链传入 DubPanel（与选片入口闭环）
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"

const highlightRef = { current: undefined as string | undefined }

vi.mock("@/components/business/DubPanel", () => ({
  DubPanel: (props: { episodeId: string; initialHighlightShotId?: string }) => {
    highlightRef.current = props.initialHighlightShotId
    return <div data-testid="dub-panel-mock">dub</div>
  },
}))

vi.mock("@/components/business/JianyingExportDialog", () => ({
  JianyingExportDialog: () => null,
  LS_JIANYING_DRAFT_PATH: "fv_jianying_draft_path",
}))

vi.mock("@/stores", () => {
  const mockEpisode = {
    projectId: "proj-1",
    episodeId: "ep-1",
    episodeTitle: "单元测试集",
    episodeNumber: 1,
    pulledAt: "2026-03-30T00:00:00Z",
    dubDefaultVoiceId: "voice-default",
    scenes: [
      {
        sceneId: "sc-1",
        sceneNumber: 1,
        title: "S1",
        shots: [
          {
            shotId: "shot-deep",
            shotNumber: 1,
            imagePrompt: "img",
            videoPrompt: "vp",
            duration: 5,
            cameraMovement: "push_in",
            aspectRatio: "9:16",
            firstFrame: "frames/f.png",
            assets: [],
            status: "selected" as const,
            endFrame: null,
            videoCandidates: [
              {
                id: "c1",
                videoPath: "videos/v.mp4",
                thumbnailPath: "",
                seed: 0,
                model: "m",
                mode: "first_frame" as const,
                selected: true,
                createdAt: "",
                taskId: "t",
                taskStatus: "success" as const,
              },
            ],
          },
        ],
      },
    ],
  }
  const episodeSlice = {
    episodes: [],
    currentEpisode: mockEpisode,
    loading: false,
    error: null as string | null,
    localMediaEpoch: 0,
    fetchEpisodeDetail: vi.fn(),
    fetchEpisodes: vi.fn(),
    refreshEpisode: vi.fn(),
    bumpLocalMediaCache: vi.fn(),
    pullNewEpisode: vi.fn(),
    updateShot: vi.fn(),
    updateEpisodeLocales: vi.fn(),
  }
  return {
    /** PostProductionPage 使用无参 `useEpisodeStore()` 解构整表，须支持 selector 可选 */
    useEpisodeStore: (sel?: (s: typeof episodeSlice) => unknown) =>
      sel ? sel(episodeSlice) : episodeSlice,
    useToastStore: (sel: (s: { push: () => void }) => unknown) =>
      sel({ push: vi.fn() }),
  }
})

import PostProductionPage from "./PostProductionPage"

afterEach(() => {
  cleanup()
  highlightRef.current = undefined
})

describe("PostProductionPage", () => {
  it("从 URL 读取 shotId 并传给 DubPanel.initialHighlightShotId", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/project/proj-1/episode/ep-1/post-production?shotId=shot-deep",
        ]}
      >
        <Routes>
          <Route
            path="/project/:projectId/episode/:episodeId/post-production"
            element={<PostProductionPage />}
          />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByTestId("dub-panel-mock")).toBeInTheDocument()
    expect(highlightRef.current).toBe("shot-deep")
  })
})
