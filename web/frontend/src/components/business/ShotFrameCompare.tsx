/**
 * 首帧 + 尾帧同屏对比展示
 *
 * - card：分镜板网格卡片内双列等高竖幅（9:16），便于左右对照
 * - pick：选片总览左栏专用；仍为双列对照，但通过 max-h 压扁高度，避免占满整卡
 * - row：列表视图内紧凑双列
 * - detail：详情页顶区大号双列（与 card 类似但略大）
 *
 * 所有带 padding 的容器使用 box-border，避免宽度溢出
 */
import { Link } from "react-router"
import { Loader2 } from "lucide-react"
import type { Shot } from "@/types"
import { getFileUrl } from "@/utils/file"
import { routes } from "@/utils/routes"
import { ImagePreview } from "./ImagePreview"
import { FrameHoverThumbnail } from "./FrameHoverThumbnail"

export type ShotFrameCompareVariant = "card" | "pick" | "row" | "detail"

interface ShotFrameCompareProps {
  shot: Shot
  /** 所属项目 UUID（新路由 /project/:projectId/...） */
  projectId: string
  episodeId: string
  basePath: string
  cacheBust?: string
  variant?: ShotFrameCompareVariant
  /** 尾帧生成中：右侧显示 loading */
  showEndSkeleton?: boolean
  /** 尾帧失败：右侧显示重试（需阻止冒泡以免误触跳转） */
  onRetryEndframe?: () => void
}

const variantClass: Record<
  ShotFrameCompareVariant,
  { wrap: string; img: string; label: string }
> = {
  card: {
    wrap: "grid grid-cols-2 gap-2 box-border",
    img: "relative w-full aspect-[9/16] overflow-hidden bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)]",
    label: "text-[9px] font-black uppercase tracking-wider text-[var(--color-muted)] mb-1.5",
  },
  /** 选片页左栏：与 card 同交互（点击进入详情），但更紧凑以腾出右栏候选区 */
  pick: {
    wrap: "grid grid-cols-2 gap-2 box-border min-w-0",
    img: "relative w-full aspect-[9/16] max-h-[min(280px,35vh)] overflow-hidden bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)]",
    label: "text-[9px] font-black uppercase tracking-wider text-[var(--color-muted)] mb-1",
  },
  row: {
    wrap: "flex items-stretch gap-3 box-border min-w-0",
    img: "relative w-[5rem] h-[7.5rem] shrink-0 overflow-hidden bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)]",
    label: "text-[8px] font-black uppercase text-[var(--color-muted)] mb-0.5",
  },
  detail: {
    wrap: "grid grid-cols-2 gap-4 box-border",
    img: "relative w-full aspect-[9/16] max-h-[min(70vh,520px)] overflow-hidden bg-[var(--color-outline-variant)]",
    label: "text-xs text-[var(--color-muted)] mb-2",
  },
}

export function ShotFrameCompare({
  shot,
  projectId,
  episodeId,
  basePath,
  cacheBust,
  variant = "card",
  showEndSkeleton = false,
  onRetryEndframe,
}: ShotFrameCompareProps) {
  const detailPath = routes.shot(projectId, episodeId, shot.shotId)
  const firstFrameUrl = getFileUrl(shot.firstFrame, basePath, cacheBust)
  const endFrameUrl = shot.endFrame ? getFileUrl(shot.endFrame, basePath, cacheBust) : null
  const vc = variantClass[variant]

  const imgClass =
    variant === "row"
      ? "w-full h-full object-cover grayscale-img"
      : "absolute inset-0 w-full h-full object-cover grayscale-img"

  /** 详情页：可点击放大；列表 row：悬浮大图 + 点击进入镜头详情；卡片：直接进入详情 */
  const firstFrameBody =
    firstFrameUrl && variant === "detail" ? (
      <ImagePreview src={firstFrameUrl} alt="首帧" className={`${vc.img} max-h-[min(70vh,520px)]`} />
    ) : firstFrameUrl && variant === "row" ? (
      <FrameHoverThumbnail
        src={firstFrameUrl}
        alt="首帧"
        detailPath={detailPath}
        thumbClassName={vc.img}
        imgClassName={imgClass}
      />
    ) : firstFrameUrl ? (
      <Link to={detailPath} className="block">
        <div className={vc.img}>
          <img src={firstFrameUrl} alt="首帧" className={imgClass} />
        </div>
      </Link>
    ) : (
      <div className={vc.img}>
        <div
          className={`flex items-center justify-center text-[var(--color-muted)] bg-[var(--color-outline-variant)] ${
            variant === "row" ? "w-full h-full text-[10px]" : "absolute inset-0 text-xs"
          }`}
        >
          暂无
        </div>
      </div>
    )

  const endPlaceholder = (
    <div
      className={`flex items-center justify-center border border-dashed border-[var(--color-newsprint-black)] text-[var(--color-muted)] bg-[var(--color-outline-variant)]/50 box-border ${
        variant === "row" ? "w-full h-full text-[9px] px-0.5 text-center" : "absolute inset-0 text-xs"
      }`}
    >
      待生成
    </div>
  )

  const endFrameBody = showEndSkeleton ? (
    <div className={vc.img}>
      <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-outline-variant)]">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-muted)]" aria-hidden />
      </div>
    </div>
  ) : endFrameUrl && variant === "detail" ? (
    <ImagePreview src={endFrameUrl} alt="尾帧" className={`${vc.img} max-h-[min(70vh,520px)]`} />
  ) : endFrameUrl && variant === "row" ? (
    <FrameHoverThumbnail
      src={endFrameUrl}
      alt="尾帧"
      detailPath={detailPath}
      thumbClassName={vc.img}
      imgClassName={imgClass}
    />
  ) : endFrameUrl ? (
    <Link to={detailPath} className="block">
      <div className={vc.img}>
        <img src={endFrameUrl} alt="尾帧" className={imgClass} />
      </div>
    </Link>
  ) : shot.status === "error" && onRetryEndframe ? (
    <div className={`${vc.img} flex flex-col items-center justify-center gap-1 box-border p-1`}>
      <span className="text-[var(--color-error)] text-[10px]">失败</span>
      <button
        type="button"
        className="text-[10px] underline font-bold"
        onClick={(e) => {
          e.preventDefault()
          onRetryEndframe()
        }}
      >
        重试
      </button>
    </div>
  ) : variant === "detail" ? (
    <div className={vc.img}>{endPlaceholder}</div>
  ) : (
    <Link to={detailPath} className={`block ${vc.img}`}>
      {endPlaceholder}
    </Link>
  );

  const framed =
    variant === "card" || variant === "pick"

  return (
    <div className={vc.wrap}>
      <div
        className={`min-w-0 box-border rounded-sm ${
          framed
            ? "p-2 border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]/25"
            : ""
        }`}
        style={{ boxSizing: "border-box" }}
      >
        <p className={vc.label}>首帧</p>
        {firstFrameBody}
      </div>

      <div
        className={`min-w-0 box-border rounded-sm ${
          framed
            ? "p-2 border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)]/25"
            : ""
        }`}
        style={{ boxSizing: "border-box" }}
      >
        <p className={vc.label}>尾帧</p>
        {endFrameBody}
      </div>
    </div>
  )
}
