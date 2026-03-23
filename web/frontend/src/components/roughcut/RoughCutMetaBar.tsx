/**
 * 粗剪台 — 基本信息条（对应原型 TopNav 下方的剧集/项目摘要）
 * 展示：剧集标题、集号、项目 ID、镜头统计、叙事总时长估算
 */
import type { Episode } from "@/types"
import { formatTimeMmSs } from "./roughcutUtils"

export interface RoughCutMetaBarProps {
  /** 当前剧集（含 projectId / episodeTitle 等） */
  episode: Episode
  /** 时间线上镜头条目数（含待生成占位） */
  totalShotsOnTrack: number
  /** 已具备可播放视频文件的镜头数 */
  playableShots: number
  /** 叙事顺序下各镜头用于估算的总时长（秒），通常为各 shot.duration 之和 */
  estimatedTotalSec: number
}

/**
 * 单行信息摘要，使用 newsprint 变量色与等宽数字，便于扫读
 */
export function RoughCutMetaBar({
  episode,
  totalShotsOnTrack,
  playableShots,
  estimatedTotalSec,
}: RoughCutMetaBarProps) {
  return (
    <section
      className="mb-2 flex flex-wrap items-end justify-between gap-4 border border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] px-4 py-3 text-[var(--color-ink)] box-border"
      style={{ boxSizing: "border-box" }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--color-muted)]">
          Rough Cut / 粗剪台
        </p>
        <h2 className="mt-1 truncate text-lg font-extrabold uppercase tracking-tighter font-headline text-[var(--color-newsprint-black)]">
          {episode.episodeTitle || "未命名剧集"}
        </h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          项目 <span className="font-mono text-[var(--color-ink)]">{episode.projectId}</span>
          {" · "}
          第 {episode.episodeNumber} 集
        </p>
      </div>
      <dl className="flex flex-wrap gap-6 text-right font-mono text-[11px] uppercase tracking-wide">
        <div>
          <dt className="text-[var(--color-muted)]">镜头（轨）</dt>
          <dd className="font-bold text-[var(--color-newsprint-black)]">
            {totalShotsOnTrack}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">已出片</dt>
          <dd className="font-bold text-[var(--color-newsprint-black)]">
            {playableShots}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">估算总长</dt>
          <dd className="font-bold text-[var(--color-primary)]">
            {formatTimeMmSs(estimatedTotalSec)}
          </dd>
        </div>
      </dl>
    </section>
  )
}
