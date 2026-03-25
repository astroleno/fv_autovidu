/**
 * VideoPickReferencePanel — 选片模式右侧「参考区」
 *
 * 展示当前镜头的最小参考集：首尾帧、提示词优先级、资产、配音摘要。
 * 长文本默认截断（line-clamp），可展开（P1 要求）。
 */
import { useLayoutEffect, useRef, useState } from "react"
import type { Shot } from "@/types"
import { ShotFrameCompare } from "./ShotFrameCompare"
import { AssetTag } from "./AssetTag"
import { DubStatusBadge } from "./DubStatusBadge"

const ASSET_PREVIEW_LIMIT = 8

/** 单条可展开文本字段 */
function ExpandablePromptBlock({
  label,
  text,
  lineClampClass,
}: {
  label: string
  text: string
  /** 收起态行数，如 line-clamp-3 */
  lineClampClass: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const pRef = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const el = pRef.current
    if (!el || expanded) {
      setOverflowing(false)
      return
    }
    setOverflowing(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded, lineClampClass])

  const trimmed = text.trim()
  if (!trimmed) return null

  return (
    <div
      className="min-w-0 box-border"
      style={{ boxSizing: "border-box" }}
    >
      <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-0.5">
        {label}
      </p>
      <p
        ref={pRef}
        className={`text-[10px] text-[var(--color-ink)] leading-snug whitespace-pre-wrap break-words ${
          expanded ? "" : lineClampClass
        }`}
      >
        {trimmed}
      </p>
      {overflowing || expanded ? (
        <button
          type="button"
          className="mt-0.5 text-[10px] font-bold text-[var(--color-primary)] underline"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      ) : null}
    </div>
  )
}

export interface VideoPickReferencePanelProps {
  shot: Shot
  projectId: string
  episodeId: string
  basePath: string
  cacheBust?: string
  showEndSkeleton: boolean
  onRetryEndframe?: () => void
}

export function VideoPickReferencePanel({
  shot,
  projectId,
  episodeId,
  basePath,
  cacheBust,
  showEndSkeleton,
  onRetryEndframe,
}: VideoPickReferencePanelProps) {
  const assets = shot.assets ?? []
  const extraAssetCount = Math.max(0, assets.length - ASSET_PREVIEW_LIMIT)

  const hasAnyPrompt =
    Boolean(shot.visualDescription?.trim()) ||
    Boolean(shot.videoPrompt?.trim()) ||
    Boolean(shot.imagePrompt?.trim())

  return (
    <aside
      className="flex flex-col gap-3 min-w-0 w-full max-h-[calc(100vh-12rem)] overflow-y-auto box-border p-3 border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]/25 rounded-sm"
      style={{ boxSizing: "border-box" }}
      aria-label="当前镜头参考信息"
    >
      <ShotFrameCompare
        variant="pick"
        shot={shot}
        projectId={projectId}
        episodeId={episodeId}
        basePath={basePath}
        cacheBust={cacheBust}
        showEndSkeleton={showEndSkeleton}
        onRetryEndframe={onRetryEndframe}
      />

      <div
        className="rounded-sm border border-dashed border-[var(--color-newsprint-black)] p-2 bg-white/80 min-w-0 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-1.5">
          文本参考（优先级：画面描述 → 视频提示词 → 图像提示词）
        </p>
        {!hasAnyPrompt ? (
          <p
            className="text-[10px] text-[var(--color-muted)] box-border"
            style={{ boxSizing: "border-box" }}
          >
            暂无提示词信息
          </p>
        ) : (
          <div
            className="flex flex-col gap-2 min-w-0 box-border"
            style={{ boxSizing: "border-box" }}
          >
            <ExpandablePromptBlock
              label="画面描述 visualDescription"
              text={shot.visualDescription ?? ""}
              lineClampClass="line-clamp-3"
            />
            <ExpandablePromptBlock
              label="视频提示词 videoPrompt"
              text={shot.videoPrompt ?? ""}
              lineClampClass="line-clamp-3"
            />
            <ExpandablePromptBlock
              label="图像提示词 imagePrompt"
              text={shot.imagePrompt ?? ""}
              lineClampClass="line-clamp-3"
            />
          </div>
        )}
      </div>

      {shot.dub != null ? (
        <div
          className="flex flex-wrap items-center gap-2 min-w-0 box-border"
          style={{ boxSizing: "border-box" }}
        >
          <span className="text-[9px] font-black uppercase text-[var(--color-muted)] shrink-0">
            配音
          </span>
          <DubStatusBadge dub={shot.dub} />
        </div>
      ) : null}

      {assets.length > 0 ? (
        <div className="min-w-0 box-border" style={{ boxSizing: "border-box" }}>
          <p className="text-[9px] font-black uppercase text-[var(--color-muted)] mb-1.5">
            资产
          </p>
          <div className="flex flex-wrap gap-1.5 min-w-0">
            {assets.slice(0, ASSET_PREVIEW_LIMIT).map((a) => (
              <AssetTag
                key={a.assetId}
                asset={a}
                basePath={basePath}
                cacheBust={cacheBust}
                projectId={projectId}
                episodeId={episodeId}
              />
            ))}
            {extraAssetCount > 0 ? (
              <span
                className="inline-flex items-center px-2 py-0.5 border border-[var(--color-newsprint-black)] text-[10px] font-black uppercase bg-[var(--color-outline-variant)] text-[var(--color-muted)] box-border"
                style={{ boxSizing: "border-box" }}
                title={`另有 ${String(extraAssetCount)} 个资产`}
              >
                +{extraAssetCount}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  )
}
