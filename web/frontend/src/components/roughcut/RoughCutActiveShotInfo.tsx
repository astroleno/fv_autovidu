/**
 * 粗剪台 — 右侧「镜头详情」面板
 *
 * 与预览并排展示当前选中镜头的完整只读信息（编号、时长、画幅、状态、
 * **首帧/尾帧缩略图**、画面描述、运镜、视频提示词、配音状态），无需跳转路由。
 * STS/TTS 任务在后期制作页提交；此处仅展示状态徽标与说明文案。
 */
import { DubStatusBadge } from "@/components/business/DubStatusBadge"
import { ImagePreview } from "@/components/business/ImagePreview"
import type { Shot } from "@/types"
import { getFileUrl } from "@/utils/file"
import { formatTimeMmSs } from "./roughcutUtils"

export interface RoughCutActiveShotInfoProps {
  /** 当前在时间线或预览上选中的镜头；无选中时为 null */
  shot: Shot | null
  /** 与 episode 资源一致：`projectId/episodeId`，用于拼接首帧/尾帧本地路径 */
  basePath: string
  /** 与 getFileUrl 一致，拉取后刷新图片缓存 */
  cacheBust?: string
}

/**
 * 竖向滚动侧栏：信息密度高时内部滚动，不撑破整页 Grid
 */
export function RoughCutActiveShotInfo({ shot, basePath, cacheBust }: RoughCutActiveShotInfoProps) {
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col border border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] box-border"
      style={{ boxSizing: "border-box" }}
      aria-label="镜头详情"
    >
      <div
        className="shrink-0 border-b border-[var(--color-newsprint-black)] bg-white px-3 py-2"
        style={{ boxSizing: "border-box" }}
      >
        <h3 className="font-headline text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-newsprint-black)]">
          镜头详情
        </h3>
      </div>

      {!shot ? (
        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-xs leading-relaxed text-[var(--color-muted)] box-border"
          style={{ boxSizing: "border-box" }}
        >
          在下方轨道点击镜头，即可在此查看首尾帧、画面描述、提示词与配音状态。
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-[var(--color-ink)] box-border"
          style={{ boxSizing: "border-box" }}
        >
          {/* 基础元数据 */}
          <dl className="space-y-2 text-xs">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <dt className="sr-only">镜头编号</dt>
              <dd className="font-mono text-sm font-bold uppercase text-[var(--color-newsprint-black)]">
                SHOT_{String(shot.shotNumber).padStart(2, "0")}
              </dd>
            </div>
            <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
              <dt className="text-[10px] font-bold uppercase text-[var(--color-muted)]">时长</dt>
              <dd className="font-mono text-[11px]">{formatTimeMmSs(shot.duration)}</dd>
              <dt className="text-[10px] font-bold uppercase text-[var(--color-muted)]">画幅</dt>
              <dd className="text-[11px]">{shot.aspectRatio || "—"}</dd>
              <dt className="text-[10px] font-bold uppercase text-[var(--color-muted)]">状态</dt>
              <dd className="text-[11px] uppercase">{shot.status}</dd>
            </div>
          </dl>

          {/* 首帧 / 尾帧：与 episode.json 中 firstFrame、endFrame 本地路径对应 */}
          <section className="mt-3" aria-label="首尾帧预览">
            <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
              首帧 / 尾帧
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <FrameSlot
                label="首帧"
                url={
                  shot.firstFrame?.trim()
                    ? getFileUrl(shot.firstFrame, basePath, cacheBust)
                    : ""
                }
              />
              <FrameSlot
                label="尾帧"
                url={
                  shot.endFrame?.trim()
                    ? getFileUrl(shot.endFrame, basePath, cacheBust)
                    : ""
                }
              />
            </div>
          </section>

          {/* 配音：仅展示状态；全量配置与任务入口在后期制作页（此处不跳转） */}
          <div
            className="mt-3 border border-[var(--color-outline-variant)] bg-white p-2 box-border"
            style={{ boxSizing: "border-box" }}
          >
            <p className="mb-1 text-[10px] font-bold uppercase text-[var(--color-muted)]">配音</p>
            <div className="flex flex-wrap items-center gap-2">
              <DubStatusBadge dub={shot.dub} />
            </div>
            <p className="mt-2 text-[10px] leading-snug text-[var(--color-muted)]">
              STS / TTS 在后期制作页配置与提交；此处仅同步状态。
            </p>
          </div>

          {/* 画面描述 */}
          <section className="mt-3">
            <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
              画面描述
            </h4>
            <p className="text-xs leading-relaxed text-[var(--color-ink)]">
              {shot.visualDescription?.trim() ||
                shot.imagePrompt?.trim() ||
                "（暂无）"}
            </p>
          </section>

          {/* 运镜 */}
          {shot.cameraMovement?.trim() ? (
            <section className="mt-3">
              <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                运镜 / 构图
              </h4>
              <p className="text-xs leading-relaxed text-[var(--color-ink)]">{shot.cameraMovement}</p>
            </section>
          ) : null}

          {/* 视频提示词（可较长，保持可滚动） */}
          {shot.videoPrompt?.trim() ? (
            <section className="mt-3">
              <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                视频提示词
              </h4>
              <p className="break-words text-[11px] leading-relaxed text-[var(--color-muted)]">
                {shot.videoPrompt}
              </p>
            </section>
          ) : null}

          {/* 首帧提示（与画面描述区分：无 visual 时用 imagePrompt 已在上面合并） */}
          {shot.visualDescription?.trim() && shot.imagePrompt?.trim() && shot.imagePrompt !== shot.visualDescription ? (
            <section className="mt-3">
              <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                图片提示词
              </h4>
              <p className="break-words text-[11px] leading-relaxed text-[var(--color-muted)]">{shot.imagePrompt}</p>
            </section>
          ) : null}
        </div>
      )}
    </aside>
  )
}

/**
 * 单帧占位：有路径则可点击放大（ImagePreview），无则灰底提示
 */
function FrameSlot({ label, url }: { label: string; url: string }) {
  return (
    <div className="min-w-0 box-border" style={{ boxSizing: "border-box" }}>
      <p className="mb-1 text-[9px] font-bold uppercase text-[var(--color-muted)]">{label}</p>
      {url ? (
        <ImagePreview
          src={url}
          alt={label}
          className="aspect-video max-h-[120px] w-full bg-[var(--color-outline-variant)]"
        />
      ) : (
        <div
          className="flex aspect-video max-h-[120px] w-full items-center justify-center border border-dashed border-[var(--color-newsprint-black)]/40 bg-white/60 px-1 text-center text-[9px] text-[var(--color-muted)] box-border"
          style={{ boxSizing: "border-box" }}
        >
          暂无
        </div>
      )}
    </div>
  )
}
