/**
 * ShotDialogueCells — 分镜列表行内「台词原文」与「译文」两列
 *
 * ## 职责
 * - 与 episode.json 中 Shot.dialogue（平台拉取的原文台词）及 Shot.dialogueTranslation（本地编辑的目标语译文）双向绑定。
 * - 采用受控 textarea：本地 draft 与 props 同步，避免父级刷新后界面陈旧。
 *
 * ## 保存策略
 * - 失焦（onBlur）时比较 trim 后的内容与当前 shot 是否一致；仅在有变更时调用 `updateShot` 发起 PATCH。
 * - 与 ShotPromptCells 一致：避免无意义的网络请求与写盘。
 *
 * ## 布局
 * - 本组件返回 **两个** `<td>`（React Fragment），须插在 `<ShotPromptCells />` 之前，以与表头「状态 → 台词原文 → 译文 → 画面描述…」一致。
 *
 * ## 样式
 * - 凡含 padding 的节点均显式 `box-sizing: border-box`，避免表格单元格宽度计算偏差。
 */
import { useCallback, useEffect, useState } from "react"
import type { Shot } from "@/types"

/** 与 episodeStore.updateShot 兼容的台词字段子集 */
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
}

export function ShotDialogueCells({
  shot,
  episodeId,
  updateShot,
}: ShotDialogueCellsProps) {
  const [dialogueDraft, setDialogueDraft] = useState(
    () => shot.dialogue ?? ""
  )
  const [translationDraft, setTranslationDraft] = useState(
    () => shot.dialogueTranslation ?? ""
  )
  const [saving, setSaving] = useState<"dialogue" | "translation" | null>(null)

  // 父级在 PATCH 成功后合并 shot；此处跟随 props 更新草稿，避免光标外内容不同步
  useEffect(() => {
    setDialogueDraft(shot.dialogue ?? "")
  }, [shot.shotId, shot.dialogue])

  useEffect(() => {
    setTranslationDraft(shot.dialogueTranslation ?? "")
  }, [shot.shotId, shot.dialogueTranslation])

  const persistDialogue = useCallback(async () => {
    const next = dialogueDraft.trim()
    const prev = (shot.dialogue ?? "").trim()
    if (next === prev) return
    setSaving("dialogue")
    try {
      await updateShot(episodeId, shot.shotId, { dialogue: next })
    } finally {
      setSaving(null)
    }
  }, [dialogueDraft, episodeId, shot.dialogue, shot.shotId, updateShot])

  const persistTranslation = useCallback(async () => {
    const next = translationDraft.trim()
    const prev = (shot.dialogueTranslation ?? "").trim()
    if (next === prev) return
    setSaving("translation")
    try {
      await updateShot(episodeId, shot.shotId, {
        dialogueTranslation: next,
      })
    } finally {
      setSaving(null)
    }
  }, [
    episodeId,
    shot.dialogueTranslation,
    shot.shotId,
    translationDraft,
    updateShot,
  ])

  const cellClass =
    "py-3 px-4 align-top min-w-[10rem] max-w-[14rem] box-border"
  const textareaClass =
    "w-full min-h-[4.5rem] p-2 text-xs text-[var(--color-ink)] border border-[var(--color-divider)] bg-[var(--color-newsprint-off-white)] rounded resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40 select-text [user-select:text]"

  return (
    <>
      <td className={cellClass} style={{ boxSizing: "border-box" }}>
        <label className="sr-only" htmlFor={`shot-${shot.shotId}-dialogue`}>
          台词原文 S{String(shot.shotNumber).padStart(2, "0")}
        </label>
        {saving === "dialogue" && (
          <p className="text-[10px] text-[var(--color-muted)] mb-1">保存中…</p>
        )}
        <textarea
          id={`shot-${shot.shotId}-dialogue`}
          value={dialogueDraft}
          onChange={(e) => setDialogueDraft(e.target.value)}
          onBlur={() => void persistDialogue()}
          className={textareaClass}
          style={{ boxSizing: "border-box" }}
          rows={3}
          aria-label={`台词原文 镜头${shot.shotNumber}`}
        />
      </td>
      <td className={cellClass} style={{ boxSizing: "border-box" }}>
        <label
          className="sr-only"
          htmlFor={`shot-${shot.shotId}-translation`}
        >
          译文 S{String(shot.shotNumber).padStart(2, "0")}
        </label>
        {saving === "translation" && (
          <p className="text-[10px] text-[var(--color-muted)] mb-1">保存中…</p>
        )}
        <textarea
          id={`shot-${shot.shotId}-translation`}
          value={translationDraft}
          onChange={(e) => setTranslationDraft(e.target.value)}
          onBlur={() => void persistTranslation()}
          className={textareaClass}
          style={{ boxSizing: "border-box" }}
          rows={3}
          aria-label={`译文 镜头${shot.shotNumber}`}
        />
      </td>
    </>
  )
}
