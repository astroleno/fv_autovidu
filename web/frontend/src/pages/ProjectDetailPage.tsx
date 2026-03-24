/**
 * 项目详情页：平台剧集列表 + 本地拉取状态；支持单集拉取、一键拉取全部、进入分镜
 *
 * 仅当 projectEpisodesForProjectId === 当前路由 projectId 时渲染列表，避免全局单例串台。
 * 详情错误存在 projectDetailError 中，与首页列表错误互不覆盖。
 */
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { RefreshCw, Clapperboard, Download, Loader2 } from "lucide-react"
import { useProjectStore, useEpisodeStore, useToastStore } from "@/stores"
import { episodesApi } from "@/api/episodes"
import { projectsApi } from "@/api/projects"
import type { ProjectEpisodeItem } from "@/types/project"
import { Button, Card, Skeleton, EmptyState } from "@/components/ui"
import { routes } from "@/utils/routes"

function sourceLabel(source: ProjectEpisodeItem["source"]): string {
  switch (source) {
    case "remote_and_local":
      return "已拉取"
    case "remote_only":
      return "未拉取"
    case "local_only":
      return "仅本地"
    default:
      return source
  }
}

export default function ProjectDetailPage() {
  const { projectId = "" } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const {
    projectEpisodes,
    projectEpisodesForProjectId,
    projectEpisodesLoading,
    projectDetailError,
    fetchProjectEpisodes,
  } = useProjectStore()
  const { fetchEpisodes } = useEpisodeStore()
  const pushToast = useToastStore((s) => s.push)
  const [pullingId, setPullingId] = useState<string | null>(null)
  const [pullAllBusy, setPullAllBusy] = useState(false)

  useEffect(() => {
    if (projectId) void fetchProjectEpisodes(projectId)
  }, [projectId, fetchProjectEpisodes])

  const handlePullOne = async (episodeId: string) => {
    if (!projectId) return
    setPullingId(episodeId)
    try {
      const res = await episodesApi.pull(episodeId, false, projectId, false)
      /**
       * 与 AppLayout「从平台拉取」一致：把 POST /pull 返回的 Episode 写入全局 store。
       * 进入分镜页时即使用内存数据，不依赖 GET /episodes/:id 再读盘（避免 DATA_ROOT 不一致或竞态导致 404）。
       */
      useEpisodeStore.setState((s) => {
        const rest = s.episodes.filter((e) => e.episodeId !== res.data.episodeId)
        return {
          episodes: [res.data, ...rest],
          currentEpisode: res.data,
          error: null,
        }
      })
      pushToast("拉取成功", "success")
      void fetchProjectEpisodes(projectId)
      void fetchEpisodes()
      navigate(routes.episode(projectId, episodeId))
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "拉取失败", "error")
    } finally {
      setPullingId(null)
    }
  }

  const handlePullAll = async () => {
    if (!projectId) return
    setPullAllBusy(true)
    try {
      const res = await projectsApi.pullAll(projectId)
      const { successCount, failedCount, failedEpisodes } = res.data
      pushToast(
        `完成：成功 ${successCount}，失败 ${failedCount}`,
        failedCount > 0 ? "error" : "success"
      )
      if (failedEpisodes.length > 0) {
        failedEpisodes.slice(0, 3).forEach((f) => {
          pushToast(`${f.episodeId}: ${f.message}`, "error")
        })
      }
      void fetchProjectEpisodes(projectId)
      void fetchEpisodes()
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "一键拉取失败", "error")
    } finally {
      setPullAllBusy(false)
    }
  }

  if (!projectId) return null

  /** 当前路由对应项目的详情接口是否失败 */
  const detailFailedForRoute =
    projectDetailError?.projectId === projectId ? projectDetailError : null

  /** 数据是否与当前 URL 中的项目一致（防止仍显示上一项目缓存） */
  const dataBelongsToRoute = projectEpisodesForProjectId === projectId

  /** 加载中，或路由已切换但数据尚未对齐到当前 projectId */
  const showSkeleton =
    projectEpisodesLoading ||
    (!dataBelongsToRoute && !detailFailedForRoute)

  if (detailFailedForRoute) {
    return (
      <div className="p-8 box-border max-w-5xl mx-auto">
        <EmptyState
          title="加载失败"
          description={detailFailedForRoute.message}
          action={{
            label: "重试",
            onClick: () => void fetchProjectEpisodes(projectId),
          }}
        />
      </div>
    )
  }

  if (showSkeleton || !projectEpisodes) {
    return (
      <div className="p-8 box-border max-w-5xl mx-auto">
        <Skeleton height={40} className="mb-8" />
        <Skeleton height={200} />
      </div>
    )
  }

  const title = projectEpisodes.project.title ?? projectId
  const episodes = projectEpisodes.episodes ?? []

  return (
    <div className="p-8 box-border max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8 border-b border-[var(--color-newsprint-black)] pb-6">
        <div className="border-l-4 border-[var(--color-primary)] pl-6 min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tighter text-[var(--color-newsprint-black)] uppercase font-headline break-words">
            {title}
          </h1>
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--color-muted)] mt-1">
            {projectId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="gap-2"
            onClick={() => void fetchProjectEpisodes(projectId)}
            disabled={projectEpisodesLoading}
          >
            <RefreshCw
              className={`w-4 h-4 ${projectEpisodesLoading ? "animate-spin" : ""}`}
            />
            刷新
          </Button>
          <Button
            type="button"
            variant="primary"
            className="gap-2"
            onClick={() => void handlePullAll()}
            disabled={pullAllBusy}
          >
            {pullAllBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            一键拉取全部
          </Button>
        </div>
      </div>

      {episodes.length === 0 ? (
        <EmptyState title="暂无剧集" description="该平台项目下暂无剧集条目" />
      ) : (
        <div className="space-y-3">
          {episodes.map((ep) => (
            <Card key={ep.episodeId} padding>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase text-[var(--color-primary)]">
                    第 {ep.episodeNumber} 集
                  </div>
                  <div className="font-extrabold text-[var(--color-newsprint-black)] truncate">
                    {ep.title || ep.episodeId}
                  </div>
                  <div className="text-[10px] font-bold uppercase text-[var(--color-muted)] mt-1">
                    {sourceLabel(ep.source)}
                    {ep.pulledAt ? ` · ${ep.pulledAt}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {ep.pulledLocally ? (
                    <Link to={routes.episode(projectId, ep.episodeId)}>
                      <Button type="button" variant="primary" className="gap-2">
                        <Clapperboard className="w-4 h-4" />
                        进入分镜板
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handlePullOne(ep.episodeId)}
                      disabled={pullingId === ep.episodeId}
                    >
                      {pullingId === ep.episodeId ? (
                        <Loader2 className="w-4 h-4 animate-spin inline mr-1" />
                      ) : null}
                      拉取后进入
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
