import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"

const episodeSlice = {
  currentEpisode: {
    projectId: "proj-1",
    episodeId: "ep-1",
    episodeTitle: "单元测试集",
    episodeNumber: 1,
    pulledAt: "2026-03-30T00:00:00Z",
    scenes: [
      {
        sceneId: "sc-1",
        sceneNumber: 1,
        title: "场景 1",
        shots: [
          {
            shotId: "shot-a",
            shotNumber: 1,
            imagePrompt: "img-a",
            videoPrompt: "video-a",
            duration: 5,
            cameraMovement: "push_in",
            aspectRatio: "9:16",
            firstFrame: "frames/a.png",
            endFrame: null,
            assets: [],
            status: "video_done" as const,
            videoCandidates: [
              {
                id: "cand-a",
                videoPath: "videos/a.mp4",
                thumbnailPath: "",
                seed: 1,
                model: "m",
                mode: "first_frame" as const,
                selected: false,
                createdAt: "",
                taskId: "task-a",
                taskStatus: "success" as const,
              },
            ],
          },
          {
            shotId: "shot-b",
            shotNumber: 2,
            imagePrompt: "img-b",
            videoPrompt: "video-b",
            duration: 6,
            cameraMovement: "pan_left",
            aspectRatio: "9:16",
            firstFrame: "frames/b.png",
            endFrame: null,
            assets: [],
            status: "video_done" as const,
            videoCandidates: [
              {
                id: "cand-b",
                videoPath: "videos/b.mp4",
                thumbnailPath: "",
                seed: 2,
                model: "m",
                mode: "first_frame" as const,
                selected: false,
                createdAt: "",
                taskId: "task-b",
                taskStatus: "success" as const,
              },
            ],
          },
        ],
      },
    ],
  },
  loading: false,
  error: null as string | null,
  fetchEpisodeDetail: vi.fn(),
}

vi.mock("@/hooks", () => ({
  useEpisodeMediaCacheBust: () => "cache-1",
}))

vi.mock("@/hooks/useEpisodeFileBasePath", () => ({
  useEpisodeFileBasePath: () => "",
}))

vi.mock("@/components/ui", () => ({
  Skeleton: () => null,
}))

vi.mock("@/components/business", async () => {
  const { useVideoPickStore } =
    await vi.importActual<typeof import("@/stores")>("@/stores")
  return {
    SceneGroup: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    VideoPickCard: () => <div data-testid="videopick-card-mock">card</div>,
    VideoPickModeToggle: () => <div data-testid="mode-toggle-mock">mode</div>,
    VideoPickFocusPanel: ({
      filteredShots,
    }: {
      filteredShots: Array<{ shotId: string }>
    }) => {
      const index = useVideoPickStore.getState().currentShotIndex
      return <div data-testid="focus-shot">{filteredShots[index]?.shotId ?? "none"}</div>
    },
  }
})

vi.mock("@/stores", async () => {
  const actual = await vi.importActual<typeof import("@/stores")>("@/stores")
  return {
    ...actual,
    useEpisodeStore: () => episodeSlice,
  }
})

import { useVideoPickStore } from "@/stores"
import VideoPickPage from "./VideoPickPage"

describe("VideoPickPage", () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    useVideoPickStore.setState({
      mode: "overview",
      currentShotIndex: 0,
      activeCandidateId: null,
      pickingOnlyPending: false,
      undoStack: [],
    })
  })

  it("保留 shotId 深链定位，不会在切集 reset 后回到第一个镜头", async () => {
    render(
      <MemoryRouter
        initialEntries={["/project/proj-1/episode/ep-1/pick?shotId=shot-b"]}
      >
        <Routes>
          <Route
            path="/project/:projectId/episode/:episodeId/pick"
            element={<VideoPickPage />}
          />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByTestId("focus-shot")).toHaveTextContent("shot-b")
    expect(useVideoPickStore.getState().currentShotIndex).toBe(1)
  })
})
