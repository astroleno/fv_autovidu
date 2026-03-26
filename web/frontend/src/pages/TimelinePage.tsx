/**
 * 粗剪时间线页（Rough Cut Timeline）
 *
 * 布局与信息密度对齐原型：reference/frontend/stitch/timeline_newsprint/code.html
 * —— 基本信息条、大预览区、操作栏、多轨时间线（V1 视频 + 音轨占位）。
 *
 * 数据规则：
 * - 叙事顺序 = flattenShots（场景序 → 镜头序），不按全局 shotNumber 排序。
 * - 时间线展示「全部镜头」：已出片显示缩略图与时长；未出片显示 PENDING 占位。
 * - 预览仅支持已有 videoPath 的镜头；优先 selected 候选，否则第一条可播。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { useParams } from "react-router"
import { useEpisodeMediaCacheBust } from "@/hooks"
import { useEpisodeFileBasePath } from "@/hooks/useEpisodeFileBasePath"
import { useEpisodeStore } from "@/stores"
import {
  RoughCutActionBar,
  RoughCutActiveShotInfo,
  RoughCutMetaBar,
  RoughCutTimeline,
  RoughCutVideoPlayer,
  layoutDurationSec,
  type RoughCutTrackItem,
} from "@/components/roughcut"
import type { Episode, Shot, VideoCandidate } from "@/types"
import { flattenShots } from "@/types"
import { getFileUrl } from "@/utils/file"

/**
 * 从镜头中选出用于粗剪预览的候选：
 * - 仅考虑已有本地路径的候选（videoPath 非空）
 * - 优先 selected === true，否则取第一条可播
 */
function pickPlayableCandidate(shot: Shot): VideoCandidate | undefined {
  const withPath = shot.videoCandidates.filter((c) => (c.videoPath || "").trim())
  if (withPath.length === 0) return undefined
  const selected = withPath.find((c) => c.selected)
  return selected ?? withPath[0]
}

/**
 * 由整集构建时间线条目（含待出片占位）
 */
function buildTrackItems(episode: Episode): RoughCutTrackItem[] {
  const flat = flattenShots(episode)
  const out: RoughCutTrackItem[] = []
  for (const s of flat) {
    const cand = pickPlayableCandidate(s)
    const d = layoutDurationSec(s.duration)
    if (cand) {
      out.push({ kind: "clip", shot: s, candidate: cand, durationSec: d })
    } else {
      out.push({ kind: "pending", shot: s, durationSec: d })
    }
  }
  return out
}

export default function TimelinePage() {
  const { episodeId } = useParams<{ episodeId: string }>()
  const { currentEpisode, loading, fetchEpisodeDetail } = useEpisodeStore()
  const cacheBust = useEpisodeMediaCacheBust(currentEpisode?.pulledAt)
  const basePath = useEpisodeFileBasePath()

  /** 当前选中的镜头（可含 pending，用于轨道高亮） */
  const [activeShotId, setActiveShotId] = useState<string | null>(null)
  /** 当前预览片段内播放时间（秒），用于时间轴游标 */
  const [clipPlayheadSec, setClipPlayheadSec] = useState(0)

  useEffect(() => {
    if (episodeId) void fetchEpisodeDetail(episodeId)
  }, [episodeId, fetchEpisodeDetail])

  const trackItems = useMemo(
    () => (currentEpisode ? buildTrackItems(currentEpisode) : []),
    [currentEpisode]
  )

  const totalLayoutSec = useMemo(
    () => trackItems.reduce((a, it) => a + it.durationSec, 0),
    [trackItems]
  )

  const playableShotIds = useMemo(
    () => trackItems.filter((it): it is RoughCutTrackItem & { kind: "clip" } => it.kind === "clip").map((it) => it.shot.shotId),
    [trackItems]
  )

  /** 数据变化时：若当前选中 ID 仍存在于轨道则保留；否则回到第一个可预览镜头 */
  useEffect(() => {
    if (trackItems.length === 0) {
      setActiveShotId(null)
      return
    }
    setActiveShotId((prev) => {
      if (prev && trackItems.some((t) => t.shot.shotId === prev)) return prev
      return playableShotIds[0] ?? trackItems[0]?.shot.shotId ?? null
    })
  }, [trackItems, playableShotIds])

  const activeEntry = useMemo(
    () => trackItems.find((t) => t.shot.shotId === activeShotId),
    [trackItems, activeShotId]
  )

  const activeClip =
    activeEntry?.kind === "clip"
      ? { shot: activeEntry.shot, candidate: activeEntry.candidate }
      : undefined

  const previewUrl =
    activeClip && currentEpisode
      ? getFileUrl(activeClip.candidate.videoPath, basePath, cacheBust)
      : ""

  /** 仅在可播镜头间跳转 */
  const goAdjacent = useCallback(
    (delta: number) => {
      if (playableShotIds.length === 0) return
      const cur = activeShotId && playableShotIds.includes(activeShotId) ? activeShotId : playableShotIds[0]
      const i = playableShotIds.indexOf(cur!)
      if (i < 0) return
      const ni = Math.max(0, Math.min(playableShotIds.length - 1, i + delta))
      setActiveShotId(playableShotIds[ni]!)
      setClipPlayheadSec(0)
    },
    [playableShotIds, activeShotId]
  )

  const onTimeUpdate = useCallback((cur: number, _durationSec: number) => {
    setClipPlayheadSec(cur)
  }, [])

  /** 切换镜头时重置游标（视频会重新加载） */
  useEffect(() => {
    setClipPlayheadSec(0)
  }, [activeShotId])

  if (!episodeId || loading || !currentEpisode) {
    return (
      <div
        className="flex h-full min-h-[200px] items-center justify-center p-8 text-[var(--color-muted)] box-border"
        style={{ boxSizing: "border-box" }}
      >
        {loading ? "加载中..." : "未找到剧集"}
      </div>
    )
  }

  const playableCount = playableShotIds.length

  /**
   * 单屏强制布局（解决「flex-1 预览把轨道顶出视口」）：
   * - 整页高度 = 视口 − 顶栏（h-16），不依赖父级 h-full 是否生效
   * - CSS Grid：第 5 行「轨道区」用 minmax 预留 200px～min(40vh,360px)，永远留在本屏底部可见
   * - 第 3 行「预览+信息」仅吃剩余行高（minmax(0,1fr)），可内部滚动/裁切
   */
  const pageGridStyle: CSSProperties = {
    boxSizing: "border-box",
    height: "calc(100dvh - 4rem)",
    maxHeight: "calc(100dvh - 4rem)",
    display: "grid",
    gridTemplateColumns: "1fr",
    gridTemplateRows:
      "auto auto minmax(0, 1fr) auto minmax(200px, min(40vh, 360px))",
    overflow: "hidden",
  }

  return (
    <div
      className="box-border w-full gap-0 px-4 py-3 text-[var(--color-ink)] md:px-6 md:py-4"
      style={pageGridStyle}
    >
      <div className="min-h-0 min-w-0">
        <RoughCutMetaBar
          episode={currentEpisode}
          totalShotsOnTrack={trackItems.length}
          playableShots={playableCount}
          estimatedTotalSec={totalLayoutSec}
        />
      </div>

      <p className="mb-2 max-w-3xl text-xs leading-snug text-[var(--color-muted)]">
        叙事顺序排列；已出片显示首帧与时长，未出片为 <strong>Pending</strong>。点击轨道切换预览。
      </p>

      {/**
       * 第 3 行：左侧预览 + 右侧「镜头详情」面板（大屏并排；小屏先预览、详情在下方并限高）
       */}
      <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden lg:min-h-0 lg:flex-row lg:gap-3">
        <section
          className="flex min-h-[200px] min-w-0 flex-1 flex-col overflow-hidden border border-[var(--color-newsprint-black)] bg-black box-border lg:min-h-0"
          style={{ boxSizing: "border-box" }}
        >
          {previewUrl ? (
            <RoughCutVideoPlayer
              src={previewUrl}
              onPrevClip={() => goAdjacent(-1)}
              onNextClip={() => goAdjacent(1)}
              disablePrev={
                playableShotIds.length === 0 ||
                (activeShotId != null && playableShotIds.indexOf(activeShotId) <= 0)
              }
              disableNext={
                playableShotIds.length === 0 ||
                (activeShotId != null &&
                  playableShotIds.indexOf(activeShotId) >= playableShotIds.length - 1)
              }
              onTimeUpdate={onTimeUpdate}
              className="h-full min-h-0 w-full"
            />
          ) : (
            <div
              className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[var(--color-muted)] box-border"
              style={{ boxSizing: "border-box" }}
            >
              <span className="font-bold text-[var(--color-ink)]">
                {activeEntry?.kind === "pending" ? "该镜头尚未出片" : "暂无可预览视频"}
              </span>
              <span className="max-w-md text-xs">
                请在分镜板完成视频任务并确保本地{" "}
                <code className="text-xs bg-white px-1">videos/</code> 已有文件。
              </span>
            </div>
          )}
        </section>

        <div
          className="box-border flex h-auto max-h-[min(38vh,320px)] min-h-[160px] w-full shrink-0 flex-col overflow-hidden lg:h-full lg:max-h-none lg:min-h-0 lg:w-[min(400px,38vw)] lg:max-w-[440px]"
          style={{ boxSizing: "border-box" }}
        >
          <RoughCutActiveShotInfo
            shot={activeEntry?.shot ?? null}
            basePath={basePath}
            cacheBust={cacheBust}
          />
        </div>
      </div>

      <div className="min-h-0">
        <RoughCutActionBar episodeId={episodeId} exportDisabled={playableCount === 0} />
      </div>

      {/* 第 5 行：轨道固定在视口底部一格内，内部再滚动 */}
      <div
        className="box-border flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
        style={{ boxSizing: "border-box" }}
      >
        <RoughCutTimeline
          basePath={basePath}
          cacheBust={cacheBust}
          items={trackItems}
          activeShotId={activeShotId}
          onSelectShot={setActiveShotId}
          totalLayoutSec={totalLayoutSec}
          playheadSec={activeEntry?.kind === "clip" ? clipPlayheadSec : 0}
        />
      </div>
    </div>
  )
}
