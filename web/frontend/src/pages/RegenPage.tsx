/**
 * 单帧重生页
 * 三栏：原首帧 / prompt 编辑 + 资产选择 / 候选预览
 */
import { useEffect, useState } from "react"
import { useParams } from "react-router"
import { useEpisodeStore } from "@/stores"
import { Button, Dialog } from "@/components/ui"
import { PromptEditor, AssetSelector, ImagePreview } from "@/components/business"
import { flattenShots } from "@/types"
import { getFileUrl } from "@/utils/file"

export default function RegenPage() {
  const { episodeId, shotId } = useParams<{ episodeId: string; shotId: string }>()
  const { currentEpisode, fetchEpisodeDetail } = useEpisodeStore()
  const [prompt, setPrompt] = useState("")
  const [assetIds, setAssetIds] = useState<string[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (episodeId) void fetchEpisodeDetail(episodeId)
  }, [episodeId, fetchEpisodeDetail])

  if (!episodeId || !shotId || !currentEpisode) return null

  const shot = flattenShots(currentEpisode).find((s) => s.shotId === shotId)
  if (!shot) return <div className="p-8">未找到镜头</div>

  useEffect(() => {
    setPrompt(shot.imagePrompt)
    setAssetIds(shot.assets.map((a) => a.assetId))
  }, [shot.shotId])

  const basePath = `${currentEpisode.projectId}/${currentEpisode.episodeId}`
  const cacheBust = currentEpisode.pulledAt ?? undefined
  const firstFrameUrl = getFileUrl(shot.firstFrame, basePath, cacheBust)
  // 优先使用 episode 级全量资产库（puller 拉取时填入），否则从 shots 去重
  const assetsFromShots = currentEpisode.scenes.flatMap((s) =>
    s.shots.flatMap((sh) => sh.assets)
  )
  const uniqueFromShots = assetsFromShots.filter(
    (a, i, arr) => arr.findIndex((x) => x.assetId === a.assetId) === i
  )
  const uniqueAssets =
    currentEpisode.assets && currentEpisode.assets.length > 0
      ? currentEpisode.assets
      : uniqueFromShots

  const toggleAsset = (id: string) => {
    setAssetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  return (
    <div className="p-8">
      <h1 className="text-4xl font-extrabold uppercase tracking-tighter text-[var(--color-newsprint-black)] mb-8 font-headline">
        单帧重生 - S{String(shot.shotNumber).padStart(2, "0")}
      </h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div>
          <p className="text-sm text-[var(--color-muted)] mb-2">当前首帧</p>
          {firstFrameUrl ? (
            <ImagePreview src={firstFrameUrl} alt="首帧" className="aspect-video" />
          ) : (
            <div className="aspect-video bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)]" />
          )}
        </div>
        <div>
          <p className="text-sm text-[var(--color-muted)] mb-2">画面描述</p>
          <PromptEditor value={prompt} onChange={setPrompt} />
          <p className="text-sm text-[var(--color-muted)] mt-4 mb-2">选择资产</p>
          <AssetSelector
            assets={uniqueAssets}
            selectedIds={assetIds}
            onToggle={toggleAsset}
            basePath={basePath}
            cacheBust={cacheBust}
          />
          <Button
            variant="primary"
            className="mt-4 w-full"
            onClick={() => setConfirmOpen(true)}
          >
            生成新首帧
          </Button>
        </div>
        <div>
          <p className="text-sm text-[var(--color-muted)] mb-2">候选预览</p>
          <div className="text-[var(--color-muted)]">生成后将在此显示</div>
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认"
      >
        <p className="mb-4">
          采用新首帧后，该镜头的尾帧和视频将被清除，需要重新生成。确认？
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => setConfirmOpen(false)}>
            确认
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
