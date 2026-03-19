/**
 * PromptEditor Prompt 编辑器
 * textarea + 字数统计
 */
interface PromptEditorProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
  className?: string
}

export function PromptEditor({
  value,
  onChange,
  placeholder = "",
  maxLength = 2000,
  className = "",
}: PromptEditorProps) {
  return (
    <div className={className}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full min-h-[120px] px-3 py-2 border border-[var(--color-newsprint-black)] resize-y text-sm box-border"
      />
      <div className="text-xs text-[var(--color-muted)] mt-1 text-right">
        {value.length} / {maxLength}
      </div>
    </div>
  )
}
