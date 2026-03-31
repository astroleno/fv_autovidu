/**
 * 后期制作单页：配音（DubPanel）与剪映导出（画布 + 字幕参数）聚合。
 *
 * - 路由：`/project/:projectId/episode/:episodeId/post-production`
 * - localStorage：草稿路径用全局 `LS_JIANYING_DRAFT_PATH`；画布与字幕默认按 `episodeId` 键 `fv_jianying_episode_defaults:${episodeId}`
 * - 与分镜页 Dub/Export 可并存（设计 §11.2）
 */
import { useCallback, useEffect, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router"
import { ArrowLeft, Loader2, Sparkles } from "lucide-react"
import { useEpisodeStore, useToastStore } from "@/stores"
import { DubPanel } from "@/components/business/DubPanel"
import { JianyingExportDialog, LS_JIANYING_DRAFT_PATH } from "@/components/business/JianyingExportDialog"
import {
  JianyingExportResultCard,
  JianyingSubtitleHints,
  SubtitlePositionPreview,
} from "@/components/postProduction"
import { Button } from "@/components/ui"
import { exportApi } from "@/api/export"
import { routes } from "@/utils/routes"
import type { Episode } from "@/types"
import { flattenShots } from "@/types"

/** 按剧集记忆剪映表单默认（不含 draftPath，草稿根仍为全局键） */
function episodeJianyingDefaultsKey(episodeId: string): string {
  return `fv_jianying_episode_defaults:${episodeId}`
}

type SubtitleAlign = "left" | "center" | "right"

interface EpisodeJianyingFormState {
  canvasSize: "720p" | "1080p"
  subtitleFontSize: number
  subtitleAlign: SubtitleAlign
  subtitleAutoWrapping: boolean
  subtitleTransformY: number
}

const JIANYING_DEFAULTS: EpisodeJianyingFormState = {
  canvasSize: "1080p",
  subtitleFontSize: 8,
  subtitleAlign: "center",
  subtitleAutoWrapping: true,
  subtitleTransformY: -0.8,
}

/** 最近一次剪映导出成功结果（用于结果卡，非持久化） */
interface LastJianyingExportState {
  primaryPath: string
  draftDir: string
  exportedShots: number
  exportedAt: string
}

export default function PostProductionPage() {
  const [searchParams] = useSearchParams()
  /** 与选片页一致：?shotId= 深链至后期制作并展开该镜试听区 */
  const highlightShotId = searchParams.get("shotId")?.trim() || undefined

  const { projectId: routeProjectId, episodeId } = useParams<{
    projectId?: string
    episodeId: string
  }>()
  const {
    currentEpisode,
    loading,
    fetchEpisodeDetail,
    updateEpisodeLocales,
  } = useEpisodeStore()
  const pushToast = useToastStore((s) => s.push)

  const [tab, setTab] = useState<"dub" | "jianying">("dub")
  const [dubTargetDraft, setDubTargetDraft] = useState("")
  const [sourceLocaleDraft, setSourceLocaleDraft] = useState("")
  const [draftPath, setDraftPath] = useState("")
  const [jianyingForm, setJianyingForm] = useState<EpisodeJianyingFormState>(
    JIANYING_DEFAULTS
  )
  const [jianyingBusy, setJianyingBusy] = useState(false)
  const [pathDialogOpen, setPathDialogOpen] = useState(false)
  const [lastJianyingExport, setLastJianyingExport] =
    useState<LastJianyingExportState | null>(null)

  /** 关闭「侦测路径」弹窗后同步全局草稿路径到输入框 */
  useEffect(() => {
    if (pathDialogOpen) return
    try {
      const g = localStorage.getItem(LS_JIANYING_DRAFT_PATH)?.trim()
      if (g) setDraftPath(g)
    } catch {
      /* ignore */
    }
  }, [pathDialogOpen])

  useEffect(() => {
    if (episodeId) void fetchEpisodeDetail(episodeId)
  }, [episodeId, fetchEpisodeDetail])

  useEffect(() => {
    if (!currentEpisode) return
    setDubTargetDraft(currentEpisode.dubTargetLocale ?? "")
    setSourceLocaleDraft(currentEpisode.sourceLocale ?? "")
  }, [currentEpisode])

  /** 恢复全局草稿路径 + 本集画布/字幕默认 */
  useEffect(() => {
    if (!episodeId) return
    try {
      const g = localStorage.getItem(LS_JIANYING_DRAFT_PATH)?.trim()
      if (g) setDraftPath(g)
    } catch {
      /* ignore */
    }
    try {
      const raw = localStorage.getItem(episodeJianyingDefaultsKey(episodeId))
      if (!raw) return
      const o = JSON.parse(raw) as Partial<EpisodeJianyingFormState>
      setJianyingForm((prev) => ({
        ...prev,
        ...o,
        canvasSize: o.canvasSize === "720p" || o.canvasSize === "1080p" ? o.canvasSize : prev.canvasSize,
        subtitleAlign:
          o.subtitleAlign === "left" ||
          o.subtitleAlign === "center" ||
          o.subtitleAlign === "right"
            ? o.subtitleAlign
            : prev.subtitleAlign,
      }))
    } catch {
      /* ignore */
    }
  }, [episodeId])

  const persistJianyingDefaults = useCallback(
    (next: EpisodeJianyingFormState) => {
      if (!episodeId) return
      try {
        localStorage.setItem(
          episodeJianyingDefaultsKey(episodeId),
          JSON.stringify(next)
        )
      } catch {
        /* ignore */
      }
    },
    [episodeId]
  )

  const updateJianyingField = useCallback(
    (patch: Partial<EpisodeJianyingFormState>) => {
      setJianyingForm((prev) => {
        const n = { ...prev, ...patch }
        persistJianyingDefaults(n)
        return n
      })
    },
    [persistJianyingDefaults]
  )

  const saveLocaleBar = useCallback(async () => {
    if (!episodeId || !currentEpisode) return
    const nextDub = dubTargetDraft.trim()
    const nextSrc = sourceLocaleDraft.trim()
    const patch: Partial<Pick<Episode, "dubTargetLocale" | "sourceLocale">> = {}
    if (nextDub !== (currentEpisode.dubTargetLocale ?? "").trim()) {
      patch.dubTargetLocale = nextDub
    }
    if (nextSrc !== (currentEpisode.sourceLocale ?? "").trim()) {
      patch.sourceLocale = nextSrc
    }
    if (Object.keys(patch).length === 0) return
    await updateEpisodeLocales(episodeId, patch)
  }, [
    currentEpisode,
    dubTargetDraft,
    episodeId,
    sourceLocaleDraft,
    updateEpisodeLocales,
  ])

  const projectId = routeProjectId ?? currentEpisode?.projectId ?? ""
  const backUrl =
    projectId && episodeId
      ? routes.episode(projectId, episodeId)
      : routes.home()

  const submitJianyingExport = async () => {
    if (!episodeId) return
    const dp = draftPath.trim()
    if (!dp) {
      pushToast("请填写本机剪映草稿根目录", "error")
      return
    }
    setJianyingBusy(true)
    try {
      const res = await exportApi.jianyingDraft({
        episodeId,
        draftPath: dp,
        canvasSize: jianyingForm.canvasSize,
        subtitleFontSize: jianyingForm.subtitleFontSize,
        subtitleAlign: jianyingForm.subtitleAlign,
        subtitleAutoWrapping: jianyingForm.subtitleAutoWrapping,
        subtitleTransformY: jianyingForm.subtitleTransformY,
      })
      try {
        localStorage.setItem(LS_JIANYING_DRAFT_PATH, dp)
      } catch {
        /* ignore */
      }
      const primary =
        (res.data.jianyingCopyPath && res.data.jianyingCopyPath.trim()) ||
        res.data.draftDir
      setLastJianyingExport({
        primaryPath: primary,
        draftDir: res.data.draftDir,
        exportedShots: res.data.exportedShots,
        exportedAt: res.data.exportedAt,
      })
      pushToast(
        `剪映草稿已导出：${res.data.jianyingCopyPath ?? res.data.draftDir}`,
        "success",
        8000
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast(`导出失败：${msg}`, "error")
    } finally {
      setJianyingBusy(false)
    }
  }

  if (!episodeId) {
    return (
      <div className="p-8 text-sm text-[var(--color-muted)]">缺少 episodeId</div>
    )
  }

  if (loading && !currentEpisode) {
    return (
      <div className="p-8 flex items-center gap-2 text-[var(--color-muted)]">
        <Loader2 className="w-5 h-5 animate-spin" />
        加载剧集…
      </div>
    )
  }

  if (!currentEpisode) {
    return (
      <div className="p-8 text-sm text-[var(--color-muted)]">未找到剧集</div>
    )
  }

  return (
    <div
      className="max-w-5xl mx-auto px-4 py-8 box-border space-y-6"
      style={{ boxSizing: "border-box" }}
    >
      <header className="flex flex-wrap items-start gap-4 border-b border-[var(--color-divider)] pb-6">
        <Link
          to={backUrl}
          className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-primary)] hover:underline"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          返回分镜
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-newsprint-black)] flex items-center gap-2">
            <Sparkles className="w-6 h-6 shrink-0 text-[var(--color-primary)]" />
            后期制作
          </h1>
          <p className="text-sm text-[var(--color-muted)] mt-1">
            {currentEpisode.episodeTitle} ·{" "}
            {flattenShots(currentEpisode).length} 个镜头
          </p>
        </div>
      </header>

      <div
        className="flex flex-wrap gap-2 border-b border-[var(--color-divider)] pb-2"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "dub"}
          onClick={() => setTab("dub")}
          className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-2 box-border ${
            tab === "dub"
              ? "border-[var(--color-newsprint-black)] bg-[var(--color-primary)] text-white"
              : "border-transparent bg-[var(--color-outline-variant)]/50 hover:bg-[var(--color-outline-variant)]"
          }`}
          style={{ boxSizing: "border-box" }}
        >
          配音
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "jianying"}
          onClick={() => setTab("jianying")}
          className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-2 box-border ${
            tab === "jianying"
              ? "border-[var(--color-newsprint-black)] bg-[var(--color-primary)] text-white"
              : "border-transparent bg-[var(--color-outline-variant)]/50 hover:bg-[var(--color-outline-variant)]"
          }`}
          style={{ boxSizing: "border-box" }}
        >
          剪映导出
        </button>
      </div>

      {tab === "dub" ? (
        <div className="space-y-6">
          <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
            完整配音与语言设置；分镜页亦保留快捷入口时可并存。
          </p>
          <div
            className="flex flex-wrap items-end gap-4 p-4 border border-[var(--color-divider)] bg-[var(--color-newsprint-off-white)]/40 box-border"
            style={{ boxSizing: "border-box" }}
          >
            <div
              className="flex flex-col gap-1 min-w-[8rem] box-border"
              style={{ boxSizing: "border-box" }}
            >
              <label
                htmlFor="pp-dub-target"
                className="text-[10px] font-black uppercase text-[var(--color-muted)]"
              >
                配音目标语
              </label>
              <input
                id="pp-dub-target"
                type="text"
                value={dubTargetDraft}
                onChange={(e) => setDubTargetDraft(e.target.value)}
                className="px-2 py-1.5 text-sm border border-[var(--color-newsprint-black)] bg-white min-w-[12rem] box-border"
                style={{ boxSizing: "border-box" }}
                placeholder="如 en-US"
                autoComplete="off"
              />
            </div>
            <div
              className="flex flex-col gap-1 min-w-[8rem] box-border"
              style={{ boxSizing: "border-box" }}
            >
              <label
                htmlFor="pp-source-locale"
                className="text-[10px] font-black uppercase text-[var(--color-muted)]"
              >
                原文语言
              </label>
              <input
                id="pp-source-locale"
                type="text"
                value={sourceLocaleDraft}
                onChange={(e) => setSourceLocaleDraft(e.target.value)}
                className="px-2 py-1.5 text-sm border border-[var(--color-newsprint-black)] bg-white min-w-[12rem] box-border"
                style={{ boxSizing: "border-box" }}
                placeholder="如 zh-CN"
                autoComplete="off"
              />
            </div>
            <Button type="button" variant="primary" onClick={() => void saveLocaleBar()}>
              保存语言
            </Button>
          </div>
          <DubPanel episodeId={episodeId} initialHighlightShotId={highlightShotId} />
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
            草稿根目录为<strong>本机全局</strong>；画布与字幕默认按本集记忆。
          </p>
          <JianyingSubtitleHints />
          <div
            className="grid gap-4 p-4 border border-[var(--color-divider)] bg-white box-border"
            style={{ boxSizing: "border-box" }}
          >
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase text-[var(--color-muted)]">
                剪映草稿根目录（本机）
              </label>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="text"
                  value={draftPath}
                  onChange={(e) => setDraftPath(e.target.value)}
                  className="flex-1 min-w-[200px] px-2 py-1.5 text-sm border border-[var(--color-newsprint-black)] box-border"
                  style={{ boxSizing: "border-box" }}
                  placeholder="/Users/…/JianyingPro Drafts"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPathDialogOpen(true)}
                >
                  侦测路径…
                </Button>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase text-[var(--color-muted)]">
                  画布
                </label>
                <select
                  value={jianyingForm.canvasSize}
                  onChange={(e) =>
                    updateJianyingField({
                      canvasSize: e.target.value as "720p" | "1080p",
                    })
                  }
                  className="px-2 py-1.5 text-sm border border-[var(--color-newsprint-black)] bg-white box-border"
                  style={{ boxSizing: "border-box" }}
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase text-[var(--color-muted)]">
                  字幕字号（4–16）
                </label>
                <input
                  type="number"
                  min={4}
                  max={16}
                  value={jianyingForm.subtitleFontSize}
                  onChange={(e) =>
                    updateJianyingField({
                      subtitleFontSize: Math.min(
                        16,
                        Math.max(4, parseInt(e.target.value, 10) || 8)
                      ),
                    })
                  }
                  className="px-2 py-1.5 text-sm border border-[var(--color-newsprint-black)] box-border"
                  style={{ boxSizing: "border-box" }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-black uppercase text-[var(--color-muted)]">
                  水平对齐
                </label>
                <select
                  value={jianyingForm.subtitleAlign}
                  onChange={(e) =>
                    updateJianyingField({
                      subtitleAlign: e.target.value as SubtitleAlign,
                    })
                  }
                  className="px-2 py-1.5 text-sm border border-[var(--color-newsprint-black)] bg-white box-border"
                  style={{ boxSizing: "border-box" }}
                >
                  <option value="left">左</option>
                  <option value="center">中</option>
                  <option value="right">右</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={jianyingForm.subtitleAutoWrapping}
                  onChange={(e) =>
                    updateJianyingField({
                      subtitleAutoWrapping: e.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-[var(--color-primary)]"
                />
                自动换行
              </label>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-[10px] font-black uppercase text-[var(--color-muted)]">
                  字幕纵向位置（-1～0，步进 0.05）
                </label>
                <input
                  type="range"
                  min={-1}
                  max={0}
                  step={0.05}
                  value={jianyingForm.subtitleTransformY}
                  onChange={(e) =>
                    updateJianyingField({
                      subtitleTransformY: parseFloat(e.target.value),
                    })
                  }
                  className="w-full"
                />
                <span className="text-xs text-[var(--color-muted)]">
                  {jianyingForm.subtitleTransformY.toFixed(2)}
                </span>
                <SubtitlePositionPreview transformY={jianyingForm.subtitleTransformY} />
              </div>
            </div>
            <Button
              type="button"
              variant="primary"
              disabled={jianyingBusy}
              onClick={() => void submitJianyingExport()}
              className="gap-2"
            >
              {jianyingBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : null}
              导出到剪映目录
            </Button>
            {lastJianyingExport ? (
              <JianyingExportResultCard
                primaryPath={lastJianyingExport.primaryPath}
                draftDir={lastJianyingExport.draftDir}
                exportedShots={lastJianyingExport.exportedShots}
                exportedAt={lastJianyingExport.exportedAt}
              />
            ) : null}
          </div>
        </div>
      )}

      <JianyingExportDialog
        open={pathDialogOpen}
        onClose={() => setPathDialogOpen(false)}
        episodeId={episodeId}
      />
    </div>
  )
}
