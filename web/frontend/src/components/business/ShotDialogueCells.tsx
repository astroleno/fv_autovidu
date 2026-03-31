/**
 * ShotDialogueCells — 分镜列表「台词原文」「译文」两列
 *
 * ## 交互（与 ShotPromptCells 一致）
 * - **默认**：无边框，显示与画面描述列相同的弱化纯文案（空则「-」）；悬浮显示全文浮层；点击后进入编辑。
 * - **编辑**：当前列显示带主色描边的 textarea，失焦保存；Shift+Enter 换行、Enter 保存并关闭、Esc 取消。
 *
 * ## 数据
 * - `Shot.dialogue`、`Shot.dialogueTranslation` 经 `updateShot` PATCH 写入 episode.json。
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { Shot } from "@/types"
import {
  STORYBOARD_TABLE_INLINE_EDIT_TEXTAREA_CLASS,
  STORYBOARD_TABLE_PREVIEW_BUTTON_CLASS,
} from "@/components/business/storyboardFieldClasses"

const MIN_TEXTAREA_HEIGHT_PX = 72
const MAX_TEXTAREA_HEIGHT_PX = 480

export type DialogueShotUpdates = Partial<
  Pick<Shot, "dialogue" | "dialogueTranslation">
>

export interface ShotDialogueCellsProps {
  shot: Shot
  episodeId: string
  updateShot: (
    episodeId: string,
    shotId: string,
    updates: DialogueShotUpdates
  ) => Promise<void>
  /** 与提示词列一致的预览截断长度 */
  maxPreviewLen?: number
}

type EditingCol = "dialogue" | "translation" | null

const COL_LABEL: Record<Exclude<EditingCol, null>, string> = {
  dialogue: "台词原文",
  translation: "译文",
}

/**
 * 分镜「台词原文」展示用：优先 `dialogue`；为空时用 `associatedDialogue` 拼一行（与 puller 落盘规则一致）。
 * 解决平台仅下发结构化对白、或旧 episode.json 未写入顶层 dialogue 时整列空白的问题。
 */
export function effectiveDialogueLineForStoryboard(shot: Shot): string {
  const raw = (shot.dialogue ?? "").trim()
  if (raw) return shot.dialogue ?? ""
  const ad = shot.associatedDialogue
  if (!ad) return ""
  const role = (ad.role ?? "").trim()
  const content = (ad.content ?? "").trim()
  if (role && content) return `${role}：${content}`
  return content
}

export function ShotDialogueCells({
  shot,
  episodeId,
  updateShot,
  maxPreviewLen = 40,
}: ShotDialogueCellsProps) {
  const [editing, setEditing] = useState<EditingCol>(null)
  const [editDraft, setEditDraft] = useState("")
  const [hoverCol, setHoverCol] = useState<Exclude<EditingCol, null> | null>(
    null
  )
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const ignoreBlurSaveRef = useRef(false)

  const dialogueValue = effectiveDialogueLineForStoryboard(shot)
  const translationValue = shot.dialogueTranslation ?? ""

  const beginEdit = (col: Exclude<EditingCol, null>) => {
    ignoreBlurSaveRef.current = false
    setEditing(col)
    setEditDraft(col === "dialogue" ? dialogueValue : translationValue)
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

  const finishEdit = useCallback(async () => {
    if (!editing) return
    if (ignoreBlurSaveRef.current) {
      ignoreBlurSaveRef.current = false
      return
    }
    const col = editing
    setEditing(null)
    const trimmed = editDraft.trim()
    const prev =
      col === "dialogue"
        ? dialogueValue.trim()
        : translationValue.trim()
    if (trimmed === prev) return
    setSaving(true)
    try {
      if (col === "dialogue") {
        await updateShot(episodeId, shot.shotId, { dialogue: trimmed })
      } else {
        await updateShot(episodeId, shot.shotId, {
          dialogueTranslation: trimmed,
        })
      }
    } finally {
      setSaving(false)
    }
  }, [
    dialogueValue,
    editDraft,
    editing,
    episodeId,
    shot.shotId,
    translationValue,
    updateShot,
  ])

  const cancelEdit = () => {
    if (!editing) return
    ignoreBlurSaveRef.current = true
    setEditDraft(editing === "dialogue" ? dialogueValue : translationValue)
    setEditing(null)
  }

  const renderPreviewTd = (col: Exclude<EditingCol, null>) => {
    const value = col === "dialogue" ? dialogueValue : translationValue
    const displayText = value.trim() ? value : "-"
    const truncated =
      displayText.length > maxPreviewLen
        ? displayText.slice(0, maxPreviewLen) + "…"
        : displayText

    return (
      <td
        className="py-3 px-4 align-top min-w-0 box-border text-xs text-[var(--color-muted)] relative overflow-visible"
        style={{ boxSizing: "border-box" }}
        onMouseEnter={() => setHoverCol(col)}
        onMouseLeave={() => setHoverCol(null)}
      >
        <span className="sr-only">
          {COL_LABEL[col]} S{String(shot.shotNumber).padStart(2, "0")}
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={() => beginEdit(col)}
          className={STORYBOARD_TABLE_PREVIEW_BUTTON_CLASS}
          aria-label={`${COL_LABEL[col]} 镜头${shot.shotNumber}，点击编辑`}
        >
          {truncated}
        </button>
        {hoverCol === col && (
          <div
            className="absolute z-50 left-0 top-full mt-1 min-w-[220px] max-w-[360px] p-3 bg-[var(--color-newsprint-off-white)] border-2 border-[var(--color-newsprint-black)] shadow-[4px_4px_0px_0px_#111111] max-h-[200px] overflow-y-auto"
            role="tooltip"
            style={{ boxSizing: "border-box" }}
          >
            <p className="text-[10px] font-black uppercase text-[var(--color-muted)] mb-1">
              {COL_LABEL[col]}
            </p>
            <p className="text-xs text-[var(--color-ink)] whitespace-pre-wrap leading-relaxed">
              {value.trim() ? value : "暂无内容"}
            </p>
            <p className="text-[10px] text-[var(--color-muted)] mt-2">
              点击可编辑 · 失焦保存
            </p>
          </div>
        )}
      </td>
    )
  }

  const renderEditTd = (col: Exclude<EditingCol, null>) => (
    <td
      className="py-3 px-4 align-top min-w-0 box-border bg-[var(--color-divider)]/30 overflow-visible"
      style={{ boxSizing: "border-box" }}
    >
      <div className="flex flex-col gap-2 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] font-black uppercase text-[var(--color-newsprint-black)]">
            编辑：{COL_LABEL[col]}
          </span>
          {saving && (
            <span className="text-[10px] text-[var(--color-muted)]">
              保存中…
            </span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          onBlur={() => void finishEdit()}
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
          style={{
            boxSizing: "border-box",
            minHeight: MIN_TEXTAREA_HEIGHT_PX,
          }}
          rows={3}
          aria-label={`${COL_LABEL[col]} 镜头${shot.shotNumber}`}
        />
        <p className="text-[10px] text-[var(--color-muted)]">
          Shift+Enter 换行 · Enter 保存并关闭 · Esc 取消
        </p>
      </div>
    </td>
  )

  if (editing === "dialogue") {
    return (
      <>
        {renderEditTd("dialogue")}
        {renderPreviewTd("translation")}
      </>
    )
  }

  if (editing === "translation") {
    return (
      <>
        {renderPreviewTd("dialogue")}
        {renderEditTd("translation")}
      </>
    )
  }

  return (
    <>
      {renderPreviewTd("dialogue")}
      {renderPreviewTd("translation")}
    </>
  )
}
