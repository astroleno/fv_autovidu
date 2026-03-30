/**
 * RegenFramePanel — 单帧重生工作区
 * ---------------------------------
 * 将「画面描述 + 资产勾选」提交到 POST /api/generate/regen-frame，并通过 taskStore
 * 轮询 regen-* 任务直至 success/failed；成功后刷新剧集数据并用时间戳 bust 首帧图缓存。
 *
 * 与后端约定：
 * - 任务 ID 前缀 `regen-`，任务类型在服务端 task_store 记为 regen
 * - 成功后会覆盖 frames/Sxx.png、清空尾帧与 videoCandidates、状态回 pending
 */
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import { Loader2 } from "lucide-react"
import type { Shot, ShotAsset } from "@/types"
import { generateApi } from "@/api/generate"
import { useTaskStore, useToastStore } from "@/stores"
import { Button, Dialog } from "@/components/ui"
import { AssetSelector } from "@/components/business/AssetSelector"
import { ImagePreview } from "@/components/business/ImagePreview"
import { PromptEditor } from "@/components/business/PromptEditor"
import { getFileUrl } from "@/utils/file"
import { routes } from "@/utils/routes"

type RegenTaskPhase = "idle" | "submitting" | "polling" | "success" | "failed" | "aborted"

/** RegenFramePanel 的入参：由 RegenPage 注入剧集与镜头上下文 */
export interface RegenFramePanelProps {
  /** 当前剧集 ID（API 路径参数） */
  episodeId: string
  /** 用于返回镜头详情 / 分镜板链接 */
  projectId: string
  /** 当前编辑的镜头（含 firstFrame、imagePrompt、assets） */
  shot: Shot
  /**
   * 可选资产列表：优先 episode 级全量资产库，否则由页面从 shots 去重得到
   */
  uniqueAssets: ShotAsset[]
  /** 文件代理路径前缀 projectId/episodeId */
  basePath: string
  /** episode.pulledAt，用于未重生前的默认缓存破坏 */
  episodeCacheBust?: string
}

/**
 * 将首帧相对路径转为可展示的 URL；success 后传入 frameBust 强制浏览器拉新图
 */
function firstFramePreviewUrl(
  firstFrame: string,
  basePath: string,
  episodeCacheBust: string | undefined,
  /** 最近一次重生成功时写入的时间戳，覆盖 episodeCacheBust */
  frameBust: string | undefined
): string {
  const v = frameBust ?? episodeCacheBust
  return getFileUrl(firstFrame, basePath, v)
}

export function RegenFramePanel({
  episodeId,
  projectId,
  shot,
  uniqueAssets,
  basePath,
  episodeCacheBust,
}: RegenFramePanelProps) {
  /** 与编辑器绑定的画面描述（提交时用 trim 后内容） */
  const [prompt, setPrompt] = useState(shot.imagePrompt)
  /** 参与重生推理的资产 ID 列表（最多 2 张由后端截取） */
  const [assetIds, setAssetIds] = useState<string[]>(() =>
    shot.assets.map((a) => a.assetId)
  )
  /** 二次确认弹窗：避免误触覆盖首帧 */
  const [confirmOpen, setConfirmOpen] = useState(false)
  /**
   * 从点击确认到任务终态：包含 HTTP 请求等待与后台 Yunwu 生图时间，
   * 期间禁用按钮避免重复提交
   */
  const [busy, setBusy] = useState(false)
  /**
   * 最近一次重生成功时刻的时间戳字符串，写入 getFileUrl 的 v= 以绕过浏览器磁盘缓存
   */
  const [frameBust, setFrameBust] = useState<string | undefined>(undefined)
  /** 最近一次提交到后端的任务 id，供用户确认是否已入队 */
  const [submittedTaskId, setSubmittedTaskId] = useState<string | null>(null)
  /** 页面内常驻任务状态，避免只靠瞬时 Toast 猜测是否已提交 */
  const [taskPhase, setTaskPhase] = useState<RegenTaskPhase>("idle")
  const [taskMessage, setTaskMessage] = useState("")

  const startPolling = useTaskStore((s) => s.startPolling)
  const pushToast = useToastStore((s) => s.push)

  /**
   * 切换镜头时：表单重置为服务端数据，并清除仅作用于上一镜头的预览 bust
   */
  useEffect(() => {
    setPrompt(shot.imagePrompt)
    setAssetIds(shot.assets.map((a) => a.assetId))
    setFrameBust(undefined)
    setSubmittedTaskId(null)
    setTaskPhase("idle")
    setTaskMessage("")
  }, [shot.shotId])

  const previewSrc = firstFramePreviewUrl(
    shot.firstFrame,
    basePath,
    episodeCacheBust,
    frameBust
  )

  const toggleAsset = useCallback((id: string) => {
    setAssetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }, [])

  /**
   * 执行重生：先调 API 拿 taskId，再交给全局 taskStore 轮询直至终态
   */
  const runRegen = useCallback(async () => {
    const imagePrompt = prompt.trim()
    if (!imagePrompt) {
      pushToast("请填写画面描述后再生成", "error")
      return
    }
    if (!shot.firstFrame?.trim()) {
      pushToast("当前镜头缺少首帧文件，无法重生", "error")
      return
    }

    setBusy(true)
    setConfirmOpen(false)
    setSubmittedTaskId(null)
    setTaskPhase("submitting")
    setTaskMessage("正在提交重生任务…")
    try {
      const { data } = await generateApi.regenFrame({
        episodeId,
        shotId: shot.shotId,
        imagePrompt,
        assetIds,
      })
      const taskId = data.taskId
      setSubmittedTaskId(taskId)
      setTaskPhase("polling")
      setTaskMessage("任务已提交，正在后台生成首帧。")
      pushToast("已提交单帧重生任务，正在生成…", "info")

      startPolling([taskId], {
        episodeId,
        /** 连续网络失败导致轮询中止时也要解锁 UI（见 taskStore onPollAborted） */
        onPollAborted: () => {
          setBusy(false)
          setTaskPhase("aborted")
          setTaskMessage("任务已提交，但状态轮询中断；可稍后刷新本页确认结果。")
        },
        onAllSettled: (results) => {
          setBusy(false)
          const r = results[0]
          if (!r) {
            setTaskPhase("failed")
            setTaskMessage("未返回任务状态")
            pushToast("未返回任务状态", "error")
            return
          }
          if (r.status === "success") {
            setFrameBust(String(Date.now()))
            setTaskPhase("success")
            setTaskMessage("首帧已生成并落盘，左侧预览已刷新。")
            pushToast("首帧已更新；尾帧与视频候选已清空，请按需重新生成", "success")
            return
          }
          const msg =
            typeof r.error === "string" && r.error
              ? r.error
              : "单帧重生失败"
          setTaskPhase("failed")
          setTaskMessage(msg)
          pushToast(msg, "error")
        },
      })
    } catch (e) {
      setBusy(false)
      const msg = e instanceof Error ? e.message : "单帧重生请求失败"
      setTaskPhase("failed")
      setTaskMessage(msg)
      pushToast(msg, "error")
    }
  }, [
    prompt,
    shot.shotId,
    shot.firstFrame,
    episodeId,
    assetIds,
    startPolling,
    pushToast,
  ])

  const shotLabel = `S${String(shot.shotNumber).padStart(2, "0")}`

  return (
    <div className="space-y-8">
      {/* 顶栏：标题 + 返回选片工作台（picking 深链） */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-4xl font-extrabold uppercase tracking-tighter text-[var(--color-newsprint-black)] font-headline">
          单帧重生 - {shotLabel}
        </h1>
        <Link
          to={routes.videopickShot(projectId, episodeId, shot.shotId)}
          className="text-sm font-bold uppercase tracking-wider text-[var(--color-primary)] underline underline-offset-4"
        >
          ← 返回选片工作台
        </Link>
      </div>

      {busy && (
        <div
          role="status"
          className="flex items-center gap-2 rounded border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] px-4 py-3 text-sm font-medium text-[var(--color-newsprint-black)] box-border"
          style={{ boxSizing: "border-box" }}
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          <span>首帧重生进行中，请稍候…</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 左栏：当前首帧大图（路径不变，靠 v= 刷新） */}
        <section className="box-border space-y-2" style={{ boxSizing: "border-box" }}>
          <p className="text-sm text-[var(--color-muted)]">当前首帧</p>
          {previewSrc ? (
            <ImagePreview src={previewSrc} alt="首帧" className="aspect-video" />
          ) : (
            <div
              className="aspect-video bg-[var(--color-outline-variant)] border border-[var(--color-newsprint-black)] box-border"
              style={{ boxSizing: "border-box" }}
            />
          )}
        </section>

        {/* 中栏：Prompt + 资产 + 提交 */}
        <section
          className={`box-border space-y-4 ${busy ? "pointer-events-none opacity-60" : ""}`}
          style={{ boxSizing: "border-box" }}
        >
          <div>
            <p className="text-sm text-[var(--color-muted)] mb-2">画面描述</p>
            <PromptEditor value={prompt} onChange={setPrompt} />
          </div>
          <div>
            <p className="text-sm text-[var(--color-muted)] mb-2">
              选择资产（可选，最多 2 张参与推理）
            </p>
            <AssetSelector
              assets={uniqueAssets}
              selectedIds={assetIds}
              onToggle={toggleAsset}
              basePath={basePath}
              cacheBust={episodeCacheBust}
            />
          </div>
          <Button
            variant="primary"
            className="mt-2 w-full"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                处理中
              </>
            ) : (
              "生成新首帧"
            )}
          </Button>
          <p className="text-xs text-[var(--color-muted)]">
            点击后会先二次确认，再提交后台生成任务。
          </p>
        </section>

        {/* 右栏：说明 + 成功后的结果提示（与左侧同源 URL，仅强调「已落盘」） */}
        <section className="box-border space-y-2" style={{ boxSizing: "border-box" }}>
          {taskPhase !== "idle" ? (
            <div className="rounded border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] p-4 text-sm text-[var(--color-newsprint-black)] box-border space-y-2">
              <p className="font-semibold">任务状态</p>
              <p>{taskMessage}</p>
              {submittedTaskId ? (
                <p className="text-xs text-[var(--color-muted)] break-all">
                  Task ID: {submittedTaskId}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="text-sm text-[var(--color-muted)]">说明</p>
          <div className="rounded border border-dashed border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] p-4 text-sm text-[var(--color-newsprint-black)] box-border leading-relaxed space-y-2">
            <p>
              重生完成后会<strong>直接覆盖</strong>本镜头首帧文件，并清除尾帧与所有视频候选，状态变为「待处理」。
            </p>
            {frameBust ? (
              <p className="text-[var(--color-primary)] font-semibold">
                最近一次生成已成功落盘；左侧预览已刷新。
              </p>
            ) : (
              <p className="text-[var(--color-muted)]">生成成功后此处会提示落盘状态。</p>
            )}
          </div>
        </section>
      </div>

      <Dialog open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} title="确认重生首帧">
        <p className="mb-4 text-sm text-[var(--color-newsprint-black)]">
          采用新首帧后，该镜头的尾帧和视频将被清除，需要重新生成。确认继续？
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>
            取消
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void runRegen()}>
            {busy ? "提交中…" : "确认重生"}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
