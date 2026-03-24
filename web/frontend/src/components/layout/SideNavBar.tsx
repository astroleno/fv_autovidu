/**
 * 侧边栏：项目列表、设置；在剧集上下文中追加「粗剪时间线」「分镜板/表」「资产库」
 * 垂直顺序：粗剪 → 分镜板/表（紧贴资产库上方）→ 资产库
 *
 * 不在此重复请求 GET /episodes/:id：各剧集子页（分镜板、时间线、资产库等）已拉取详情，
 * 避免与 SideNavBar 并发双请求、404 时控制台重复报错。
 */
import { NavLink, useParams } from "react-router"
import {
  Video,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Activity,
  Package,
  Clapperboard,
  LayoutGrid,
} from "lucide-react"
import { useEpisodeStore } from "@/stores"
import { routes } from "@/utils/routes"

interface SideNavBarProps {
  collapsed: boolean
  onToggle: () => void
  taskCount?: number
}

const NAV_ITEMS = [
  { to: "/", icon: Video, label: "项目列表" },
  { to: "/settings", icon: Settings, label: "设置" },
]

export function SideNavBar({ collapsed, onToggle, taskCount = 0 }: SideNavBarProps) {
  const { projectId: routeProjectId, episodeId } = useParams<{
    projectId?: string
    episodeId?: string
  }>()
  const { currentEpisode } = useEpisodeStore()

  /** 剧集页时资产数量（用于资产库入口显示） */
  const assetsList =
    episodeId && currentEpisode
      ? currentEpisode.assets && currentEpisode.assets.length > 0
        ? currentEpisode.assets
        : (currentEpisode.scenes.flatMap((s) => s.shots.flatMap((sh) => sh.assets)) ?? []).filter(
            (a, i, arr) => arr.findIndex((x) => x.assetId === a.assetId) === i
          )
      : []
  const assetCount = assetsList.length
  /** 资产库链接需 projectId；旧数据从 episode 推断 */
  const projectId = routeProjectId ?? currentEpisode?.projectId

  const width = collapsed ? "w-16" : "w-60"

  return (
    <aside
      className={`${width} h-screen sticky left-0 top-0 flex flex-col border-r border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] transition-all duration-300 shrink-0 box-border py-6`}
    >
      {/* Logo */}
      <div className="px-5 mb-6 flex items-center gap-3">
        <div className="w-8 h-8 border-2 border-[var(--color-newsprint-black)] bg-[var(--color-primary)] flex items-center justify-center shrink-0">
          <Video className="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        {!collapsed && (
          <div>
            <div className="text-lg font-extrabold uppercase tracking-tight text-[var(--color-newsprint-black)] leading-tight font-headline">
              分镜工作室
            </div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-[var(--color-newsprint-black)] font-bold opacity-60">
              2026 版
            </div>
          </div>
        )}
      </div>

      {/* 折叠按钮 */}
      <button
        type="button"
        onClick={onToggle}
        className="m-2 p-2 border border-[var(--color-newsprint-black)] transition-all self-end bg-transparent hover:bg-[var(--color-outline-variant)]"
        aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
      >
        {collapsed ? (
          <PanelLeft className="w-5 h-5 text-[var(--color-ink)] opacity-70" />
        ) : (
          <PanelLeftClose className="w-5 h-5 text-[var(--color-ink)] opacity-70" />
        )}
      </button>

      {/* 导航：剧集列表、设置 */}
      <nav className="flex-1 px-3 space-y-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 text-xs uppercase tracking-widest font-bold transition-colors box-border border ${
                isActive
                  ? "bg-[var(--color-primary)] text-white border-[var(--color-newsprint-black)]"
                  : "text-[var(--color-newsprint-black)] border-transparent hover:border-[var(--color-newsprint-black)]"
              }`
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}

        {/**
         * 当前剧集子页导航（自上而下）：
         * 粗剪时间线 → 分镜板/表（紧贴资产库上一行）→ 资产库。
         * 折叠时仅图标，样式与主导航一致。
         */}
        {episodeId && projectId && (
          <div
            className={`mt-4 border-t border-[var(--color-newsprint-black)] pt-4 space-y-1 ${
              collapsed ? "px-0" : ""
            }`}
          >
            <NavLink
              to={routes.timeline(projectId, episodeId)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 text-xs uppercase tracking-widest font-bold transition-colors box-border border ${
                  isActive
                    ? "bg-[var(--color-primary)] text-white border-[var(--color-newsprint-black)]"
                    : "text-[var(--color-newsprint-black)] border-transparent hover:border-[var(--color-newsprint-black)]"
                }`
              }
              title={collapsed ? "粗剪时间线" : undefined}
            >
              <Clapperboard className="w-5 h-5 shrink-0" aria-hidden />
              {!collapsed && <span>粗剪时间线</span>}
            </NavLink>
            {/**
             * 分镜板根路由：必须加 end，否则 /timeline、/assets、/shot/... 会误匹配为「当前在分镜板」
             */}
            <NavLink
              end
              to={routes.episode(projectId, episodeId)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 text-xs uppercase tracking-widest font-bold transition-colors box-border border ${
                  isActive
                    ? "bg-[var(--color-primary)] text-white border-[var(--color-newsprint-black)]"
                    : "text-[var(--color-newsprint-black)] border-transparent hover:border-[var(--color-newsprint-black)]"
                }`
              }
              title={collapsed ? "分镜板/表" : undefined}
            >
              <LayoutGrid className="w-5 h-5 shrink-0" aria-hidden />
              {!collapsed && <span>分镜板/表</span>}
            </NavLink>
            <NavLink
              to={routes.assets(projectId, episodeId)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 text-xs uppercase tracking-widest font-bold transition-colors box-border border ${
                  isActive
                    ? "bg-[var(--color-primary)] text-white border-[var(--color-newsprint-black)]"
                    : "text-[var(--color-newsprint-black)] border-transparent hover:border-[var(--color-newsprint-black)]"
                }`
              }
              title={collapsed ? `资产库 (${assetCount})` : undefined}
            >
              <Package className="w-5 h-5 shrink-0" aria-hidden />
              {!collapsed && <span>资产库 ({assetCount})</span>}
            </NavLink>
          </div>
        )}
      </nav>

      {/* 底部状态 */}
      <div className="mt-auto px-3 space-y-1 border-t border-[var(--color-newsprint-black)] pt-4">
        <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold text-[var(--color-newsprint-black)]">
          <Activity className="w-4 h-4 shrink-0" />
          {!collapsed && (
            <span>{taskCount > 0 ? `运行中: ${taskCount}` : "系统就绪"}</span>
          )}
        </div>
      </div>
    </aside>
  )
}
