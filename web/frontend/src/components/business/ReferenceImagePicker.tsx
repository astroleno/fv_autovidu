/**
 * 参考资产多选（1~7）：用于多参考图视频批量生成时限定资产 id
 * 仅展示 assetId 列表，由父组件从 episode.assets 解析出可选 id
 */
interface ReferenceImagePickerProps {
  /** 剧集内可选的资产 id */
  assetIds: string[]
  /** 已选中的 asset id（顺序有意义时可扩展为拖拽排序） */
  selectedIds: string[]
  onChange: (ids: string[]) => void
  max?: number
}

export function ReferenceImagePicker({
  assetIds,
  selectedIds,
  onChange,
  max = 7,
}: ReferenceImagePickerProps) {
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id))
      return
    }
    if (selectedIds.length >= max) return
    onChange([...selectedIds, id])
  }

  return (
    <div className="flex flex-wrap gap-2 box-border">
      {assetIds.map((id) => {
        const on = selectedIds.includes(id)
        return (
          <button
            key={id}
            type="button"
            onClick={() => toggle(id)}
            className={`px-2 py-1 text-[10px] font-mono border box-border transition-colors ${
              on
                ? "bg-[var(--color-primary)] text-white border-[var(--color-newsprint-black)]"
                : "bg-transparent border-[var(--color-newsprint-black)] hover:bg-[var(--color-outline-variant)]"
            }`}
          >
            {id.slice(0, 8)}…
          </button>
        )
      })}
    </div>
  )
}
