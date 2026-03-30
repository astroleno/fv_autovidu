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
        /** 第二镜：带候选，供选片页 / E2E 深链 ?shotId=shot-002 定位 */
        {
          shotId: "shot-002",
          shotNumber: 2,
          visualDescription: "室内对峙。",
          imagePrompt: "中景室内",
          videoPrompt: "固定",
          duration: 6,
          cameraMovement: "static",
          aspectRatio: "9:16",
          firstFrame: "frames/S02.png",
          assets: [],
          status: "video_done" as const,
          endFrame: null,
          videoCandidates: [
            {
              id: "cand-e2e-1",
              videoPath: "videos/S02/v1.mp4",
              thumbnailPath: "",
              seed: 1,
              model: "m",
              mode: "first_frame" as const,
              selected: false,
              createdAt: "2026-03-20T12:00:00Z",
              taskId: "task-e2e-1",
              taskStatus: "success" as const,
            },
          ],
        },
      ],
    },
  ],
}

const mockProjectSummary = {
  projectId: "proj-demo",
  title: "演示项目",
  description: "MSW 模拟",
  coverImage: null as string | null,
  episodeCount: 1,
  pulledEpisodeCount: 1,
  createdAt: "2026-03-20T12:00:00Z",
  updatedAt: "2026-03-23T08:00:00Z",
}

const mockProjectEpisodes = {
  project: { projectId: "proj-demo", title: "演示项目" },
  episodes: [
    {
      episodeId: "ep-001",
      title: "第2集",
      episodeNumber: 2,
      source: "remote_and_local" as const,
      pulledLocally: true,
      localProjectId: "proj-demo",
      pulledAt: "2026-03-19T10:00:00Z",
    },
  ],
}

export const handlers = [
  http.get("/api/episodes", () => HttpResponse.json([mockEpisode])),
  http.get("/api/episodes/:id", () => HttpResponse.json(mockEpisode)),
  http.post("/api/episodes/pull", () => HttpResponse.json(mockEpisode)),
  http.get("/api/projects", () => HttpResponse.json([mockProjectSummary])),
  http.get("/api/projects/:projectId", () => HttpResponse.json(mockProjectSummary)),
  http.get("/api/projects/:projectId/episodes", () =>
    HttpResponse.json(mockProjectEpisodes)
  ),
  http.post("/api/projects/:projectId/pull-all", () =>
    HttpResponse.json({
      projectId: "proj-demo",
      requested: 1,
      successCount: 1,
      failedCount: 0,
      failedEpisodes: [],
    })
  ),
]
