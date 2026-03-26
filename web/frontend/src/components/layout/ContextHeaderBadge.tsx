/**
 * 顶栏 Feeling 上下文徽章：生产环境红底、非生产蓝绿；点击跳转设置页切换 Profile。
 */
import { Link } from "react-router"
import { useContextStore } from "@/stores"

export function ContextHeaderBadge() {
  const configured = useContextStore((s) => s.configured)
  const currentContextId = useContextStore((s) => s.currentContextId)
  const prof = useContextStore((s) => s.getCurrentProfile())
  const envLabel = useContextStore((s) =>
    prof ? s.getEnvironmentLabel(prof.envKey) : ""
  )

  if (!configured) {
    return (
      <Link
        to="/settings"
        className="truncate text-[10px] font-bold uppercase tracking-wider px-2 py-1 border border-dashed border-[var(--color-newsprint-black)] text-[var(--color-muted)] hover:bg-[var(--color-outline-variant)] box-border"
        title="未配置多上下文，点击前往设置"
      >
        .env 全局
      </Link>
    )
  }

  if (!currentContextId) {
    return (
      <Link
        to="/settings"
        className="truncate text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-amber-100 text-amber-900 border border-[var(--color-newsprint-black)] hover:opacity-90 box-border"
        title="未选择 Profile，点击前往设置"
      >
        未选 Profile
      </Link>
    )
  }

  const isProd = prof?.envKey === "prod"
  const boxClass = isProd
    ? "bg-red-600 text-white border border-red-800"
    : "bg-sky-100 text-sky-950 border border-sky-800"

  const label = prof?.label ?? currentContextId
  const sub = envLabel ? ` · ${envLabel}` : ""

  return (
    <Link
      to="/settings"
      className={`truncate max-w-full inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2 py-1 box-border hover:opacity-90 ${boxClass}`}
      title={`当前上下文：${currentContextId}${sub}（点击切换）`}
    >
      <span className="truncate">{label}</span>
      {sub ? <span className="opacity-80 truncate hidden sm:inline">{sub}</span> : null}
    </Link>
  )
}
