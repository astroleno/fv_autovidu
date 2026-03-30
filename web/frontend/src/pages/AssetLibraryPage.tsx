/**
 * 资产库独立界面
 * 展示本集所有资产，支持按类型筛选、点击查看大图与 metadata
 * 图片 URL 使用 pulledAt + localMediaEpoch 组合缓存破坏（见 useEpisodeMediaCacheBust）
 *
 * 说明（与「项目/剧集拉取」关系）：
 * - 后端 pull_episode 会调用平台 get_assets 并写入 episode.assets，同时下载 assets/*.png（与首帧同属一次拉取）。
 * - 若拉取时「同步内容」选「仅分镜文案」，则本地无 png，缩略图会加载失败（应用内会提示重新拉取）。
 * - 元数据能显示但无图：多为未下载文件或平台未返回可下载的 thumbnail URL。
 */
import { useEffect, useState, useMemo, useCallback, type ReactNode } from "react"
import { useParams, Link, useSearchParams } from "react-router"
import { useEpisodeMediaCacheBust } from "@/hooks"
import { useEpisodeFileBasePath } from "@/hooks/useEpisodeFileBasePath"
import { useEpisodeStore, useToastStore } from "@/stores"
import { getFileUrl } from "@/utils/file"
import type { CharacterVoiceBinding, ShotAsset } from "@/types"
import { Package, ArrowLeft, LayoutGrid, X } from "lucide-react"
import { routes } from "@/utils/routes"
import { dubApi } from "@/api/dub"
import { AssetVoicePanel } from "@/components/business/asset/AssetVoicePanel"

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
 * 卡片缩略图：支持 img onError，避免 404 时误以为「平台没拉资产」
 * （有 localPath 但文件未落盘时，浏览器会触发 onError）
 */
function AssetCardThumbnail({
  imgUrl,
  name,
}: {
  imgUrl: string
  name: string
}) {
  const [loadError, setLoadError] = useState(false)

  const handleError = useCallback(() => {
    setLoadError(true)
  }, [])

  if (!imgUrl || loadError) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center p-3 text-center box-border"
        style={{ boxSizing: "border-box" }}
      >
        <Package className="w-12 h-12 opacity-30 shrink-0 mb-2" aria-hidden />
        <p className="text-[10px] leading-tight text-[var(--color-muted)] font-medium">
          {!imgUrl
            ? "无本地路径：请用顶部「从平台拉取」同步本集"
            : "图片未落盘或加载失败：请重新拉取，同步内容勿选「仅分镜文案」"}
        </p>
      </div>
    )
  }

  return (
    <img
      src={imgUrl}
      alt={name}
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      onError={handleError}
    />
  )
}

/** 弹窗内大图：加载失败时展示说明文案 */
function AssetModalImage({ src, alt }: { src: string; alt: string }) {
  const [err, setErr] = useState(false)
  if (err) {
    return (
      <div className="w-full min-h-[200px] flex flex-col items-center justify-center border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] p-6 box-border">
        <Package className="w-16 h-16 opacity-40 mb-3" />
        <p className="text-sm text-center text-[var(--color-muted)]">
          本地文件不存在或无法加载。请使用顶部「从平台拉取」：同步内容选「分镜文案 + 首帧 + 资产图」；若平台已更新图片，「本地已有图片时」选「强制覆盖」。
        </p>
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-full max-h-[50vh] object-contain border border-[var(--color-newsprint-black)]"
      onError={() => setErr(true)}
    />
  )
}

/**
 * 资产详情弹窗：大图预览 + 完整 metadata（prompt）
 * 点击遮罩或 Esc 关闭
 */
function AssetDetailModal({
  asset,
  imgUrl,
  voicePanel,
  onClose,
}: {
  asset: ShotAsset
  imgUrl: string
  voicePanel?: ReactNode
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
        {/* 大图：onError 时与列表一致给出可操作提示 */}
        <div className="p-4 bg-[var(--color-outline-variant)]/30 box-border">
          {imgUrl ? (
            <AssetModalImage src={imgUrl} alt={asset.name} />
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
        {voicePanel ? (
          <div className="p-4 border-t-2 border-[var(--color-newsprint-black)]">
            <h3 className="text-xs font-black uppercase tracking-wider text-[var(--color-muted)] mb-3">
              角色音色
            </h3>
            {voicePanel}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function defaultPreviewText(assetName: string): string {
  return `我是${assetName || "该角色"}，这是我的音色试听。`
}

export default function AssetLibraryPage() {
  const { projectId: routeProjectId, episodeId } = useParams<{
    projectId?: string
    episodeId: string
  }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    currentEpisode,
    loading,
    fetchEpisodeDetail,
    updateEpisodeLocales,
  } = useEpisodeStore()
  const pushToast = useToastStore((s) => s.push)
  const cacheBust = useEpisodeMediaCacheBust(currentEpisode?.pulledAt)
  const [typeFilter, setTypeFilter] = useState<string>("all")
  /** 点击资产卡片时，选中并展示大图与 metadata */
  const [selectedAsset, setSelectedAsset] = useState<ShotAsset | null>(null)
  const [elConfigured, setElConfigured] = useState<boolean | null>(null)
  const [voices, setVoices] = useState<Array<{ voiceId: string; name: string }>>([])
  const [voiceDraft, setVoiceDraft] = useState("")
  const [previewTextDraft, setPreviewTextDraft] = useState("")
  const [savingVoice, setSavingVoice] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)

  useEffect(() => {
    if (episodeId) void fetchEpisodeDetail(episodeId)
  }, [episodeId, fetchEpisodeDetail])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await dubApi.configured()
        if (cancelled) return
        setElConfigured(cfg.data.configured)
        if (!cfg.data.configured) return
        const res = await dubApi.voices()
        if (cancelled) return
        setVoices(
          res.data.voices.map((v) => ({
            voiceId: v.voiceId,
            name: v.name,
          }))
        )
      } catch {
        if (!cancelled) setElConfigured(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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

  /**
   * 深链：分镜表资产标签「查看详情」跳转至 `/assets?assetId=...` 时，
   * 自动打开对应资产的详情弹窗（与点击网格卡片行为一致）
   */
  useEffect(() => {
    const id = searchParams.get("assetId")
    if (!id || assets.length === 0) return
    const found = assets.find((a) => a.assetId === id)
    if (found) setSelectedAsset(found)
  }, [searchParams, assets])

  /** 按类型筛选后的资产 */
  const filteredAssets = useMemo(() => {
    if (typeFilter === "all") return assets
    return assets.filter((a) => a.type === typeFilter)
  }, [assets, typeFilter])
  const basePath = useEpisodeFileBasePath()

  const selectedBinding: CharacterVoiceBinding | undefined =
    selectedAsset && currentEpisode?.characterVoices
      ? currentEpisode.characterVoices[selectedAsset.assetId]
      : undefined

  useEffect(() => {
    if (!selectedAsset) {
      setVoiceDraft("")
      setPreviewTextDraft("")
      return
    }
    const binding =
      currentEpisode?.characterVoices?.[selectedAsset.assetId]
    setVoiceDraft(binding?.voiceId ?? "")
    setPreviewTextDraft(
      binding?.previewText?.trim() || defaultPreviewText(selectedAsset.name)
    )
  }, [currentEpisode?.characterVoices, selectedAsset])

  /**
   * Hooks 必须位于任意 early return 之前（react-hooks/rules-of-hooks）。
   * 回调内对 currentEpisode / episodeId 做守卫，避免加载中误提交。
   */
  const persistBinding = useCallback(async () => {
    if (!selectedAsset || !currentEpisode || !episodeId) return
    const nextVoice = voiceDraft.trim()
    if (!nextVoice) {
      pushToast("请先为该角色选择音色", "error")
      return
    }
    setSavingVoice(true)
    try {
      const nextMap = {
        ...(currentEpisode.characterVoices ?? {}),
        [selectedAsset.assetId]: {
          ...(currentEpisode.characterVoices?.[selectedAsset.assetId] ?? {}),
          voiceId: nextVoice,
          previewText: previewTextDraft.trim() || defaultPreviewText(selectedAsset.name),
        },
      }
      await updateEpisodeLocales(episodeId, { characterVoices: nextMap })
      pushToast("角色音色绑定已保存", "success")
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast(`保存角色音色失败：${msg}`, "error")
    } finally {
      setSavingVoice(false)
    }
  }, [
    currentEpisode,
    episodeId,
    previewTextDraft,
    pushToast,
    selectedAsset,
    updateEpisodeLocales,
    voiceDraft,
  ])

  const generatePreview = useCallback(async () => {
    if (!selectedAsset || !episodeId) return
    const nextVoice = voiceDraft.trim()
    if (!nextVoice) {
      pushToast("请先为该角色选择音色", "error")
      return
    }
    setPreviewBusy(true)
    try {
      await dubApi.previewAssetVoice({
        episodeId,
        assetId: selectedAsset.assetId,
        voiceId: nextVoice,
        previewText: previewTextDraft.trim() || defaultPreviewText(selectedAsset.name),
      })
      await fetchEpisodeDetail(episodeId)
      pushToast("角色试听已生成", "success")
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast(`生成角色试听失败：${msg}`, "error")
    } finally {
      setPreviewBusy(false)
    }
  }, [
    episodeId,
    fetchEpisodeDetail,
    previewTextDraft,
    pushToast,
    selectedAsset,
    voiceDraft,
  ])

  if (!episodeId || !currentEpisode) {
    if (loading) return <div className="p-8">加载中...</div>
    return <div className="p-8">未找到该剧集</div>
  }

  const projectId = routeProjectId ?? currentEpisode.projectId
  const previewAudioUrl =
    selectedBinding?.previewAudioPath && selectedAsset
      ? getFileUrl(selectedBinding.previewAudioPath, basePath, cacheBust)
      : ""

  return (
    <div className="min-h-screen p-8 box-border">
      {/* 顶部：返回 + 标题 */}
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <Link
          to={routes.episode(projectId, episodeId)}
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
          <p className="text-xs text-[var(--color-muted)] mt-2 max-w-2xl leading-relaxed">
            资产列表与缩略图随「从平台拉取」一并写入（同一套 pull_episode）；若仅有文字无图，多半是同步内容选了「仅分镜文案」，或平台未返回可下载缩略图。
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
                  <AssetCardThumbnail imgUrl={imgUrl} name={a.name} />
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
          voicePanel={
            selectedAsset.type === "character" ? (
              <AssetVoicePanel
                assetName={selectedAsset.name}
                voices={voices}
                voiceId={voiceDraft}
                previewText={previewTextDraft}
                configured={elConfigured === true}
                busy={savingVoice}
                previewBusy={previewBusy}
                audioSrc={previewAudioUrl}
                onVoiceChange={setVoiceDraft}
                onPreviewTextChange={setPreviewTextDraft}
                onSave={() => void persistBinding()}
                onPreview={() => void generatePreview()}
              />
            ) : undefined
          }
          onClose={() => {
            setSelectedAsset(null)
            /** 关闭弹窗后去掉 URL 中的 assetId，避免刷新再次自动弹出 */
            if (searchParams.get("assetId")) {
              const next = new URLSearchParams(searchParams)
              next.delete("assetId")
              setSearchParams(next, { replace: true })
            }
          }}
        />
      )}
    </div>
  )
}
