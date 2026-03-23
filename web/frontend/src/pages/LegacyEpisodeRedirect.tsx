/**
 * 旧版 /episode/:episodeId 及子路径兼容重定向
 *
 * 通过 GET /api/episodes/:id 读取本地 episode.json 中的 projectId，
 * 再跳转到新路径 /project/:projectId/episode/:episodeId/...
 */
import { useEffect, useState } from "react"
import { useParams, useNavigate, useLocation } from "react-router"
import { episodesApi } from "@/api/episodes"
import { routes } from "@/utils/routes"

export default function LegacyEpisodeRedirect() {
  const { episodeId } = useParams<{ episodeId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!episodeId) return
    let cancelled = false
    setErr(null)

    /** /episode/:eid 之后的子路径（如 /assets、/shot/x/regen），用于拼到新 URL */
    const prefix = `/episode/${episodeId}`
    const pathname = location.pathname
    const suffix =
      pathname.startsWith(prefix) && pathname.length > prefix.length
        ? pathname.slice(prefix.length)
        : ""

    episodesApi
      .detail(episodeId)
      .then((res) => {
        if (cancelled) return
        const pid = res.data.projectId
        const target = `${routes.episode(pid, episodeId)}${suffix}`
        navigate(target, { replace: true })
      })
      .catch(() => {
        if (!cancelled) {
          setErr(
            "本地未拉取该剧集，无法确定所属项目。请从首页进入项目后拉取剧集。"
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [episodeId, navigate, location.pathname])

  if (err) {
    return (
      <div className="p-8 max-w-lg mx-auto box-border">
        <div className="newsprint-card p-6 border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]/30">
          <h1 className="text-lg font-extrabold uppercase text-[var(--color-newsprint-black)] mb-2">
            无法跳转
          </h1>
          <p className="text-sm text-[var(--color-muted)] mb-4">{err}</p>
          <button
            type="button"
            className="text-[10px] font-black uppercase tracking-widest text-[var(--color-primary)] underline"
            onClick={() => navigate(routes.home())}
          >
            返回首页
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 text-center text-[var(--color-muted)] text-sm font-bold uppercase tracking-widest">
      正在跳转…
    </div>
  )
}
