/**
 * AssetTag 资产标签
 * 图标区分 character/location/prop + 名字
 * 传入 basePath 时支持悬浮显示：缩略图 + prompt 预览
 */
import { useState } from "react"
import type { ShotAsset } from "@/types"
import { User, Building2, Package } from "lucide-react"
import { getFileUrl } from "@/utils/file"

const typeIcons: Record<ShotAsset["type"], typeof User> = {
  character: User,
  location: Building2,
  prop: Package,
  other: Package,
}

interface AssetTagProps {
  asset: ShotAsset
  className?: string
  /** 传入时启用悬浮显示（缩略图 + prompt） */
  basePath?: string
  cacheBust?: string
}

export function AssetTag({ asset, className = "", basePath, cacheBust }: AssetTagProps) {
  const [hover, setHover] = useState(false)
  const Icon = typeIcons[asset.type]
  const imageUrl = basePath && asset.localPath
    ? getFileUrl(asset.localPath, basePath, cacheBust)
    : null

  const tag = (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 border border-[var(--color-newsprint-black)] text-[10px] font-bold uppercase tracking-wider bg-[var(--color-primary-50)] text-[var(--color-ink)] cursor-default ${className}`}
      style={{ boxSizing: "border-box" }}
      onMouseEnter={() => basePath && setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {asset.name}
    </span>
  )

  if (!basePath || !imageUrl) {
    return tag
  }

  return (
    <div className="relative inline-block">
      {tag}
      {hover && (
        <div
          className="absolute z-50 left-0 top-full mt-1 min-w-[200px] max-w-[320px] p-3 bg-[var(--color-newsprint-off-white)] border-2 border-[var(--color-newsprint-black)] shadow-[4px_4px_0px_0px_#111111] box-border"
          role="tooltip"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <div className="flex gap-3">
            <img
              src={imageUrl}
              alt={asset.name}
              className="w-16 h-16 object-cover border border-[var(--color-newsprint-black)] shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase text-[var(--color-newsprint-black)] mb-1">
                {asset.name} · {asset.type}
              </p>
              <p className="text-[10px] text-[var(--color-muted)] line-clamp-4 leading-relaxed">
                {asset.prompt || "暂无描述"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
