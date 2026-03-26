/**
 * AppLayout 主布局容器
 * 布局：SideNavBar | TopNavBar（结构化面包屑）+ 主内容 + 从平台拉取弹窗
 */
import { useState, useEffect, useMemo } from "react"
import { Outlet, useLocation, useParams } from "react-router"
import { CloudDownload } from "lucide-react"
import { SideNavBar } from "./SideNavBar"
import { TopNavBar } from "./TopNavBar"
import { ContextHeaderBadge } from "./ContextHeaderBadge"
import { Dialog, Button } from "@/components/ui"
import { Toast } from "@/components/ui/Toast"
import { useContextStore, useEpisodeStore, useToastStore, useUIStore } from "@/stores"
import { MODAL_PULL_EPISODE } from "@/stores/uiStore"
import { projectsApi } from "@/api/projects"
import { routes } from "@/utils/routes"

/** 根据 pathname 判断剧集子页最后一级文案（分镜板 / 资产库 / 镜头 / …） */
function lastEpisodeSegmentLabel(pathname: string): string {
  const clean = pathname.split("?")[0].replace(/\/$/, "") || pathname
  if (clean.endsWith("/timeline")) return "时间线"
  if (clean.endsWith("/regen")) return "单帧重生"
  if (clean.endsWith("/assets")) return "资产库"
  if (clean.includes("/shot/")) return "镜头"
  if (/\/episode\/[^/]+$/.test(clean)) return "分镜板"
  return ""
}

interface Crumb {
  label: string
  path?: string
}

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [pullId, setPullId] = useState("")
  const [pullForce, setPullForce] = useState(false)
  /** 仅同步 episode.json（画面描述、提示词），不下载首帧/资产图，速度更快 */
  const [pullSkipImages, setPullSkipImages] = useState(false)
  const [pullLoading, setPullLoading] = useState(false)
  /** 当前路由下项目的展示标题（来自 GET /api/projects/:id） */
  const [projectTitle, setProjectTitle] = useState<string | null>(null)

  const location = useLocation()
  const { episodeId: routeEpisodeId, projectId: routeProjectId } = useParams<{
    episodeId?: string
    projectId?: string
  }>()
  const { pullNewEpisode, currentEpisode } = useEpisodeStore()
  const fetchContexts = useContextStore((s) => s.fetchContexts)
  const { toasts, dismiss: dismissToast } = useToastStore()
  const { activeModal, openModal, closeModal } = useUIStore()
  const pullOpen = activeModal === MODAL_PULL_EPISODE

  /** 启动时拉取环境与 Profile 列表（无配置文件时 configured=false，顶栏显示 .env 全局） */
  useEffect(() => {
    void fetchContexts()
  }, [fetchContexts])

  /** 进入项目相关页时拉取项目标题，供面包屑使用 */
  useEffect(() => {
    if (!routeProjectId) {
      setProjectTitle(null)
      return
    }
    let cancelled = false
    projectsApi
      .detail(routeProjectId)
      .then((res) => {
        if (!cancelled) setProjectTitle(res.data.title || null)
      })
      .catch(() => {
        if (!cancelled) setProjectTitle(null)
      })
    return () => {
      cancelled = true
    }
  }, [routeProjectId])

  /** 打开拉取弹窗时，若当前在剧集页则预填 episodeId */
  useEffect(() => {
    if (pullOpen && routeEpisodeId && !pullId) {
      setPullId(routeEpisodeId)
    }
  }, [pullOpen, routeEpisodeId, pullId])

  const breadcrumbs: Crumb[] = useMemo(() => {
    const p = location.pathname
    const home: Crumb = { label: "首页", path: routes.home() }

    if (p === "/local-episodes") {
      return [home, { label: "本地剧集" }]
    }
    if (p.startsWith("/settings")) {
      return [home, { label: "设置" }]
    }

    if (routeProjectId && !routeEpisodeId) {
      const title = projectTitle || routeProjectId
      return [home, { label: title, path: routes.project(routeProjectId) }]
    }

    if (routeProjectId && routeEpisodeId && currentEpisode) {
      const pt = projectTitle || routeProjectId
      const last = lastEpisodeSegmentLabel(p)
      const items: Crumb[] = [
        home,
        { label: pt, path: routes.project(routeProjectId) },
        {
          label: currentEpisode.episodeTitle,
          path: routes.episode(routeProjectId, routeEpisodeId),
        },
      ]
      if (last) items.push({ label: last })
      return items
    }

    return [home]
  }, [
    location.pathname,
    routeProjectId,
    routeEpisodeId,
    currentEpisode,
    projectTitle,
  ])

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
      /** 优先：剧集页且已加载 currentEpisode；否则项目详情页用 URL 中的 projectId */
      const projectId =
        routeEpisodeId && currentEpisode?.episodeId === routeEpisodeId
          ? currentEpisode.projectId
          : routeProjectId ?? undefined
      await pullNewEpisode(pullId.trim(), pullForce, projectId, pullSkipImages)
      handleClosePull()
    } finally {
      setPullLoading(false)
    }
  }

  const isEpisodePage = Boolean(routeEpisodeId)
  const isProjectDetailOnly = Boolean(routeProjectId) && !routeEpisodeId

  /**
   * 「从平台拉取」仅在具备项目上下文时展示：
   * - 项目详情：URL 含 projectId，提交时传入 routeProjectId
   * - 剧集相关页：可带 currentEpisode.projectId
   * 首页 / 本地剧集 / 设置不展示，避免无 projectId 时落到后端 proj-default，与「项目优先」主流程冲突。
   */
  const topActions =
    isEpisodePage || isProjectDetailOnly ? (
      <button
        type="button"
        onClick={() => openModal(MODAL_PULL_EPISODE)}
        className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] text-white border border-[var(--color-newsprint-black)] font-bold text-xs uppercase tracking-widest hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all box-border"
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
        <TopNavBar
          breadcrumbs={breadcrumbs}
          contextSlot={<ContextHeaderBadge />}
          actions={topActions}
        />
        {/**
         * 主内容区：占满「顶栏以下」视口高度，子页面可用 h-full + min-h-0 做一屏布局（如粗剪台）；
         * 内部再 overflow-y-auto，长页面（分镜板等）仍在内层滚动。
         */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            data-app-main-scroll
          >
            <Outlet />
          </div>
        </main>
      </div>

      <Toast toasts={toasts} onDismiss={dismissToast} />

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
          <div className="p-3 border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]/50 space-y-3 box-border">
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
