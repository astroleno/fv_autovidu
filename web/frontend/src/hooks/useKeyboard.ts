/**
 * useKeyboard 键盘快捷键
 * 分镜板：← → 切换 Shot，Enter 进详情，Space 播放
 * Shot 详情：1-9 选定候选，← → 切换 Shot
 */
import { useEffect } from "react"

interface UseKeyboardOptions {
  onLeft?: () => void
  onRight?: () => void
  onEnter?: () => void
  onSpace?: () => void
  onDigit?: (n: number) => void
  enabled?: boolean
}

export function useKeyboard({
  onLeft,
  onRight,
  onEnter,
  onSpace,
  onDigit,
  enabled = true,
}: UseKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      // 避免在 input/textarea 中触发
      const target = e.target as HTMLElement
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return

      switch (e.key) {
        case "ArrowLeft":
          onLeft?.()
          break
        case "ArrowRight":
          onRight?.()
          break
        case "Enter":
          onEnter?.()
          break
        case " ":
          e.preventDefault()
          onSpace?.()
          break
        default:
          if (onDigit && e.key >= "1" && e.key <= "9") {
            onDigit(Number(e.key))
          }
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [enabled, onLeft, onRight, onEnter, onSpace, onDigit])
}
