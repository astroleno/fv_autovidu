/**
 * VideoPickEditablePrompt — 选片参考区「视频提示词」可编辑块
 *
 * ## 交互契约
 * - **默认态**：只读摘要（虚线框按钮），点击进入编辑态。
 * - **编辑态**：textarea；`blur` 与 **Enter**（非 Shift）提交并退出；**Shift+Enter** 换行；**Esc** 放弃修改。
 * - **键盘与选片全局快捷键**：通过 `onEditingChange(true|false)` 通知父级，父级在 focus 期间禁用 `useVideoPickKeyboard`。
 *
 * ## 样式
 * 凡含 padding 的容器均显式 `box-border`，避免与 Tailwind 组合时宽度溢出。
 */
import { useEffect, useRef, useState } from "react"
import {
  consumeIgnoreBlurSave,
  persistPromptDraft,
} from "./videoPickEditablePromptLogic"

export interface VideoPickEditablePromptProps {
  /** 字段标签（小字号大写） */
  label: string
  /** 当前已保存的提示词（受控展示） */
  value: string
  /** blur / Enter 提交时调用；可 async，用于写入 episode.json */
  onCommit: (next: string) => Promise<void> | void
  /** 进入/退出编辑态时通知，用于与选片全局键盘流互斥 */
  onEditingChange?: (editing: boolean) => void
}

export function VideoPickEditablePrompt({
  label,
  value,
  onCommit,
  onEditingChange,
}: VideoPickEditablePromptProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const ignoreBlurSaveRef = useRef(false)

  useEffect(() => {
    setDraft(value)
    if (!editing) setError(null)
  }, [value])

  useEffect(() => {
    onEditingChange?.(editing)
  }, [editing, onEditingChange])

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  const commitAndExit = async () => {
    const { ignoreNextBlur, shouldSave } = consumeIgnoreBlurSave(
      ignoreBlurSaveRef.current
    )
    ignoreBlurSaveRef.current = ignoreNextBlur
    if (!shouldSave) return

    setSaving(true)
    setError(null)
    try {
      await persistPromptDraft({
        draft,
        currentValue: value,
        onCommit,
      })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }

  const cancelAndExit = () => {
    ignoreBlurSaveRef.current = true
    setDraft(value)
    setError(null)
    setEditing(false)
  }

  if (editing) {
    return (
      <div
        className="min-w-0 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-1">
          {label}
        </p>
        <textarea
          ref={textareaRef}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commitAndExit()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              textareaRef.current?.blur()
            }
            if (e.key === "Escape") {
              e.preventDefault()
              cancelAndExit()
            }
          }}
          className="w-full min-h-[6rem] rounded-sm border border-[var(--color-newsprint-black)] p-2 text-xs leading-relaxed resize-y box-border"
          style={{ boxSizing: "border-box" }}
        />
        <p className="text-[8px] text-[var(--color-muted)] mt-0.5">
          {saving ? "保存中…" : "Enter 保存 · Shift+Enter 换行 · Esc 取消"}
        </p>
        {error ? (
          <p className="text-[9px] text-[var(--color-danger)] mt-1">{error}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className="min-w-0 box-border"
      style={{ boxSizing: "border-box" }}
    >
      <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-0.5">
        {label}
      </p>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-full text-left rounded-sm border border-dashed border-[var(--color-newsprint-black)] bg-white/80 px-2 py-1.5 text-[11px] leading-snug whitespace-pre-wrap break-words line-clamp-4 hover:border-solid hover:border-[var(--color-primary)] transition-colors box-border"
        style={{ boxSizing: "border-box" }}
        title="点击编辑"
      >
        {value.trim() || "暂无内容，点击添加"}
      </button>
    </div>
  )
}
