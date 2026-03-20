/**
 * ShotRow 列表视图行
 * 编号 | 首帧 | 尾帧 | 状态 | 画面描述 | 图片提示词 | 视频提示词 | 资产（悬浮） | 候选数 | 操作
 * 提示词列支持悬浮显示、点击编辑、失焦保存
 */
import { Link } from "react-router"
import type { Shot } from "@/types"
import { Badge } from "@/components/ui"
import { StatusIndicator, AssetTag, ShotPromptCells } from "@/components/business"
import { ShotFrameCompare } from "./ShotFrameCompare"
import { shotStatusLabels } from "@/utils/format"
import { useEpisodeStore } from "@/stores"

interface ShotRowProps {
  shot: Shot
  episodeId: string
  basePath?: string
  /** 缓存破坏，重新拉取后图片刷新 */
  cacheBust?: string
}

export function ShotRow({ shot, episodeId, basePath = "", cacheBust }: ShotRowProps) {
  const { updateShot } = useEpisodeStore()
  const showEndSkeleton = shot.status === "endframe_generating"

  return (
    <tr className="border-b border-[var(--color-divider)] hover:bg-[var(--color-divider)]/50">
      <td className="py-3 px-4 text-sm font-medium">{shot.shotNumber}</td>
      <td className="py-3 px-4 align-top min-w-[11rem]">
        <ShotFrameCompare
          shot={shot}
          episodeId={episodeId}
          basePath={basePath}
          cacheBust={cacheBust}
          variant="row"
          showEndSkeleton={showEndSkeleton}
        />
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <StatusIndicator status={shot.status} />
          <Badge status={shot.status}>{shotStatusLabels[shot.status]}</Badge>
        </div>
      </td>
      <ShotPromptCells
        shot={shot}
        episodeId={episodeId}
        updateShot={updateShot}
        maxPreviewLen={40}
      />
      <td className="py-3 px-4">
        <div className="flex flex-wrap gap-1">
          {shot.assets.length > 0 ? (
            shot.assets.map((a) => (
              <AssetTag
                key={a.assetId}
                asset={a}
                basePath={basePath}
                cacheBust={cacheBust}
              />
            ))
          ) : (
            <span className="text-xs text-[var(--color-muted)]">-</span>
          )}
        </div>
      </td>
      <td className="py-3 px-4 text-sm">{shot.videoCandidates.length}</td>
      <td className="py-3 px-4">
        <Link to={`/episode/${episodeId}/shot/${shot.shotId}`}>
          <button
            type="button"
            className="text-xs text-[var(--color-primary)] hover:underline"
          >
            详情
          </button>
        </Link>
      </td>
    </tr>
  )
}
