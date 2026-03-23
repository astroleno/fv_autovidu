/**
 * Episode 列表页
 * Bento 风格卡片网格，进度条，拉取弹窗，Skeleton，空状态
 */
import { useEffect } from "react"
import { Link } from "react-router"
import { Layers, ArrowRight } from "lucide-react"
import { useEpisodeStore, useUIStore } from "@/stores"
import { MODAL_PULL_EPISODE } from "@/stores/uiStore"
import { Button, Card, Progress, Skeleton, EmptyState } from "@/components/ui"
import { formatRelativeTime, getEpisodeStats } from "@/utils/format"
import { routes } from "@/utils/routes"

export default function EpisodeListPage() {
  const { episodes, loading, error, fetchEpisodes } = useEpisodeStore()
  const { openModal } = useUIStore()

  useEffect(() => {
    void fetchEpisodes()
  }, [fetchEpisodes])

  if (loading && episodes.length === 0) {
    return (
      <div className="p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <Skeleton height={24} className="mb-4" />
              <Skeleton height={16} className="mb-6" />
              <Skeleton height={8} className="mb-4" />
              <Skeleton height={40} className="mt-4" />
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (!loading && episodes.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          title="暂无剧集"
          description="从平台拉取分镜数据后可在此查看和管理"
          action={{
            label: "从平台拉取",
            onClick: () => openModal(MODAL_PULL_EPISODE),
          }}
        />
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-10 border-l-4 border-[var(--color-primary)] pl-6">
        <h1 className="text-4xl font-extrabold tracking-tighter text-[var(--color-newsprint-black)] uppercase mb-1 font-headline">
          本地剧集
        </h1>
        <p className="text-[var(--color-newsprint-black)] font-medium opacity-70 text-sm uppercase tracking-tight">
          已拉取到本机的剧集（调试入口）；主入口请从首页「项目」进入
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 border border-[var(--color-newsprint-black)] text-sm font-bold uppercase">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {episodes.map((ep) => {
          const stats = getEpisodeStats(ep)
          return (
            <Card
              key={`${ep.projectId}-${ep.episodeId}`}
              padding
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-primary)] block mb-1">
                    编号 {ep.episodeId.slice(0, 8)}
                  </span>
                  <h3 className="text-xl font-extrabold uppercase text-[var(--color-newsprint-black)] font-headline">
                    {ep.episodeTitle}
                  </h3>
                </div>
                <span className="text-[10px] font-black uppercase opacity-40">
                  {formatRelativeTime(ep.pulledAt)}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-6 py-2 border-y border-[var(--color-newsprint-black)] border-dashed">
                <Layers className="w-4 h-4 text-[var(--color-newsprint-black)]" />
                <span className="text-[11px] font-black uppercase tracking-tight">
                  {stats.total} 个镜头
                </span>
              </div>
              <div className="mb-8">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-tighter mb-2">
                  <span>进度</span>
                  <span className="text-[var(--color-primary)]">
                    {stats.percent}%
                  </span>
                </div>
                <Progress value={stats.percent} showLabel={false} />
                <div className="flex gap-4 mt-2 text-[10px] font-black uppercase text-[var(--color-muted)]">
                  <span>已选定 {stats.selected}</span>
                  <span>待处理 {stats.pending}</span>
                </div>
              </div>
              <Link to={routes.episode(ep.projectId, ep.episodeId)}>
                <Button
                  variant="secondary"
                  className="w-full justify-center gap-2"
                >
                  进入分镜板
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </Card>
          )
        })}
      </div>

    </div>
  )
}
