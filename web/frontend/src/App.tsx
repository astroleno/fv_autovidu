/**
 * FV Studio 应用入口
 * React Router v7 路由配置：6 个页面 + AppLayout
 */
import { createBrowserRouter, RouterProvider } from "react-router"
import AppLayout from "@/components/layout/AppLayout"
import EpisodeListPage from "@/pages/EpisodeListPage"
import StoryboardPage from "@/pages/StoryboardPage"
import AssetLibraryPage from "@/pages/AssetLibraryPage"
import ShotDetailPage from "@/pages/ShotDetailPage"
import RegenPage from "@/pages/RegenPage"
import TimelinePage from "@/pages/TimelinePage"
import SettingsPage from "@/pages/SettingsPage"

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <EpisodeListPage /> },
      { path: "episode/:episodeId", element: <StoryboardPage /> },
      { path: "episode/:episodeId/assets", element: <AssetLibraryPage /> },
      { path: "episode/:episodeId/shot/:shotId", element: <ShotDetailPage /> },
      { path: "episode/:episodeId/shot/:shotId/regen", element: <RegenPage /> },
      { path: "episode/:episodeId/timeline", element: <TimelinePage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
