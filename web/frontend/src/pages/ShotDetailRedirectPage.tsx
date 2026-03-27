/**
 * ShotDetailRedirectPage — 旧「镜头详情」路由的兼容壳
 *
 * 历史路径 `/project/:projectId/episode/:episodeId/shot/:shotId` 曾对应独立 ShotDetailPage。
 * 收口后单镜头工作台统一为选片 picking 模式，本页仅做 **replace 跳转** 到带 `shotId` 查询参数的选片页，
 * 由 VideoPickPage 消费参数、定位镜头并清除 URL 查询串。
 */
import { useEffect } from "react"
import { useNavigate, useParams } from "react-router"
import { routes } from "@/utils/routes"

export default function ShotDetailRedirectPage() {
  const navigate = useNavigate()
  const { projectId = "", episodeId = "", shotId = "" } = useParams()

  useEffect(() => {
    if (!projectId || !episodeId || !shotId) return
    navigate(routes.videopickShot(projectId, episodeId, shotId), {
      replace: true,
    })
  }, [episodeId, navigate, projectId, shotId])

  return (
    <div
      className="p-8 text-sm text-[var(--color-muted)] box-border"
      style={{ boxSizing: "border-box" }}
    >
      正在进入选片工作台…
    </div>
  )
}
