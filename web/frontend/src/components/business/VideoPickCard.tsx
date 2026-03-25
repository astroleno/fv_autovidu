/**
 * VideoPickCard — 选片总览专用卡片
 *
 * 与 ShotCard 分工不同：本组件仅负责「多视频候选对比 + 原地选定 + 预览精出」，
 * 不包含批量生成尾帧/视频等生产链路。
 *
 * 交互概要：
 * - 小尺寸首帧图：帮助在网格中快速认出镜头身份
 * - 每个候选直接使用完整 VideoPlayer（与镜头详情一致），并按 shot.aspectRatio 做横/竖屏区域适配
 * - 选定：调用 shotStore.selectCandidate，成功后 episode 详情由 store 刷新
 * - 精出：usePromoteCandidate，条件与 ShotDetailPage 一致
 */
import { Link } from "react-router"
import { ExternalLink } from "lucide-react"
import type { Shot } from "@/types"
import { usePromoteCandidate } from "@/hooks"
import { useShotStore } from "@/stores"
import { Button } from "@/components/ui"
import { VideoPlayer } from "./VideoPlayer"
import { StatusIndicator } from "./StatusIndicator"
import { shotStatusLabels } from "@/utils/format"
import { getFileUrl } from "@/utils/file"
import { routes } from "@/utils/routes"

/** 组件对外 Props：与分镜卡片类似的剧集上下文，便于拼接静态资源 URL 与路由 */
export interface VideoPickCardProps {
  shot: Shot
  projectId: string
  episodeId: string
  basePath: string
  cacheBust?: string
}

/**
 * 根据候选数量决定网格列数：少量时单行并排，多枚时 2～3 列自适应，避免卡片过宽或过挤。
 */
function candidateGridClass(count: number): string {
  if (count <= 0) return "grid gap-3"
  if (count === 1) return "grid grid-cols-1 gap-3"
  if (count === 2) return "grid grid-cols-2 gap-3"
  if (count === 3) return "grid grid-cols-3 gap-3"
  return "grid grid-cols-2 lg:grid-cols-3 gap-3"
}

export function VideoPickCard({
  shot,
  projectId,
  episodeId,
  basePath,
  cacheBust,
}: VideoPickCardProps) {
  const { selectCandidate } = useShotStore()
  const { promote, isPromoting } = usePromoteCandidate({
    episodeId,
    shotId: shot.shotId,
  })

  const firstFrameUrl = shot.firstFrame?.trim()
    ? getFileUrl(shot.firstFrame, basePath, cacheBust)
    : ""
  const storyboardUrl = routes.episode(projectId, episodeId)
  const detailUrl = routes.shot(projectId, episodeId, shot.shotId)
  const gridClass = candidateGridClass(shot.videoCandidates.length)

  return (
    <article
      className="border-2 border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] shadow-[4px_4px_0px_0px_#111111] flex flex-col box-border"
      style={{ boxSizing: "border-box" }}
    >
      {/* 头部：全局镜头号、运镜/时长摘要、状态点 + 文案标签 */}
      <header
        className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[var(--color-newsprint-black)] bg-[var(--color-divider)] box-border"
        style={{ boxSizing: "border-box" }}
      >
        <StatusIndicator status={shot.status} />
        <span className="text-xs font-black text-[var(--color-newsprint-black)] tracking-tight">
          S{String(shot.shotNumber).padStart(2, "0")}
        </span>
        <span className="text-[10px] text-[var(--color-muted)] uppercase font-bold truncate max-w-[12rem]">
          {shot.cameraMovement} · {shot.duration}s
        </span>
        <span className="text-[10px] text-[var(--color-muted)] font-bold border border-dashed border-[var(--color-newsprint-black)] px-1.5 py-0.5">
          {shot.aspectRatio}
        </span>
        <span className="ml-auto text-[10px] font-black uppercase border border-[var(--color-newsprint-black)] px-2 py-0.5 bg-white">
          {shotStatusLabels[shot.status]}
        </span>
      </header>

      <div
        className="p-3 flex flex-col gap-3 flex-1 min-h-0 box-border"
        style={{ boxSizing: "border-box" }}
      >
        {/* 首帧缩略：窄条即可，只作语义锚点 */}
        {firstFrameUrl ? (
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black uppercase text-[var(--color-muted)] shrink-0">
              首帧
            </span>
            <div
              className="h-14 w-[4.5rem] shrink-0 overflow-hidden border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] box-border"
              style={{ boxSizing: "border-box" }}
            >
              <img
                src={firstFrameUrl}
                alt={`镜头 ${shot.shotNumber} 首帧`}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        ) : null}

        {shot.videoCandidates.length === 0 ? (
          <div
            className="text-xs text-[var(--color-muted)] space-y-2 py-2 box-border"
            style={{ boxSizing: "border-box" }}
          >
            <p>暂无视频候选，请先在分镜板生成视频。</p>
            <Link
              to={storyboardUrl}
              className="inline-flex items-center gap-1 font-bold text-[var(--color-primary)] underline underline-offset-2"
            >
              前往分镜板
            </Link>
          </div>
        ) : (
          <div className={gridClass}>
            {shot.videoCandidates.map((c) => {
              const videoUrl = getFileUrl(c.videoPath, basePath, cacheBust)
              const resLabel = c.resolution?.trim() || "—"
              const previewTag = c.isPreview ? " [预览]" : ""
              const canPromote =
                Boolean(c.isPreview) &&
                c.taskStatus === "success" &&
                c.seed > 0
              const busy = isPromoting(c.id)
              const borderSelected = c.selected
                ? "border-[var(--color-primary)]"
                : "border-[var(--color-border)]"

              return (
                <div
                  key={c.id}
                  className={`flex flex-col border-2 ${borderSelected} p-2 bg-white box-border min-w-0`}
                  style={{ boxSizing: "border-box" }}
                >
                  <VideoPlayer
                    src={videoUrl}
                    aspectRatio={shot.aspectRatio}
                  />

                  <div
                    className="mt-2 flex flex-col gap-2 flex-1 min-h-0 box-border"
                    style={{ boxSizing: "border-box" }}
                  >
                    <p className="text-[10px] text-[var(--color-muted)] leading-snug break-words">
                      {c.model} | {resLabel} | {c.mode} | seed {c.seed}
                      {previewTag}
                      {c.promotedFrom ? (
                        <span className="block mt-0.5">
                          来源预览: {c.promotedFrom}
                        </span>
                      ) : null}
                    </p>
                    <div className="flex flex-wrap gap-2 justify-end mt-auto">
                      {canPromote ? (
                        <Button
                          variant="secondary"
                          type="button"
                          disabled={busy}
                          className="text-[10px] px-2 py-1"
                          onClick={() => void promote(c.id)}
                        >
                          {busy ? "精出中…" : "精出 1080p"}
                        </Button>
                      ) : null}
                      <Button
                        variant={c.selected ? "primary" : "secondary"}
                        type="button"
                        className="text-[10px] px-2 py-1"
                        onClick={() =>
                          void selectCandidate(episodeId, shot.shotId, c.id)
                        }
                        disabled={c.selected}
                      >
                        {c.selected ? "已选定" : "选定"}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <footer
        className="px-3 py-2 border-t border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] box-border"
        style={{ boxSizing: "border-box" }}
      >
        <Link
          to={detailUrl}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--color-newsprint-black)] hover:text-[var(--color-primary)] transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden />
          查看详情（提示词 / 资产）
        </Link>
      </footer>
    </article>
  )
}
