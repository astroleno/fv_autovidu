/**
 * useVideoPickKeyboard — 选片模式键盘流
 *
 * - 1–4：将前四个候选写为已选并激活
 * - Tab / Shift+Tab：在全部候选间循环激活（含「更多候选」）
 * - Enter：将当前激活候选提交为已选（与第 5 个及以后候选配合，因数字键只映射前 4 个）
 * - ArrowLeft/Right：先提交当前激活候选，再切镜头（由 onAfterCommitNavigate 处理）
 * - Esc：退出选片模式
 * - Ctrl+Z / Cmd+Z：撤销最近一次写入（由 onUndo 处理）
 *
 * 在 input/textarea/contenteditable 内不响应，避免打断表单。
 */
import { useEffect } from "react"

export interface UseVideoPickKeyboardOptions {
  enabled: boolean
  /** 前四个候选 id（不足则短数组；用于判断数字键是否有效） */
  primaryCandidateIds: string[]
  onDigitSelect: (digit1To4: number) => void
  onTabCycle: (direction: 1 | -1) => void
  /** 将当前激活候选提交为已选（与 Tab 流、第 5+ 候选配套） */
  onConfirmActive: () => void
  onArrow: (dir: "prev" | "next") => void
  onExitPicking: () => void
  onUndo: () => void
}

/** Enter 确认时跳过：真实链接/按钮会走默认行为，避免抢焦点交互 */
function shouldSkipConfirmEnter(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  if (target.closest("a[href]")) return true
  if (target.closest("button")) return true
  if (target.closest('[role="dialog"]')) return true
  return false
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === "TEXTAREA" || tag === "SELECT") return true
  if (tag === "INPUT") {
    const t = (el as HTMLInputElement).type
    if (
      t === "checkbox" ||
      t === "radio" ||
      t === "button" ||
      t === "submit" ||
      t === "reset"
    ) {
      return false
    }
    return true
  }
  if (el.isContentEditable) return true
  return false
}

export function useVideoPickKeyboard({
  enabled,
  primaryCandidateIds,
  onDigitSelect,
  onTabCycle,
  onConfirmActive,
  onArrow,
  onExitPicking,
  onUndo,
}: UseVideoPickKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return

      if (e.key === "Escape") {
        e.preventDefault()
        onExitPicking()
        return
      }

      if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onUndo()
        return
      }

      if (e.key === "Tab") {
        e.preventDefault()
        onTabCycle(e.shiftKey ? -1 : 1)
        return
      }

      if (e.key === "Enter") {
        if (shouldSkipConfirmEnter(e.target)) return
        e.preventDefault()
        e.stopPropagation()
        onConfirmActive()
        return
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault()
        onArrow("prev")
        return
      }
      if (e.key === "ArrowRight") {
        e.preventDefault()
        onArrow("next")
        return
      }

      if (e.key >= "1" && e.key <= "4") {
        const n = Number(e.key)
        if (n >= 1 && n <= 4 && n <= primaryCandidateIds.length) {
          e.preventDefault()
          onDigitSelect(n)
        }
      }
    }

    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [
    enabled,
    primaryCandidateIds,
    onDigitSelect,
    onTabCycle,
    onConfirmActive,
    onArrow,
    onExitPicking,
    onUndo,
  ])
}
