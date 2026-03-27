/**
 * ShotDurationCell — 镜头时长（秒）
 *
 * ## 分镜表交互
 * - 与「画面描述 / 提示词」列一致：**默认显示纯文案**「N秒」，无边框；**点击后**出现带主色描边的输入框，失焦保存，Enter 同失焦，Esc 取消。
 *
 * ## 镜头详情页
 * - 同一套预览/编辑逻辑，可传入 `className` 覆盖预览文字色（如 `text-[var(--color-ink)]`）。
 *
 * ## 与视频生成的关系
 * - 后端 `POST /generate/video` 若未带 `duration`，使用 `shot.duration`（见服务端 generate 路由）。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { Shot } from "@/types"
import {
  STORYBOARD_TABLE_INLINE_EDIT_INPUT_CLASS,
  STORYBOARD_TABLE_PREVIEW_SHORT_CLASS,
} from "@/components/business/storyboardFieldClasses"

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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(shot.duration))
  const [saving, setSaving] = useState(false)
  const ignoreBlurSaveRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(String(shot.duration))
  }, [shot.duration, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = useCallback(async () => {
    const trimmed = draft.trim()
    if (trimmed === "") {
      setDraft(String(shot.duration))
      setEditing(false)
      return
    }
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isNaN(parsed)) {
      setDraft(String(shot.duration))
      setEditing(false)
      return
    }
    const next = clampDuration(parsed)
    setDraft(String(next))
    setEditing(false)
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

  const onBlur = () => {
    if (ignoreBlurSaveRef.current) {
      ignoreBlurSaveRef.current = false
      return
    }
    void commit()
  }

  const cancelEdit = () => {
    ignoreBlurSaveRef.current = true
    setDraft(String(shot.duration))
    setEditing(false)
  }

  const previewLabel = `${shot.duration}秒`

  return (
    <span className="inline-flex max-w-full min-w-0 align-middle overflow-visible">
      {!editing ? (
        <button
          type="button"
          disabled={saving}
          title="点击编辑时长（秒）；写入 episode.json，供视频生成默认秒数"
          aria-label={`镜头时长 ${previewLabel}，点击编辑`}
          className={`${STORYBOARD_TABLE_PREVIEW_SHORT_CLASS} ${className}`.trim()}
          onClick={() => {
            ignoreBlurSaveRef.current = false
            setDraft(String(shot.duration))
            setEditing(true)
          }}
        >
          {previewLabel}
        </button>
      ) : (
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={draft}
          disabled={saving}
          aria-label="编辑镜头时长（秒）"
          className={`${STORYBOARD_TABLE_INLINE_EDIT_INPUT_CLASS} ${className}`.trim()}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              inputRef.current?.blur()
            }
            if (e.key === "Escape") {
              e.preventDefault()
              cancelEdit()
            }
          }}
        />
      )}
    </span>
  )
}
