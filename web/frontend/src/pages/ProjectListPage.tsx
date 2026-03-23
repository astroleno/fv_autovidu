/**
 * 项目列表首页（新首页）
 * 展示 Feeling 平台项目卡片：标题、剧集数、本地已拉取数；点击进入项目详情
 *
 * 展示优先级：加载中骨架 → 接口错误（含重试）→ 空列表 → 成功列表。
 * 只要 projectsError 存在即显示错误态，避免与「暂无项目」混淆。
 */
import { useEffect } from "react"
import { Link } from "react-router"
import { FolderOpen, ArrowRight } from "lucide-react"
import { useProjectStore } from "@/stores"
import { Button, Card, Skeleton, EmptyState } from "@/components/ui"
import { routes } from "@/utils/routes"

export default function ProjectListPage() {
  const { projects, projectsLoading, projectsError, fetchProjects } = useProjectStore()

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  /** 首次进入且无缓存时显示骨架 */
  if (projectsLoading && projects.length === 0) {
    return (
      <div className="p-8 box-border">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} padding>
              <Skeleton height={24} className="mb-4" />
              <Skeleton height={16} className="mb-6" />
              <Skeleton height={40} className="mt-4" />
            </Card>
          ))}
        </div>
      </div>
    )
  }

  /** 列表接口失败：优先于空列表展示，不依赖 projects.length */
  if (projectsError) {
    return (
      <div className="p-8 box-border">
        <EmptyState
          title="加载项目失败"
          description={projectsError}
          action={{
            label: "重试",
            onClick: () => void fetchProjects(),
          }}
        />
      </div>
    )
  }

  if (!projectsLoading && projects.length === 0) {
    return (
      <div className="p-8 box-border">
        <EmptyState
          title="暂无项目"
          description="请先在 Feeling 平台创建项目，并确认本机 .env 中 FEELING_* 配置正确"
        />
      </div>
    )
  }

  return (
    <div className="p-8 box-border">
      <div className="mb-10 border-l-4 border-[var(--color-primary)] pl-6">
        <h1 className="text-4xl font-extrabold tracking-tighter text-[var(--color-newsprint-black)] uppercase mb-1 font-headline">
          项目
        </h1>
        <p className="text-[var(--color-newsprint-black)] font-medium opacity-70 text-sm uppercase tracking-tight">
          选择项目后查看剧集与拉取状态
        </p>
      </div>

      {projectsLoading ? (
        <div className="mb-4 text-[10px] font-black uppercase text-[var(--color-muted)]">
          刷新中…
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {projects.map((p) => (
          <Card key={p.projectId} padding>
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-primary)] block mb-1">
                  {p.projectId.slice(0, 8)}…
                </span>
                <h3 className="text-xl font-extrabold uppercase text-[var(--color-newsprint-black)] font-headline line-clamp-2">
                  {p.title || "未命名项目"}
                </h3>
              </div>
              <FolderOpen className="w-6 h-6 text-[var(--color-newsprint-black)] opacity-40 shrink-0" />
            </div>
            {p.description ? (
              <p className="text-xs text-[var(--color-muted)] mb-4 line-clamp-2 box-border">
                {p.description}
              </p>
            ) : null}
            <div className="flex items-center gap-4 mb-6 py-2 border-y border-[var(--color-newsprint-black)] border-dashed text-[11px] font-black uppercase tracking-tight">
              <span>平台 {p.episodeCount} 集</span>
              <span className="text-[var(--color-primary)]">本地 {p.pulledEpisodeCount} 集</span>
            </div>
            <Link to={routes.project(p.projectId)}>
              <Button variant="secondary" className="w-full justify-center gap-2">
                进入项目
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </Card>
        ))}
      </div>

      <div className="mt-10 text-center">
        <Link
          to={routes.localEpisodes()}
          className="text-[10px] font-black uppercase tracking-widest text-[var(--color-muted)] hover:underline"
        >
          查看本地已拉取剧集列表（调试）
        </Link>
      </div>
    </div>
  )
}
