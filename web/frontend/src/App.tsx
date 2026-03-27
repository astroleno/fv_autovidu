/**
 * FV Studio 应用入口
 * React Router v7：项目 → 剧集 → 分镜 三级路由；保留 /episode/:id/* 兼容重定向
 */
import { createBrowserRouter, RouterProvider } from "react-router"
import AppLayout from "@/components/layout/AppLayout"
import ProjectListPage from "@/pages/ProjectListPage"
import ProjectDetailPage from "@/pages/ProjectDetailPage"
import EpisodeListPage from "@/pages/EpisodeListPage"
import StoryboardPage from "@/pages/StoryboardPage"
import AssetLibraryPage from "@/pages/AssetLibraryPage"
import ShotDetailRedirectPage from "@/pages/ShotDetailRedirectPage"
import RegenPage from "@/pages/RegenPage"
import TimelinePage from "@/pages/TimelinePage"
import VideoPickPage from "@/pages/VideoPickPage"
import PostProductionPage from "@/pages/PostProductionPage"
import SettingsPage from "@/pages/SettingsPage"
import LegacyEpisodeRedirect from "@/pages/LegacyEpisodeRedirect"

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <ProjectListPage /> },
      { path: "local-episodes", element: <EpisodeListPage /> },
      { path: "project/:projectId", element: <ProjectDetailPage /> },
      {
        path: "project/:projectId/episode/:episodeId",
        element: <StoryboardPage />,
      },
      {
        path: "project/:projectId/episode/:episodeId/assets",
        element: <AssetLibraryPage />,
      },
      {
        path: "project/:projectId/episode/:episodeId/shot/:shotId",
        element: <ShotDetailRedirectPage />,
      },
      {
        path: "project/:projectId/episode/:episodeId/shot/:shotId/regen",
        element: <RegenPage />,
      },
      {
        path: "project/:projectId/episode/:episodeId/timeline",
        element: <TimelinePage />,
      },
      {
        path: "project/:projectId/episode/:episodeId/pick",
        element: <VideoPickPage />,
      },
      {
        path: "project/:projectId/episode/:episodeId/post-production",
        element: <PostProductionPage />,
      },
      { path: "settings", element: <SettingsPage /> },
      /** 旧书签 /episode/:id 及子路径 → 重定向到新 URL（无子路径与有子路径各一条） */
      { path: "episode/:episodeId", element: <LegacyEpisodeRedirect /> },
      { path: "episode/:episodeId/*", element: <LegacyEpisodeRedirect /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
