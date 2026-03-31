/**
 * ShotPromptCells
 * 分镜表一行中的「画面描述 | 图片提示词 | 视频提示词」三列。
 * - 预览：三格独立，**最多 5 行**、高度与首尾帧缩略图（7.5rem）对齐；超出省略号；悬浮可看全文
 * - 编辑：合并为一格 colSpan=3，textarea 按内容自适应宽高
 */
import { useState, useRef, useLayoutEffect, useCallback } from "react"
import type { Shot } from "@/types"
import {
  STORYBOARD_TABLE_INLINE_EDIT_TEXTAREA_CLASS,
  STORYBOARD_TABLE_PREVIEW_PROMPT_BUTTON_CLASS,
  STORYBOARD_TABLE_PREVIEW_PROMPT_CLIPPED_TEXT_CLASS,
} from "@/components/business/storyboardFieldClasses"

export type PromptFieldKey = "visualDescription" | "imagePrompt" | "videoPrompt"

const FIELD_LABEL: Record<PromptFieldKey, string> = {
  visualDescription: "画面描述",
  imagePrompt: "图片提示词",
  videoPrompt: "视频提示词",
}

const MAX_TEXTAREA_HEIGHT_PX = 480
const MIN_TEXTAREA_HEIGHT_PX = 72
/** 单行最长字符数用于估算宽度（上限避免过宽） */
const MAX_CH_WIDTH = 88
const MIN_CH_WIDTH = 28

interface ShotPromptCellsProps {
  shot: Shot
  episodeId: string
  updateShot: (
    episodeId: string,
    shotId: string,
    updates: Partial<Record<PromptFieldKey, string>>
  ) => Promise<void>
}

function getFieldValue(shot: Shot, key: PromptFieldKey): string {
  if (key === "visualDescription") return shot.visualDescription ?? ""
  if (key === "imagePrompt") return shot.imagePrompt ?? ""
  return shot.videoPrompt ?? ""
}

/** 根据文本估算 textarea 宽度（ch），在 colSpan=3 的单元格内使用 */
function estimateWidthCh(text: string): number {
  const lines = text.split("\n")
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0)
  const ch = Math.max(MIN_CH_WIDTH, Math.min(maxLen + 2, MAX_CH_WIDTH))
  return ch
}

export function ShotPromptCells({
  shot,
  episodeId,
  updateShot,
}: ShotPromptCellsProps) {
  const [editing, setEditing] = useState<PromptFieldKey | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [hoverKey, setHoverKey] = useState<PromptFieldKey | null>(null)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Esc 取消时忽略紧随其后的 blur，避免误保存 */
  const ignoreBlurSaveRef = useRef(false)

  const beginEdit = (key: PromptFieldKey) => {
    ignoreBlurSaveRef.current = false
    setEditing(key)
    setEditDraft(getFieldValue(shot, key))
  }

  const syncTextareaSize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const h = Math.min(
      Math.max(el.scrollHeight, MIN_TEXTAREA_HEIGHT_PX),
      MAX_TEXTAREA_HEIGHT_PX
    )
    el.style.height = `${h}px`
    const ch = estimateWidthCh(el.value)
    el.style.width = `min(100%, ${ch}ch)`
    el.style.boxSizing = "border-box"
  }, [])

  useLayoutEffect(() => {
    if (editing) {
      syncTextareaSize()
      textareaRef.current?.focus()
      textareaRef.current?.select()
    }
  }, [editing, syncTextareaSize])

  useLayoutEffect(() => {
    if (editing) syncTextareaSize()
  }, [editDraft, editing, syncTextareaSize])

  const finishEdit = async () => {
    if (!editing) return
    if (ignoreBlurSaveRef.current) {
      ignoreBlurSaveRef.current = false
      return
    }
    const key = editing
    setEditing(null)
    const trimmed = editDraft.trim()
    const prev = getFieldValue(shot, key).trim()
    if (trimmed === prev) return
    setSaving(true)
    try {
      await updateShot(episodeId, shot.shotId, { [key]: trimmed })
    } finally {
      setSaving(false)
    }
  }

  const cancelEdit = () => {
    if (!editing) return
    ignoreBlurSaveRef.current = true
    setEditDraft(getFieldValue(shot, editing))
    setEditing(null)
  }

  const renderPreviewTd = (key: PromptFieldKey) => {
    const value = getFieldValue(shot, key)
    /** 空字段仍显示「-」，与台词列一致 */
    const displayText = value || "-"

    return (
      <td
        key={key}
        className="py-3 px-4 text-xs text-[var(--color-muted)] min-w-0 align-top relative overflow-visible"
        style={{ boxSizing: "border-box" }}
        onMouseEnter={() => setHoverKey(key)}
        onMouseLeave={() => setHoverKey(null)}
      >
        <button
          type="button"
          data-prompt-preview
          onClick={() => beginEdit(key)}
          className={STORYBOARD_TABLE_PREVIEW_PROMPT_BUTTON_CLASS}
        >
          <span className={STORYBOARD_TABLE_PREVIEW_PROMPT_CLIPPED_TEXT_CLASS}>
            {displayText}
          </span>
        </button>
        {hoverKey === key && (
          <div
            className="absolute z-50 left-0 top-full mt-1 min-w-[220px] max-w-[360px] p-3 bg-[var(--color-newsprint-off-white)] border-2 border-[var(--color-newsprint-black)] shadow-[4px_4px_0px_0px_#111111] max-h-[200px] overflow-y-auto"
            role="tooltip"
            style={{ boxSizing: "border-box" }}
          >
            <p className="text-[10px] font-black uppercase text-[var(--color-muted)] mb-1">
              {FIELD_LABEL[key]}
            </p>
            <p className="text-xs text-[var(--color-ink)] whitespace-pre-wrap leading-relaxed">
              {value || "暂无内容"}
            </p>
            <p className="text-[10px] text-[var(--color-muted)] mt-2">点击可编辑 · 失焦保存</p>
          </div>
        )}
      </td>
    )
  }

  if (editing) {
    return (
      <td
        colSpan={3}
        className="py-3 px-4 align-top min-w-0 bg-[var(--color-divider)]/30 overflow-visible"
        style={{ boxSizing: "border-box" }}
      >
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-black uppercase text-[var(--color-newsprint-black)]">
              编辑：{FIELD_LABEL[editing]}
            </span>
            {saving && (
              <span className="text-[10px] text-[var(--color-muted)]">保存中…</span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onBlur={finishEdit}
            onInput={syncTextareaSize}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                ;(e.target as HTMLTextAreaElement).blur()
              }
              if (e.key === "Escape") {
                e.preventDefault()
                cancelEdit()
              }
            }}
            className={STORYBOARD_TABLE_INLINE_EDIT_TEXTAREA_CLASS}
            style={{ boxSizing: "border-box", minHeight: MIN_TEXTAREA_HEIGHT_PX }}
            rows={1}
            aria-label={FIELD_LABEL[editing]}
          />
          <p className="text-[10px] text-[var(--color-muted)]">
            Shift+Enter 换行 · Enter 保存并关闭 · Esc 取消
          </p>
        </div>
      </td>
    )
  }

  return (
    <>
      {renderPreviewTd("visualDescription")}
      {renderPreviewTd("imagePrompt")}
      {renderPreviewTd("videoPrompt")}
    </>
  )
}
