/**
 * ShotRow 列表视图行
 *
 * 列顺序：编号 | 时长（数字输入，失焦保存）| 首尾帧（悬浮大图 + 进详情）| 视频（悬浮预览 + 进详情）| 状态 |
 * 台词原文 | 译文 | 画面描述 | 图片提示词 | 视频提示词 | 资产（悬浮 + 进资产库详情）| 候选数 | 操作
 *
 * 提示词列支持悬浮显示、点击编辑、失焦保存；时长写入 `shot.duration`，供后续视频生成默认秒数。
 */
import { Link } from "react-router"
import { routes } from "@/utils/routes"
import type { Shot } from "@/types"
import { Badge } from "@/components/ui"
import {
  StatusIndicator,
  AssetTag,
  ShotDialogueCells,
  ShotPromptCells,
  ShotDurationCell,
} from "@/components/business"
import { ShotFrameCompare } from "./ShotFrameCompare"
import { ShotRowVideoPreview } from "./ShotRowVideoPreview"
import { shotStatusLabels } from "@/utils/format"
import { useEpisodeStore } from "@/stores"

interface ShotRowProps {
  shot: Shot
  projectId: string
  episodeId: string
  basePath?: string
  /** 缓存破坏，重新拉取后图片刷新 */
  cacheBust?: string
  /** 框选模式：首列显示勾选 */
  pickMode?: boolean
  batchPicked?: boolean
  onBatchPickToggle?: () => void
}

export function ShotRow({
  shot,
  projectId,
  episodeId,
  basePath = "",
  cacheBust,
  pickMode = false,
  batchPicked = false,
  onBatchPickToggle,
}: ShotRowProps) {
  const { updateShot } = useEpisodeStore()
  const showEndSkeleton = shot.status === "endframe_generating"

  return (
    <tr
      className="border-b border-[var(--color-divider)] hover:bg-[var(--color-divider)]/50"
      // 列表框选：MarqueeGrid 用 [data-batch-pick-item] 与选区矩形求交并合并勾选
      {...(pickMode ? { "data-batch-pick-item": shot.shotId } : {})}
    >
      {pickMode && (
        <td
          className="py-3 px-2 align-top min-w-0 box-border overflow-hidden"
          style={{ boxSizing: "border-box" }}
        >
          <input
            type="checkbox"
            checked={batchPicked}
            onChange={() => onBatchPickToggle?.()}
            aria-label={`批量框选：镜头 S${String(shot.shotNumber).padStart(2, "0")}`}
            className="h-4 w-4 accent-[var(--color-primary)] cursor-pointer"
          />
        </td>
      )}
      <td className="py-3 px-4 text-sm font-medium whitespace-nowrap min-w-0 overflow-hidden">
        {shot.shotNumber}
      </td>
      <td className="py-3 px-4 text-sm text-[var(--color-ink)] whitespace-nowrap align-top min-w-0 overflow-visible">
        <ShotDurationCell
          shot={shot}
          episodeId={episodeId}
          updateShot={updateShot}
        />
      </td>
      <td className="py-3 px-4 align-top min-w-0 overflow-visible">
        <ShotFrameCompare
          shot={shot}
          projectId={projectId}
          episodeId={episodeId}
          basePath={basePath}
          cacheBust={cacheBust}
          variant="row"
          showEndSkeleton={showEndSkeleton}
        />
      </td>
      <td className="py-3 px-4 align-top overflow-visible min-w-0">
        <ShotRowVideoPreview
          shot={shot}
          projectId={projectId}
          episodeId={episodeId}
          basePath={basePath}
          cacheBust={cacheBust}
        />
      </td>
      <td className="py-3 px-4 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIndicator status={shot.status} />
          <Badge status={shot.status}>{shotStatusLabels[shot.status]}</Badge>
        </div>
      </td>
      <ShotDialogueCells
        shot={shot}
        episodeId={episodeId}
        updateShot={updateShot}
      />
      <ShotPromptCells
        shot={shot}
        episodeId={episodeId}
        updateShot={updateShot}
        maxPreviewLen={40}
      />
      <td className="py-3 px-4 align-top overflow-visible">
        <div className="flex flex-wrap gap-1">
          {shot.assets.length > 0 ? (
            shot.assets.map((a) => (
              <AssetTag
                key={a.assetId}
                asset={a}
                basePath={basePath}
                cacheBust={cacheBust}
                projectId={projectId}
                episodeId={episodeId}
              />
            ))
          ) : (
            <span className="text-xs text-[var(--color-muted)]">-</span>
          )}
        </div>
      </td>
      <td className="py-3 px-4 text-sm min-w-0 overflow-hidden">
        {shot.videoCandidates.length}
      </td>
      <td className="py-3 px-4 min-w-0 overflow-visible">
        <Link to={routes.videopickShot(projectId, episodeId, shot.shotId)}>
          <button
            type="button"
            className="text-xs text-[var(--color-primary)] hover:underline"
          >
            选片
          </button>
        </Link>
      </td>
    </tr>
  )
}
