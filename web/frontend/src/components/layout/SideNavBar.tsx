/**
 * 侧边栏：剧集列表、资产库（独立入口）、设置
 * 资产库为独立页面，在剧集页时显示导航入口
 */
import { useEffect } from "react"
import { NavLink, useParams } from "react-router"
import { Video, Settings, PanelLeftClose, PanelLeft, Activity, Package } from "lucide-react"
import { useEpisodeStore } from "@/stores"

interface SideNavBarProps {
  collapsed: boolean
  onToggle: () => void
  taskCount?: number
}

const NAV_ITEMS = [
  { to: "/", icon: Video, label: "剧集列表" },
  { to: "/settings", icon: Settings, label: "设置" },
]

export function SideNavBar({ collapsed, onToggle, taskCount = 0 }: SideNavBarProps) {
  const { episodeId } = useParams<{ episodeId: string }>()
  const { currentEpisode, fetchEpisodeDetail } = useEpisodeStore()

  useEffect(() => {
    if (episodeId) void fetchEpisodeDetail(episodeId)
  }, [episodeId, fetchEpisodeDetail])

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
              2024 版
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

        {/* 资产库：剧集页时显示，点击进入独立资产库页面 */}
        {!collapsed && episodeId && (
          <div className="mt-4 border-t border-[var(--color-newsprint-black)] pt-4">
            <NavLink
              to={`/episode/${episodeId}/assets`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 text-xs uppercase tracking-widest font-bold transition-colors border ${
                  isActive
                    ? "bg-[var(--color-primary)] text-white border-[var(--color-newsprint-black)]"
                    : "text-[var(--color-newsprint-black)] border-transparent hover:border-[var(--color-newsprint-black)]"
                }`
              }
            >
              <Package className="w-5 h-5 shrink-0" />
              <span>资产库 ({assetCount})</span>
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
