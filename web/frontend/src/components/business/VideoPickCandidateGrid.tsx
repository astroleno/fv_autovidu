/**
 * VideoPickCandidateGrid — 选片模式「候选区」主体
 *
 * - 前 4 个候选为大网格；第 5 个起归入「更多候选」区（数字键仍只映射前 4）
 * - 激活态 / 已选态 / 合并态视觉区分（边框 + 标签，非仅靠颜色）
 */
import type { Shot, VideoCandidate } from "@/types"
import { VideoPlayer } from "./VideoPlayer"

export interface VideoPickCandidateGridProps {
  shot: Shot
  /** 当前 UI 激活的候选 id（循环播放） */
  activeCandidateId: string | null
  /** 点击或 Enter：与数字键一致，由父级执行「激活 + 提交已选」 */
  onActivateCandidate: (candidateId: string) => void
  /** 静态资源 URL 解析，与 VideoPickCard 一致 */
  getVideoUrl: (path: string) => string
}

const PRIMARY_MAX = 4

function candidateGridClass(count: number): string {
  if (count <= 0) return "grid gap-3"
  if (count === 1) return "grid grid-cols-1 gap-3"
  return "grid grid-cols-1 sm:grid-cols-2 gap-3"
}

function CandidateCell({
  shot,
  c,
  indexLabel,
  active,
  selected,
  videoUrl,
  onActivate,
}: {
  shot: Shot
  c: VideoCandidate
  indexLabel: string
  active: boolean
  selected: boolean
  videoUrl: string
  onActivate: () => void
}) {
  const merged = active && selected
  const borderClass = merged
    ? "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)] ring-offset-1"
    : active
      ? "border-blue-600 ring-2 ring-blue-500/40"
      : selected
        ? "border-[var(--color-primary)]"
        : "border-[var(--color-border)]"

  const resLabel = c.resolution?.trim() || "—"
  const previewTag = c.isPreview ? " [预览]" : ""

  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex flex-col border-2 ${borderClass} p-2 bg-white box-border min-w-0 rounded-sm cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-newsprint-black)]`}
      style={{ boxSizing: "border-box" }}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onActivate()
        }
      }}
      aria-label={`候选 ${indexLabel}${selected ? "，已选定" : ""}${active ? "，当前激活" : ""}`}
    >
      <div className="min-h-[min(480px,50vh)] box-border flex flex-col justify-center" style={{ boxSizing: "border-box" }}>
        <VideoPlayer
          src={videoUrl}
          aspectRatio={shot.aspectRatio}
          autoPlay={active}
          loop={active}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 min-h-0 box-border" style={{ boxSizing: "border-box" }}>
        <span className="text-[10px] font-black text-[var(--color-newsprint-black)] border border-[var(--color-newsprint-black)] px-1.5 py-0.5 shrink-0">
          #{indexLabel}
        </span>
        {selected ? (
          <span className="text-[9px] font-black uppercase bg-[var(--color-primary)] text-white px-1.5 py-0.5 shrink-0">
            已选
          </span>
        ) : null}
        {active ? (
          <span className="text-[9px] font-black uppercase border border-blue-700 text-blue-900 px-1.5 py-0.5 shrink-0">
            播放中
          </span>
        ) : null}
      </div>
      <p className="text-[10px] text-[var(--color-muted)] leading-snug break-words mt-1">
        {c.model} | {resLabel} | {c.mode} | seed {c.seed}
        {previewTag}
      </p>
    </div>
  )
}

export function VideoPickCandidateGrid({
  shot,
  activeCandidateId,
  onActivateCandidate,
  getVideoUrl,
}: VideoPickCandidateGridProps) {
  const list = shot.videoCandidates
  if (list.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)] box-border" style={{ boxSizing: "border-box" }}>
        暂无视频候选，可在右侧参考区确认首尾帧后使用下方工具重新生成。
      </p>
    )
  }

  const primary = list.slice(0, PRIMARY_MAX)
  const more = list.slice(PRIMARY_MAX)

  return (
    <div className="flex flex-col gap-4 min-w-0 box-border" style={{ boxSizing: "border-box" }}>
      <div className={candidateGridClass(primary.length)}>
        {primary.map((c, i) => {
          const videoUrl = getVideoUrl(c.videoPath)
          const active = activeCandidateId === c.id
          return (
            <CandidateCell
              key={c.id}
              shot={shot}
              c={c}
              indexLabel={String(i + 1)}
              active={active}
              selected={c.selected}
              videoUrl={videoUrl}
              onActivate={() => onActivateCandidate(c.id)}
            />
          )
        })}
      </div>

      {more.length > 0 ? (
        <div
          className="rounded-sm border border-dashed border-[var(--color-newsprint-black)] p-3 bg-[var(--color-outline-variant)]/30 box-border"
          style={{ boxSizing: "border-box" }}
        >
          <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-2">
            更多候选（请用 Tab / Shift+Tab 切换激活）
          </p>
          <div className={candidateGridClass(more.length)}>
            {more.map((c, j) => {
              const idx = PRIMARY_MAX + j + 1
              const videoUrl = getVideoUrl(c.videoPath)
              const active = activeCandidateId === c.id
              return (
                <CandidateCell
                  key={c.id}
                  shot={shot}
                  c={c}
                  indexLabel={String(idx)}
                  active={active}
                  selected={c.selected}
                  videoUrl={videoUrl}
                  onActivate={() => onActivateCandidate(c.id)}
                />
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
