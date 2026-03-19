/**
 * 资产库独立界面
 * 展示本集所有资产，支持按类型筛选、点击查看大图与 metadata
 * 图片 URL 使用 pulledAt 缓存破坏，确保重新拉取后显示最新图
 */
import { useEffect, useState, useMemo } from "react"
import { useParams, Link } from "react-router"
import { useEpisodeStore } from "@/stores"
import { getFileUrl } from "@/utils/file"
import type { ShotAsset } from "@/types"
import { Package, ArrowLeft, LayoutGrid, X } from "lucide-react"

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "character", label: "角色" },
  { value: "location", label: "场景" },
  { value: "prop", label: "道具" },
  { value: "other", label: "其他" },
]

const TYPE_LABELS: Record<string, string> = {
  character: "角色",
  location: "场景",
  prop: "道具",
  other: "其他",
}

/**
 * 资产详情弹窗：大图预览 + 完整 metadata（prompt）
 * 点击遮罩或 Esc 关闭
 */
function AssetDetailModal({
  asset,
  imgUrl,
  onClose,
}: {
  asset: ShotAsset
  imgUrl: string
  onClose: () => void
}) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleEscape)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", handleEscape)
      document.body.style.overflow = ""
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal
      aria-label="资产详情"
    >
      {/* 遮罩：点击关闭 */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      {/* 内容区：大图 + metadata，可滚动 */}
      <div
        className="relative bg-[var(--color-newsprint-off-white)] border-2 border-[var(--color-newsprint-black)] shadow-[6px_6px_0px_0px_#111111] max-w-4xl w-full max-h-[90vh] overflow-auto box-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b-2 border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)]">
          <div>
            <h2 className="text-xl font-extrabold uppercase tracking-tight text-[var(--color-newsprint-black)] font-headline">
              {asset.name}
            </h2>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              {TYPE_LABELS[asset.type] ?? asset.type} · {asset.assetId.slice(0, 8)}…
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 border border-[var(--color-newsprint-black)] hover:bg-[var(--color-outline-variant)] transition-colors"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {/* 大图 */}
        <div className="p-4 bg-[var(--color-outline-variant)]/30">
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={asset.name}
              className="w-full max-h-[50vh] object-contain border border-[var(--color-newsprint-black)]"
            />
          ) : (
            <div className="w-full h-64 flex items-center justify-center border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]">
              <Package className="w-20 h-20 opacity-40" />
            </div>
          )}
        </div>
        {/* Metadata：prompt 完整展示 */}
        <div className="p-4 border-t-2 border-[var(--color-newsprint-black)]">
          <h3 className="text-xs font-black uppercase tracking-wider text-[var(--color-muted)] mb-2">
            画面描述 / Prompt
          </h3>
          <pre className="text-sm text-[var(--color-newsprint-black)] whitespace-pre-wrap font-sans leading-relaxed overflow-x-auto max-h-48 overflow-y-auto p-3 bg-[var(--color-outline-variant)]/30 border border-[var(--color-newsprint-black)]">
            {asset.prompt || "（无）"}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default function AssetLibraryPage() {
  const { episodeId } = useParams<{ episodeId: string }>()
  const { currentEpisode, loading, fetchEpisodeDetail } = useEpisodeStore()
  const [typeFilter, setTypeFilter] = useState<string>("all")
  /** 点击资产卡片时，选中并展示大图与 metadata */
  const [selectedAsset, setSelectedAsset] = useState<ShotAsset | null>(null)

  useEffect(() => {
    if (episodeId) void fetchEpisodeDetail(episodeId)
  }, [episodeId, fetchEpisodeDetail])

  /** 去重后的资产列表 */
  const assets = useMemo(() => {
    if (!currentEpisode) return []
    const fromEpisode =
      currentEpisode.assets && currentEpisode.assets.length > 0
        ? currentEpisode.assets
        : (currentEpisode.scenes.flatMap((s) =>
            s.shots.flatMap((sh) => sh.assets)
          ) ?? []
          ).filter(
            (a, i, arr) => arr.findIndex((x) => x.assetId === a.assetId) === i
          ) as ShotAsset[]
    return fromEpisode
  }, [currentEpisode])

  /** 按类型筛选后的资产 */
  const filteredAssets = useMemo(() => {
    if (typeFilter === "all") return assets
    return assets.filter((a) => a.type === typeFilter)
  }, [assets, typeFilter])

  if (!episodeId || !currentEpisode) {
    if (loading) return <div className="p-8">加载中...</div>
    return <div className="p-8">未找到该剧集</div>
  }

  const basePath = `${currentEpisode.projectId}/${currentEpisode.episodeId}`
  /** 使用 pulledAt 作为缓存破坏参数，重新拉取后图片会刷新 */
  const cacheBust = currentEpisode.pulledAt ?? undefined

  return (
    <div className="min-h-screen p-8 box-border">
      {/* 顶部：返回 + 标题 */}
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <Link
          to={`/episode/${episodeId}`}
          className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[var(--color-newsprint-black)] hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          返回分镜板
        </Link>
        <div className="border-l-4 border-[var(--color-primary)] pl-6 flex-1">
          <h1 className="text-4xl font-extrabold tracking-tighter text-[var(--color-newsprint-black)] uppercase mb-1 font-headline">
            资产库
          </h1>
          <p className="text-[var(--color-newsprint-black)] font-medium opacity-70 text-sm uppercase tracking-tight">
            {currentEpisode.episodeTitle} · {assets.length} 个资产
          </p>
        </div>
      </div>

      {/* 类型筛选 */}
      <div className="flex flex-wrap items-center gap-2 mb-8">
        <LayoutGrid className="w-5 h-5 text-[var(--color-muted)]" />
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setTypeFilter(f.value)}
            className={`px-4 py-2 text-xs font-black uppercase tracking-wider border transition-colors ${
              typeFilter === f.value
                ? "bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)] border-[var(--color-newsprint-black)]"
                : "bg-transparent text-[var(--color-ink)] border-[var(--color-newsprint-black)] hover:bg-[var(--color-outline-variant)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 资产网格：更大的卡片，独立界面感 */}
      {filteredAssets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-[var(--color-muted)]">
          <Package className="w-20 h-20 mb-6 opacity-40" />
          <p className="text-base font-medium">暂无资产</p>
          <p className="text-sm mt-2">从平台拉取后将显示本集所有资产</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-8">
          {filteredAssets.map((a) => {
            const imgUrl = getFileUrl(a.localPath, basePath, cacheBust)
            return (
              <button
                type="button"
                key={a.assetId}
                onClick={() => setSelectedAsset(a)}
                className="border-2 border-[var(--color-newsprint-black)] overflow-hidden group bg-[var(--color-newsprint-off-white)] hover:shadow-lg transition-shadow text-left cursor-pointer"
              >
                <div className="aspect-square bg-[var(--color-outline-variant)] relative overflow-hidden">
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt={a.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-16 h-16 opacity-30" />
                    </div>
                  )}
                </div>
                <div className="p-4 border-t-2 border-[var(--color-newsprint-black)]">
                  <p className="text-base font-bold truncate" title={a.name}>
                    {a.name}
                  </p>
                  <p className="text-xs text-[var(--color-muted)] mt-1">
                    {TYPE_LABELS[a.type] ?? a.type}
                  </p>
                  {a.prompt && (
                    <p
                      className="text-xs text-[var(--color-muted)] mt-2 line-clamp-2"
                      title={a.prompt}
                    >
                      {a.prompt.length > 60 ? `${a.prompt.slice(0, 60)}…` : a.prompt}
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* 资产详情弹窗：大图 + 完整 metadata */}
      {selectedAsset && (
        <AssetDetailModal
          asset={selectedAsset}
          imgUrl={getFileUrl(selectedAsset.localPath, basePath, cacheBust)}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  )
}
