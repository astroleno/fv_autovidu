/**
 * PullSyncOptions — 平台拉取选项（两维正交）
 *
 * 说明（避免「文案必选」误解）：
 * - 分镜表与 episode.json 是同一套数据：拉取会始终从平台组装并写入 episode.json（场景、镜头、提示词、资产元数据等），
 *   **不是**与首帧/资产并列的第三项勾选项。
 * - 若你**仅在本地**改过画面描述/提示词等而未同步到平台，再次拉取会以**平台**为准覆盖这些字段；
 *   尾帧、视频候选、配音状态、台词等本地产物仍按后端合并规则尽量保留。
 *
 * 第一维 · 可选项：仅控制是否下载 **首帧图** / **资产图** 文件。
 * 第二维 · 本地已有图片时：增量 vs 强制覆盖（仅当至少勾选一类图片下载时有效）。
 *
 * 与后端：skipFrames=!downloadFrames, skipAssets=!downloadAssets, forceRedownload=forceOverwrite
 */
import { useId } from "react"

export interface PullSyncOptionsProps {
  /** 是否下载分镜首帧图 */
  downloadFrames: boolean
  /** 是否下载资产缩略图 */
  downloadAssets: boolean
  /** 是否强制覆盖本地已有首帧/资产文件 */
  forceOverwrite: boolean
  onDownloadFramesChange: (v: boolean) => void
  onDownloadAssetsChange: (v: boolean) => void
  onForceOverwriteChange: (v: boolean) => void
}

export function PullSyncOptions({
  downloadFrames,
  downloadAssets,
  forceOverwrite,
  onDownloadFramesChange,
  onDownloadAssetsChange,
  onForceOverwriteChange,
}: PullSyncOptionsProps) {
  const policyId = useId()
  /** 无任何图片类下载时，第二维不适用 */
  const noImageDownloads = !downloadFrames && !downloadAssets

  return (
    <div className="border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]/50 p-3 space-y-4 box-border">
      {/* 分镜数据：与分镜表同源，随每次拉取写入 episode.json，非「勾选项」 */}
      <fieldset className="space-y-3 min-w-0 border-0 p-0 m-0">
        <legend className="text-[10px] font-black uppercase tracking-wider text-[var(--color-muted)] mb-1 px-0">
          同步内容
        </legend>

        <div className="rounded border border-[var(--color-newsprint-black)]/30 bg-[var(--color-newsprint-off-white)]/80 p-3 text-xs text-[var(--color-newsprint-black)] leading-relaxed space-y-2 box-border">
          <p className="font-semibold text-[var(--color-muted)] uppercase tracking-wide text-[10px]">
            分镜数据（与分镜表一致）
          </p>
          <p>
            每次拉取都会从平台更新 <strong className="font-bold">episode.json</strong>
            ，分镜表里看到的镜头、提示词、资产引用等即来自该文件，无需单独勾选。
          </p>
          <p className="text-[var(--color-muted)]">
            若你<strong className="text-[var(--color-newsprint-black)]">只在本地</strong>
            改过画面描述或提示词、尚未同步到平台，拉取后会以<strong className="text-[var(--color-newsprint-black)]">平台版本</strong>
            为准覆盖；尾帧、视频候选、配音相关等本地产物仍按现有规则合并保留。
          </p>
        </div>

        <p className="text-xs font-medium text-[var(--color-newsprint-black)] pt-1">
          可选：是否下载图片文件
        </p>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={downloadFrames}
            onChange={(e) => onDownloadFramesChange(e.target.checked)}
            className="w-4 h-4 shrink-0 mt-0.5"
          />
          <span>
            <span className="text-sm font-medium text-[var(--color-newsprint-black)] block">
              首帧
            </span>
            <span className="text-xs text-[var(--color-muted)] leading-snug block mt-0.5">
              下载各镜头首帧图至 frames/
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={downloadAssets}
            onChange={(e) => onDownloadAssetsChange(e.target.checked)}
            className="w-4 h-4 shrink-0 mt-0.5"
          />
          <span>
            <span className="text-sm font-medium text-[var(--color-newsprint-black)] block">
              资产图
            </span>
            <span className="text-xs text-[var(--color-muted)] leading-snug block mt-0.5">
              下载资产库缩略图至 assets/
            </span>
          </span>
        </label>

        {!downloadFrames && !downloadAssets ? (
          <p className="text-xs text-[var(--color-muted)] border-t border-[var(--color-newsprint-black)]/20 pt-2 mt-1">
            未勾选首帧与资产图时：仍会从平台写入/合并 episode.json（分镜数据照常更新），仅不下载新的图片文件。
          </p>
        ) : null}
      </fieldset>

      {/* 第二维：本地已有图片时 — 仅当会下载至少一类图片时可选 */}
      <fieldset
        className={`space-y-2 min-w-0 border-0 p-0 m-0 ${
          noImageDownloads ? "opacity-40 pointer-events-none" : ""
        }`}
        disabled={noImageDownloads}
      >
        <legend className="text-[10px] font-black uppercase tracking-wider text-[var(--color-muted)] mb-2 px-0">
          本地已有图片时
        </legend>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name={policyId}
            checked={!forceOverwrite}
            onChange={() => onForceOverwriteChange(false)}
            className="w-4 h-4 shrink-0 mt-0.5"
          />
          <span>
            <span className="text-sm font-medium text-[var(--color-newsprint-black)] block">
              增量（仅缺失则下载）
            </span>
            <span className="text-xs text-[var(--color-muted)] leading-snug block mt-0.5">
              已存在的文件不重复下载
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name={policyId}
            checked={forceOverwrite}
            onChange={() => onForceOverwriteChange(true)}
            className="w-4 h-4 shrink-0 mt-0.5"
          />
          <span>
            <span className="text-sm font-medium text-[var(--color-newsprint-black)] block">
              强制覆盖（重新下载并覆盖）
            </span>
            <span className="text-xs text-[var(--color-muted)] leading-snug block mt-0.5">
              对已勾选的首帧/资产均生效
            </span>
          </span>
        </label>
      </fieldset>
    </div>
  )
}
