/**
 * AssetTag 资产标签
 * 图标区分 character/location/prop + 名字
 */
import type { ShotAsset } from "@/types"
import { User, Building2, Package } from "lucide-react"

const typeIcons: Record<ShotAsset["type"], typeof User> = {
  character: User,
  location: Building2,
  prop: Package,
  other: Package,
}

interface AssetTagProps {
  asset: ShotAsset
  className?: string
}

export function AssetTag({ asset, className = "" }: AssetTagProps) {
  const Icon = typeIcons[asset.type]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 border border-[var(--color-newsprint-black)] text-[10px] font-bold uppercase tracking-wider bg-[var(--color-primary-50)] text-[var(--color-ink)] ${className}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {asset.name}
    </span>
  )
}
