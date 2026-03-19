/**
 * AssetSelector 资产多选
 * 缩略图 + 复选框，支持 cacheBust 防止图片缓存不更新
 */
import type { ShotAsset } from "@/types"
import { getFileUrl } from "@/utils/file"

interface AssetSelectorProps {
  assets: ShotAsset[]
  selectedIds: string[]
  onToggle: (assetId: string) => void
  basePath?: string
  /** 缓存破坏参数（如 pulledAt），重新拉取后图片会刷新 */
  cacheBust?: string
}

export function AssetSelector({
  assets,
  selectedIds,
  onToggle,
  basePath = "",
  cacheBust,
}: AssetSelectorProps) {
  return (
    <div className="space-y-2">
      {assets.map((a) => {
        const checked = selectedIds.includes(a.assetId)
        const imgUrl = getFileUrl(a.localPath, basePath, cacheBust)
        return (
          <label
            key={a.assetId}
            className={`flex items-center gap-3 p-2 border border-[var(--color-newsprint-black)] cursor-pointer transition-colors ${
              checked
                ? "border-[var(--color-primary)] bg-[var(--color-primary-50)]"
                : "border-[var(--color-newsprint-black)] hover:bg-[var(--color-divider)]"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(a.assetId)}
              className="w-4 h-4"
            />
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={a.name}
                className="w-12 h-12 object-cover border border-[var(--color-newsprint-black)] grayscale-img"
              />
            ) : (
              <div className="w-12 h-12 bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)]" />
            )}
            <span className="text-sm font-medium">{a.name}</span>
          </label>
        )
      })}
    </div>
  )
}
