export function consumeIgnoreBlurSave(ignoreNextBlur: boolean): {
  ignoreNextBlur: false
  shouldSave: boolean
} {
  return {
    ignoreNextBlur: false,
    shouldSave: !ignoreNextBlur,
  }
}

export async function persistPromptDraft({
  draft,
  currentValue,
  onCommit,
}: {
  draft: string
  currentValue: string
  onCommit: (next: string) => Promise<void> | void
}): Promise<"unchanged" | "saved"> {
  const trimmed = draft.trim()
  if (trimmed === currentValue.trim()) return "unchanged"
  await onCommit(trimmed)
  return "saved"
}
