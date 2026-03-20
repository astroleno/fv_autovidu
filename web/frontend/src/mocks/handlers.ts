/**
 * MSW Mock API handlers
 * 后台未就绪时拦截 /api/* 返回模拟数据
 */
import { http, HttpResponse } from "msw"

const mockEpisode = {
  projectId: "proj-demo",
  episodeId: "ep-001",
  episodeTitle: "第2集",
  episodeNumber: 2,
  pulledAt: "2026-03-19T10:00:00Z",
  scenes: [
    {
      sceneId: "scene-001",
      sceneNumber: 1,
      title: "废弃仓库外",
      shots: [
        {
          shotId: "shot-001",
          shotNumber: 1,
          visualDescription: "仓库外黄昏，达里尔背影面向铁门。",
          imagePrompt: "中景，达里尔站在废弃仓库门口...",
          videoPrompt: "镜头缓慢推进...",
          duration: 5,
          cameraMovement: "push_in",
          aspectRatio: "9:16",
          firstFrame: "frames/S01.png",
          assets: [
            { assetId: "a1", name: "达里尔", type: "character" as const, localPath: "assets/达里尔.png", prompt: "" },
          ],
          status: "pending" as const,
          endFrame: null,
          videoCandidates: [],
        },
      ],
    },
  ],
}

export const handlers = [
  http.get("/api/episodes", () => HttpResponse.json([mockEpisode])),
  http.get("/api/episodes/:id", () => HttpResponse.json(mockEpisode)),
  http.post("/api/episodes/pull", () => HttpResponse.json(mockEpisode)),
]
