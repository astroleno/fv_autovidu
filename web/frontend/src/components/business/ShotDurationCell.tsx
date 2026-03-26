/**
 * ShotDurationCell — 镜头时长（秒）可编辑单元
 *
 * 用途：
 * - 分镜表 `ShotRow`「时长」列：紧凑 number 输入，失焦保存。
 * - 镜头详情页元信息区：与运镜、画幅并列展示。
 *
 * 与视频生成的关系：
 * - 后端 `POST /generate/video` 若请求体 **未** 带 `duration`，则使用 `shot.duration`
 *   （见 `generate.py`：`resolved_duration = duration if duration is not None else shot.duration`）。
 * - 因此在此修改并 PATCH 成功后，后续批量/选片「再生成」会自动按新秒数提交 Vidu，
 *   无需前端在每次 `generateApi.video` 里重复传 `duration`（除非将来要做「单次覆盖」）。
 */
import { useCallback, useEffect, useState } from "react"
import type { Shot } from "@/types"

/** 与 Vidu 常见片段长度兼容；过短/过长易触发接口校验失败，故做夹取 */
const MIN_SEC = 1
const MAX_SEC = 60

export interface ShotDurationCellProps {
  shot: Shot
  episodeId: string
  updateShot: (
    episodeId: string,
    shotId: string,
    updates: Partial<Pick<Shot, "duration">>
  ) => Promise<void>
  /** 外层容器 class，用于分镜表 td 内紧凑布局 */
  className?: string
}

function clampDuration(n: number): number {
  if (!Number.isFinite(n)) return MIN_SEC
  return Math.min(MAX_SEC, Math.max(MIN_SEC, Math.round(n)))
}

export function ShotDurationCell({
  shot,
  episodeId,
  updateShot,
  className = "",
}: ShotDurationCellProps) {
  /** 受控输入字符串，允许中间态（如空、负号）仅在失焦时规范化 */
  const [draft, setDraft] = useState(String(shot.duration))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(String(shot.duration))
  }, [shot.duration])

  const commit = useCallback(async () => {
    const trimmed = draft.trim()
    if (trimmed === "") {
      setDraft(String(shot.duration))
      return
    }
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isNaN(parsed)) {
      setDraft(String(shot.duration))
      return
    }
    const next = clampDuration(parsed)
    setDraft(String(next))
    if (next === shot.duration) return
    setSaving(true)
    try {
      await updateShot(episodeId, shot.shotId, { duration: next })
    } catch {
      setDraft(String(shot.duration))
    } finally {
      setSaving(false)
    }
  }, [draft, episodeId, shot.duration, shot.shotId, updateShot])

  return (
    <div
      className={`inline-flex items-center gap-1 flex-wrap box-border ${className}`}
      style={{ boxSizing: "border-box" }}
    >
      <label className="sr-only" htmlFor={`shot-dur-${shot.shotId}`}>
        时长（秒）
      </label>
      <input
        id={`shot-dur-${shot.shotId}`}
        type="number"
        min={MIN_SEC}
        max={MAX_SEC}
        step={1}
        value={draft}
        disabled={saving}
        title="写入 episode.json；未在单次生成请求里指定 duration 时，后端用此值作为 Vidu 视频时长（秒）"
        aria-label="镜头时长（秒）"
        className="w-14 min-w-0 rounded-sm border border-[var(--color-newsprint-black)] bg-white px-2 py-1 text-sm font-mono tabular-nums text-[var(--color-ink)] box-border disabled:opacity-60"
        style={{ boxSizing: "border-box" }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      <span className="text-sm text-[var(--color-muted)]">s</span>
    </div>
  )
}
