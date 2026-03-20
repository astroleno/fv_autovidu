/**
 * AppLayout 主布局容器
 * 布局：SideNavBar(含剧集列表、资产库、设置) | TopNavBar + 主内容
 */
import { useState, useEffect } from "react"
import { Outlet, useLocation, useParams } from "react-router"
import { CloudDownload } from "lucide-react"
import { SideNavBar } from "./SideNavBar"
import { TopNavBar } from "./TopNavBar"
import { Dialog, Button } from "@/components/ui"
import { useEpisodeStore, useUIStore } from "@/stores"
import { MODAL_PULL_EPISODE } from "@/stores/uiStore"

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [pullId, setPullId] = useState("")
  const [pullForce, setPullForce] = useState(false)
  /** 仅同步 episode.json（画面描述、提示词），不下载首帧/资产图，速度更快 */
  const [pullSkipImages, setPullSkipImages] = useState(false)
  const [pullLoading, setPullLoading] = useState(false)
  const location = useLocation()
  const { episodeId: routeEpisodeId } = useParams<{ episodeId?: string }>()
  const isHome = location.pathname === "/"
  /** 剧集相关页（分镜板、资产库、镜头详情等）也显示拉取按钮 */
  const isEpisodePage = Boolean(routeEpisodeId)
  const { pullNewEpisode, currentEpisode } = useEpisodeStore()
  const { activeModal, openModal, closeModal } = useUIStore()
  const pullOpen = activeModal === MODAL_PULL_EPISODE

  /** 打开拉取弹窗时，若当前在剧集页则预填 episodeId */
  useEffect(() => {
    if (pullOpen && routeEpisodeId && !pullId) {
      setPullId(routeEpisodeId)
    }
  }, [pullOpen, routeEpisodeId])

  const handleClosePull = () => {
    closeModal()
    setPullId("")
    setPullForce(false)
    setPullSkipImages(false)
  }

  const handlePull = async () => {
    if (!pullId.trim()) return
    setPullLoading(true)
    try {
      const projectId =
        routeEpisodeId && currentEpisode?.episodeId === routeEpisodeId
          ? currentEpisode.projectId
          : undefined
      await pullNewEpisode(pullId.trim(), pullForce, projectId, pullSkipImages)
      handleClosePull()
    } finally {
      setPullLoading(false)
    }
  }

  const topActions = (isHome || isEpisodePage) ? (
    <button
      type="button"
      onClick={() => openModal(MODAL_PULL_EPISODE)}
      className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] text-white border border-[var(--color-newsprint-black)] font-bold text-xs uppercase tracking-widest hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
    >
      <CloudDownload className="w-4 h-4" />
      从平台拉取
    </button>
  ) : undefined

  return (
    <div className="flex min-h-screen bg-[var(--color-surface)] box-border">
      <SideNavBar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        taskCount={0}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopNavBar actions={topActions} />
        <main className="flex-1 overflow-auto min-w-0">
          <Outlet />
        </main>
      </div>

      <Dialog open={pullOpen} onClose={handleClosePull} title="从平台拉取剧集">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase text-[var(--color-muted)] mb-1">
              剧集 ID
            </label>
            <input
              type="text"
              placeholder="输入剧集 ID"
              value={pullId}
              onChange={(e) => setPullId(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--color-newsprint-black)] box-border"
            />
          </div>
          <div className="p-3 border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]/50 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={pullSkipImages}
                onChange={(e) => {
                  const v = e.target.checked
                  setPullSkipImages(v)
                  if (v) setPullForce(false)
                }}
                className="w-4 h-4 shrink-0"
              />
              <span className="text-sm font-medium">
                仅拉取分镜文案（不下载图片）
              </span>
            </label>
            <p className="text-xs text-[var(--color-muted)] ml-7 -mt-2">
              只写入 episode.json，含画面描述、图片/视频提示词；首帧与资产图占位路径不变，本地可无图。
            </p>
            <label
              className={`flex items-center gap-3 ${pullSkipImages ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
            >
              <input
                type="checkbox"
                checked={pullForce}
                disabled={pullSkipImages}
                onChange={(e) => setPullForce(e.target.checked)}
                className="w-4 h-4 shrink-0"
              />
              <span className="text-sm font-medium">
                强制重新下载资产图
              </span>
            </label>
            <p className="text-xs text-[var(--color-muted)] mt-1 ml-7">
              修复资产图拉错成风格图时勾选（与「仅文案」互斥）
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleClosePull}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={handlePull}
              disabled={pullLoading || !pullId.trim()}
            >
              {pullLoading ? "拉取中..." : "拉取"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
