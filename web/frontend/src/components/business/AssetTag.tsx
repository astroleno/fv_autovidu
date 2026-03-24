/**
 * AssetTag 资产标签
 *
 * - 图标区分 character/location/prop + 名称
 * - 传入 basePath 时：鼠标悬浮显示较大浮层（缩略图 + prompt），避免表格单元格裁剪（fixed + portal 可选，此处用绝对定位 + 高层级 z-index）
 * - 传入 projectId + episodeId 时：标签可点击跳转资产库并打开该资产详情（query: assetId）
 *
 * 所有带 padding 的容器使用 box-border，避免撑破分镜表布局。
 */
import { useState } from "react"
import { Link } from "react-router"
import type { ShotAsset } from "@/types"
import { User, Building2, Package } from "lucide-react"
import { getFileUrl } from "@/utils/file"
import { routes } from "@/utils/routes"

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
  /** 与 episodeId 同时传入时，标签变为链至资产库详情 */
  projectId?: string
  episodeId?: string
}

export function AssetTag({
  asset,
  className = "",
  basePath,
  cacheBust,
  projectId,
  episodeId,
}: AssetTagProps) {
  const [hover, setHover] = useState(false)
  const Icon = typeIcons[asset.type]
  const imageUrl = basePath && asset.localPath
    ? getFileUrl(asset.localPath, basePath, cacheBust)
    : null

  const assetDetailHref =
    projectId && episodeId
      ? routes.assetDetail(projectId, episodeId, asset.assetId)
      : undefined

  const labelClass = `inline-flex items-center gap-1.5 px-2 py-0.5 border border-[var(--color-newsprint-black)] text-[10px] font-bold uppercase tracking-wider bg-[var(--color-primary-50)] text-[var(--color-ink)] box-border ${
    assetDetailHref ? "cursor-pointer hover:bg-[var(--color-outline-variant)]" : "cursor-default"
  } ${className}`

  const tagInner = (
    <>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
      {asset.name}
    </>
  )

  const tag = assetDetailHref ? (
    <Link
      to={assetDetailHref}
      className={labelClass}
      style={{ boxSizing: "border-box" }}
      onMouseEnter={() => basePath && setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {tagInner}
    </Link>
  ) : (
    <span
      className={labelClass}
      style={{ boxSizing: "border-box" }}
      onMouseEnter={() => basePath && setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {tagInner}
    </span>
  )

  if (!basePath || !imageUrl) {
    return tag
  }

  return (
    <div className="relative inline-block align-middle">
      {tag}
      {hover && (
        <div
          className="absolute z-[60] left-0 top-full mt-1 min-w-[220px] max-w-[360px] p-3 bg-[var(--color-newsprint-off-white)] border-2 border-[var(--color-newsprint-black)] shadow-[6px_6px_0px_0px_#111111] box-border"
          style={{ boxSizing: "border-box" }}
          role="tooltip"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-2">
            点击查看资产详情
          </p>
          <div className="flex gap-3">
            <img
              src={imageUrl}
              alt={asset.name}
              className="w-20 h-20 object-cover border border-[var(--color-newsprint-black)] shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase text-[var(--color-newsprint-black)] mb-1">
                {asset.name} · {asset.type}
              </p>
              <p className="text-[10px] text-[var(--color-muted)] line-clamp-6 leading-relaxed">
                {asset.prompt || "暂无描述"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
