/**
 * 粗剪台 — 时间线区域（对齐原型：Tracks 角标、时间标尺、V1 视频轨、A1/A2 音轨占位）
 * - V1：已出片镜头显示首帧缩略图 + SHOT 编号 + 时长；未出片为虚线 PENDING
 * - 镜头之间：使用细竖线分隔（剪映式），不使用 ⚡ emoji 占位，避免「假功能」观感
 * - 音轨：当前无后端数据，展示占位与「暂无音轨」
 */
import { useCallback, useRef, type PointerEvent } from "react"
import type { Shot, VideoCandidate } from "@/types"
import { getFileUrl } from "@/utils/file"
import {
  buildRulerTicks,
  formatTimeHhMmSs,
  formatTimeMmSs,
  timelinePercentFromClientX,
} from "./roughcutUtils"

/** 时间线上的单条叙事单元：要么可播片段，要么待生成占位 */
export type RoughCutTrackItem =
  | { kind: "clip"; shot: Shot; candidate: VideoCandidate; durationSec: number }
  | { kind: "pending"; shot: Shot; durationSec: number }

export interface RoughCutTimelineProps {
  basePath: string
  cacheBust?: string
  items: RoughCutTrackItem[]
  activeShotId: string | null
  onSelectShot: (shotId: string) => void
  /** 绿色播放头拖拽 seek 到整条粗剪时间上的某一点 */
  onSeek?: (globalTimeSec: number) => void
  /** 叙事总时长（用于标尺与游标比例） */
  totalLayoutSec: number
  /** 当前播放头在整条叙事时间上的位置（秒），由预览播放器回调 */
  playheadSec: number
}

const TRACK_LABEL_W = "w-[180px]"

/**
 * 计算播放头在轨道上的水平百分比位置
 */
function playheadPercent(items: RoughCutTrackItem[], activeShotId: string | null, playheadSec: number, total: number): number {
  if (total <= 0) return 0
  let offset = 0
  for (const it of items) {
    const id = it.shot.shotId
    const len = it.durationSec
    if (id === activeShotId) {
      const p = offset + Math.min(Math.max(playheadSec, 0), len)
      return (p / total) * 100
    }
    offset += len
  }
  return 0
}

export function RoughCutTimeline({
  basePath,
  cacheBust,
  items,
  activeShotId,
  onSelectShot,
  onSeek,
  totalLayoutSec,
  playheadSec,
}: RoughCutTimelineProps) {
  const ticks = buildRulerTicks(totalLayoutSec)
  const headPct = playheadPercent(items, activeShotId, playheadSec, totalLayoutSec)
  const laneRef = useRef<HTMLDivElement>(null)

  const seekFromClientX = useCallback((clientX: number) => {
    if (!onSeek || totalLayoutSec <= 0) return
    const rect = laneRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const percent = timelinePercentFromClientX(clientX, rect)
    onSeek((percent / 100) * totalLayoutSec)
  }, [onSeek, totalLayoutSec])

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden border border-[var(--color-newsprint-black)] border-t-0 bg-[var(--color-newsprint-off-white)] bg-[length:200px_200px] select-none box-border"
      style={{
        boxSizing: "border-box",
        backgroundImage:
          "linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px)",
      }}
    >
      {/* 标尺行 */}
      <div className="flex border-b border-[var(--color-newsprint-black)]">
        <div
          className={`${TRACK_LABEL_W} flex shrink-0 items-center border-r border-[var(--color-newsprint-black)] bg-white px-4 py-2 box-border`}
          style={{ boxSizing: "border-box" }}
        >
          <span className="text-[10px] font-bold uppercase tracking-widest font-mono text-[var(--color-newsprint-black)]">
            Tracks
          </span>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto bg-white">
          <div className="flex h-8 min-w-full items-center gap-0 border-b border-[var(--color-newsprint-black)] px-2">
            <div className="flex w-full justify-between pr-2 text-[10px] font-mono font-bold text-[var(--color-newsprint-black)]">
              {ticks.map((t) => (
                <span key={t} className="shrink-0">
                  {formatTimeHhMmSs(t)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-auto">
        <div
          ref={laneRef}
          className="pointer-events-none absolute bottom-0 left-[180px] right-0 top-0"
          aria-hidden
        />
        {/* 全局播放头：与 V1 + 音轨纵向对齐 */}
        <PlayheadLine leftPercent={headPct} onSeek={seekFromClientX} />

        {/* V1 视频轨 */}
        <div className="flex min-h-[5rem] border-b border-[var(--color-newsprint-black)] bg-white/60">
          <TrackSidebar
            title="V1_VIDEO"
            subtitle="Active"
            icon="🎬"
          />
          <div className="relative min-w-0 flex-1 p-0">
            <div className="flex min-h-[4.5rem] w-full min-w-0 items-stretch px-1 py-2">
              {items.length === 0 ? (
                <span className="px-2 text-xs text-[var(--color-muted)]">暂无镜头数据</span>
              ) : (
                items.map((it, idx) => {
                  const grow = Math.max(it.durationSec, 0.1)
                  const shot = it.shot
                  const isActive = shot.shotId === activeShotId
                  const flexStyle = { flexGrow: grow, flexShrink: 1, flexBasis: 0, minWidth: 72 } as const

                  if (it.kind === "pending") {
                    return (
                      <div key={shot.shotId} className="flex min-w-0 items-stretch" style={flexStyle}>
                        {idx > 0 ? (
                          <ClipSeparator />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onSelectShot(shot.shotId)}
                          className={`flex h-14 w-full min-w-0 flex-col items-center justify-center border border-dashed border-[var(--color-newsprint-black)] bg-white/40 px-1 text-center transition-colors hover:bg-white/80 box-border ${
                            isActive ? "ring-2 ring-[var(--color-primary)]" : ""
                          }`}
                          style={{ boxSizing: "border-box" }}
                        >
                          <span className="text-[9px] font-bold font-mono uppercase text-[var(--color-newsprint-black)]">
                            SHOT_{String(shot.shotNumber).padStart(2, "0")}
                          </span>
                          <span className="text-[8px] font-bold uppercase tracking-widest text-[var(--color-muted)]">
                            Pending
                          </span>
                        </button>
                      </div>
                    )
                  }
                  const thumb = shot.firstFrame
                    ? getFileUrl(shot.firstFrame, basePath, cacheBust)
                    : ""
                  return (
                    <div key={shot.shotId} className="flex min-w-0 items-stretch" style={flexStyle}>
                      {idx > 0 ? (
                        <ClipSeparator />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onSelectShot(shot.shotId)}
                        className={`relative h-14 w-full min-w-0 overflow-hidden border bg-white text-left transition-colors box-border ${
                          isActive
                            ? "border-2 border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_12%,white)]"
                            : "border-[var(--color-newsprint-black)] hover:bg-black/5"
                        }`}
                        style={{ boxSizing: "border-box" }}
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt=""
                            className="h-full w-full object-cover opacity-50 grayscale"
                          />
                        ) : (
                          <div className="h-full w-full bg-[var(--color-outline-variant)]" />
                        )}
                        <div className="absolute inset-0 flex flex-col justify-between p-1.5">
                          <div className="flex items-start justify-between gap-1">
                            <span
                              className={`px-1 font-mono text-[9px] font-bold uppercase text-white ${
                                isActive ? "bg-[var(--color-primary)]" : "bg-[var(--color-newsprint-black)]"
                              }`}
                            >
                              SHOT_{String(shot.shotNumber).padStart(2, "0")}
                            </span>
                            <span className="border border-[var(--color-newsprint-black)] bg-white px-1 font-mono text-[9px] font-bold text-[var(--color-newsprint-black)]">
                              {formatTimeMmSs(it.durationSec)}
                            </span>
                          </div>
                        </div>
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/**
         * 音轨说明（避免写「后续版本」）：BGM 本应用未做剧集级时间线挂载；
         * STS/配音已在分镜板 DubPanel（ElevenLabs）提供，与粗剪导出为两条能力。
         */}
        <AudioPlaceholderRow
          label="A1_BGM"
          icon="♪"
          message="暂无剧集级背景音乐轨；精剪时可在剪映等工具中添加 BGM。"
        />
        <AudioPlaceholderRow
          label="A2_STS/VO"
          icon="🎙"
          message="STS 换声 / TTS 已在分镜板镜头「配音」中配置；本轨为粗剪占位，成片以分镜导出为准。"
        />
      </div>
    </section>
  )
}

/**
 * 镜头块之间的分隔：剪映类产品多为细线或微缝，不用图标块占位。
 * 使用 2px 浅竖线贯穿当前行高，避免抢戏。
 */
function ClipSeparator() {
  return (
    <div
      className="z-10 w-[2px] shrink-0 self-stretch bg-[var(--color-outline-variant)]"
      aria-hidden
    />
  )
}

/** 播放头：左侧固定 180px 轨道标题宽度 + 剩余宽度 * 百分比；支持拖拽 seek。 */
function PlayheadLine({
  leftPercent,
  onSeek,
}: {
  leftPercent: number
  onSeek?: (clientX: number) => void
}) {
  const x = (leftPercent / 100).toFixed(4)

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return
    e.preventDefault()
    onSeek(e.clientX)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!onSeek || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    onSeek(e.clientX)
  }

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return
    onSeek(e.clientX)
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={`absolute bottom-0 top-0 z-40 flex w-5 -translate-x-1/2 flex-col items-center ${
        onSeek ? "cursor-ew-resize touch-none" : "pointer-events-none"
      }`}
      style={{
        left: `calc(180px + (100% - 180px) * ${x})`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* 顶部三角指示（与常见 NLE 播放头一致） */}
      <div
        className="border-x-[6px] border-x-transparent border-t-[7px] border-t-[var(--color-primary)]"
        style={{ boxSizing: "border-box" }}
        aria-hidden
      />
      <div
        className="min-h-0 w-[3px] flex-1 bg-[var(--color-primary)] shadow-[1px_0_0_rgba(17,17,17,0.15)]"
        style={{ boxSizing: "border-box" }}
      />
    </div>
  )
}

function TrackSidebar({
  title,
  subtitle,
  icon,
}: {
  title: string
  subtitle: string
  icon: string
}) {
  return (
    <div
      className={`${TRACK_LABEL_W} sticky left-0 z-30 flex shrink-0 flex-col justify-between border-r border-[var(--color-newsprint-black)] bg-white p-3 box-border`}
      style={{ boxSizing: "border-box" }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[10px] font-bold uppercase text-[var(--color-newsprint-black)]">
          {title}
        </span>
        <div className="flex">
          <span className="flex h-6 w-6 items-center justify-center border border-[var(--color-newsprint-black)] text-[10px] font-bold">
            M
          </span>
          <span className="flex h-6 w-6 items-center justify-center border border-y border-r border-[var(--color-newsprint-black)] text-[10px] font-bold">
            S
          </span>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1 text-[8px] font-mono uppercase text-[var(--color-muted)]">
        <span aria-hidden>{icon}</span>
        <span>{subtitle}</span>
      </div>
    </div>
  )
}

function AudioPlaceholderRow({ label, icon, message }: { label: string; icon: string; message: string }) {
  return (
    <div className="flex min-h-[3.5rem] border-b border-[var(--color-newsprint-black)] bg-white/50">
      <div
        className={`${TRACK_LABEL_W} sticky left-0 z-30 flex shrink-0 flex-col justify-between border-r border-[var(--color-newsprint-black)] bg-white p-3 box-border`}
        style={{ boxSizing: "border-box" }}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] font-bold uppercase text-[var(--color-newsprint-black)]">
            {label}
          </span>
          <div className="flex">
            <span className="flex h-6 w-6 items-center justify-center border border-[var(--color-newsprint-black)] text-[10px] font-bold">
              M
            </span>
            <span className="flex h-6 w-6 items-center justify-center border border-y border-r border-[var(--color-newsprint-black)] text-[10px] font-bold">
              S
            </span>
          </div>
        </div>
        <span className="text-xs" aria-hidden>
          {icon}
        </span>
      </div>
      <div className="flex flex-1 items-center px-4 py-2">
        <div
          className="flex h-10 w-full items-center border border-dashed border-[var(--color-newsprint-black)]/40 bg-white/60 px-2 text-[10px] text-[var(--color-muted)] box-border"
          style={{ boxSizing: "border-box" }}
        >
          {message}
        </div>
      </div>
    </div>
  )
}
