/**
 * TopNavBar 顶部导航栏
 * Stitch 报纸风格：UPPERCASE 面包屑、newsprint-border、10px 字号
 */
import { Link, useLocation } from "react-router"

interface BreadcrumbItem {
  label: string
  path?: string
}

interface TopNavBarProps {
  breadcrumbs?: BreadcrumbItem[]
  actions?: React.ReactNode
}

function buildBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split("/").filter(Boolean)
  const items: BreadcrumbItem[] = [{ label: "首页", path: "/" }]

  const labels: Record<string, string> = {
    episode: "剧集",
    assets: "资产库",
    shot: "镜头",
    regen: "单帧重生",
    timeline: "时间线",
    settings: "设置",
  }
  let currentPath = ""
  for (const seg of segments) {
    currentPath += `/${seg}`
    const label = labels[seg] ?? seg
    items.push({ label, path: currentPath })
  }
  return items
}

export function TopNavBar({ breadcrumbs, actions }: TopNavBarProps) {
  const location = useLocation()
  const crumbs = breadcrumbs ?? buildBreadcrumbs(location.pathname)

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] flex items-center justify-between px-8 box-border">
      <nav aria-label="面包屑" className="flex items-center gap-1 md:gap-3 text-[10px] font-black uppercase tracking-tighter text-[var(--color-newsprint-black)]">
        {crumbs.map((item, i) => (
          <span key={i} className="flex items-center gap-1 md:gap-3">
            {i > 0 && (
              <span className="text-[var(--color-newsprint-black)] opacity-60 mx-1">/</span>
            )}
            {item.path && i < crumbs.length - 1 ? (
              <Link
                to={item.path}
                className="opacity-70 hover:opacity-100 hover:underline"
              >
                {item.label}
              </Link>
            ) : (
              <span className="font-black">{item.label}</span>
            )}
          </span>
        ))}
      </nav>
      {actions && <div className="flex items-center gap-4">{actions}</div>}
    </header>
  )
}
