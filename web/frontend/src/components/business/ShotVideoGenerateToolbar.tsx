/**
 * ShotVideoGenerateToolbar — 单镜头「生成视频」工具条（分镜表 / 选片参考区共用）
 *
 * 职责：
 * - 提供与 VideoPickCard / VideoPickFocusPanel **同源** 的两种快捷模式：`first_frame`（仅首帧 i2v）、
 *   `first_last_frame`（首尾帧预览档：540p + turbo + 双候选，与弹窗预览一致）。
 * - 提供「自定义参数」入口，弹出 VideoModeSelector，请求体与分镜批量单镜一致（shotIds 长度为 1）。
 *
 * 约束（与产品 / 后端一致）：
 * - 无首帧路径时不展示可操作按钮，仅说明文案。
 * - 首尾帧模式需本地已有尾帧路径；否则按钮禁用，与后端校验对齐。
 * - 尾帧生成中或视频生成中时不允许再次提交，避免并发任务冲突。
 */
import { useEffect, useMemo, useState } from "react"
import { Film, Loader2 } from "lucide-react"
import type { GenerateVideoRequest } from "@/types"
import type { Shot, VideoMode } from "@/types"
import { useEpisodeStore, useTaskStore, useToastStore } from "@/stores"
import { Button } from "@/components/ui"
import { generateApi } from "@/api/generate"
import {
  VideoModeSelector,
  type VideoModeSelectorResult,
} from "./VideoModeSelector"
import {
  buildSingleShotVideoQuickRequest,
  toastAfterVideoTasksSettled,
} from "@/utils/videoQuickRegenerate"

/** 父组件传入的最小上下文：当前镜头 + 所属剧集 id */
export interface ShotVideoGenerateToolbarProps {
  /** 当前镜头完整数据（含 firstFrame / endFrame / status / videoCandidates） */
  shot: Shot
  /** 剧集 id，用于 generateApi 与任务轮询 */
  episodeId: string
  /** 自定义参数弹窗开关（用于与选片全局键盘快捷键互斥） */
  onVideoDialogOpenChange?: (open: boolean) => void
}

export function ShotVideoGenerateToolbar({
  shot,
  episodeId,
  onVideoDialogOpenChange,
}: ShotVideoGenerateToolbarProps) {
  const currentEpisode = useEpisodeStore((s) => s.currentEpisode)
  const startPolling = useTaskStore((s) => s.startPolling)
  const pushToast = useToastStore((s) => s.push)

  const [submittingVideo, setSubmittingVideo] = useState(false)
  const [videoDialogOpen, setVideoDialogOpen] = useState(false)

  useEffect(() => {
    onVideoDialogOpenChange?.(videoDialogOpen)
  }, [videoDialogOpen, onVideoDialogOpenChange])

  /** 剧集级资产 id：供 VideoModeSelector 的「多参考图」模式勾选（与批量页同源） */
  const episodeAssetIds = useMemo(
    () => (currentEpisode?.assets ?? []).map((a) => a.assetId),
    [currentEpisode?.assets]
  )

  const busyEnd = shot.status === "endframe_generating"
  const busyVid = shot.status === "video_generating"
  const canSubmitVideo =
    Boolean(shot.firstFrame?.trim()) &&
    !busyEnd &&
    !busyVid &&
    !submittingVideo
  const hasFirstFrame = Boolean(shot.firstFrame?.trim())
  /** 首尾帧模式：必须与 VideoPickCard 一致，要求本地已有尾帧文件路径 */
  const hasEndFramePath = Boolean(shot.endFrame?.trim())
  const nCandidates = shot.videoCandidates.length
  const shotLabel = `S${String(shot.shotNumber).padStart(2, "0")}`

  /**
   * 快捷生成：追加视频候选。
   * - first_frame：仅首帧图生视频；
   * - first_last_frame：预览档参数由 buildSingleShotVideoQuickRequest 统一注入。
   */
  const handleQuickRegenerateVideo = async (mode: VideoMode) => {
    if (!canSubmitVideo) return
    setSubmittingVideo(true)
    try {
      const body = buildSingleShotVideoQuickRequest(
        episodeId,
        shot.shotId,
        mode
      )
      const res = await generateApi.video(body)
      const ids = res.data.tasks.map((t) => t.taskId)
      pushToast(
        `已提交 ${ids.length} 个视频任务（${shotLabel}），生成完成后将提示并刷新列表`,
        "info",
        5000
      )
      startPolling(ids, {
        episodeId,
        onPollAborted: () => {
          pushToast(
            `视频任务轮询中断（${shotLabel}），请刷新页面后查看结果`,
            "error",
            8000
          )
        },
        onAllSettled: (results) => {
          toastAfterVideoTasksSettled(results, pushToast, shotLabel)
        },
      })
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "视频生成请求失败", "error")
    } finally {
      setSubmittingVideo(false)
    }
  }

  /**
   * 弹窗确认：与 StoryboardPage / VideoPickCard 单镜请求体一致。
   */
  const handleVideoModeConfirm = async (result: VideoModeSelectorResult) => {
    if (!canSubmitVideo) return
    setSubmittingVideo(true)
    try {
      const body: GenerateVideoRequest = {
        episodeId,
        shotIds: [shot.shotId],
        mode: result.mode,
        model: result.model,
        resolution: result.resolution,
        referenceAssetIds: result.referenceAssetIds,
        ...(result.mode === "first_last_frame" && result.isPreview
          ? {
              isPreview: true,
              candidateCount: result.candidateCount ?? 1,
            }
          : {}),
      }
      const res = await generateApi.video(body)
      const ids = res.data.tasks.map((t) => t.taskId)
      pushToast(`已提交 ${ids.length} 个视频任务（${shotLabel}）`, "info", 5000)
      startPolling(ids, {
        episodeId,
        onPollAborted: () => {
          pushToast(
            `视频任务轮询中断（${shotLabel}），请刷新页面后查看结果`,
            "error",
            8000
          )
        },
        onAllSettled: (results) => {
          toastAfterVideoTasksSettled(results, pushToast, shotLabel)
        },
      })
      setVideoDialogOpen(false)
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "视频生成请求失败", "error")
    } finally {
      setSubmittingVideo(false)
    }
  }

  if (!hasFirstFrame) {
    return (
      <p
        className="text-xs text-[var(--color-muted)] box-border rounded-sm border border-dashed border-[var(--color-border)] p-3"
        style={{ boxSizing: "border-box" }}
      >
        缺少首帧路径，无法在此发起视频生成；请先在分镜板或平台侧补齐首帧。
      </p>
    )
  }

  return (
    <>
      <VideoModeSelector
        open={videoDialogOpen}
        onClose={() => setVideoDialogOpen(false)}
        shotCount={1}
        episodeAssetIds={episodeAssetIds}
        firstLastFrameAllowed={hasEndFramePath}
        onConfirm={(r) => void handleVideoModeConfirm(r)}
      />

      <div
        className="flex flex-col gap-2 rounded-sm border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] p-3 box-border"
        style={{ boxSizing: "border-box" }}
        role="region"
        aria-label="生成视频"
      >
        <span className="text-[10px] font-black uppercase tracking-wide text-[var(--color-muted)]">
          {nCandidates > 0 ? "追加候选 / 再生成" : "生成视频"}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!canSubmitVideo}
            className="text-xs px-3 py-2 gap-1.5 h-auto box-border"
            style={{ boxSizing: "border-box" }}
            onClick={() => void handleQuickRegenerateVideo("first_frame")}
            title="仅首帧图生视频（i2v），不依赖尾帧"
          >
            {submittingVideo ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
            ) : (
              <Film className="w-4 h-4 shrink-0" aria-hidden />
            )}
            仅首帧
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canSubmitVideo || !hasEndFramePath}
            className="text-xs px-3 py-2 gap-1.5 h-auto box-border"
            style={{ boxSizing: "border-box" }}
            onClick={() => void handleQuickRegenerateVideo("first_last_frame")}
            title={
              hasEndFramePath
                ? "首尾帧预览档（540p+turbo+双候选），与选片卡一致"
                : "需要先生成尾帧后再使用首尾帧模式"
            }
          >
            {submittingVideo ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
            ) : (
              <Film className="w-4 h-4 shrink-0" aria-hidden />
            )}
            首尾帧
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canSubmitVideo}
            className="text-xs px-3 py-2 h-auto box-border"
            style={{ boxSizing: "border-box" }}
            onClick={() => setVideoDialogOpen(true)}
          >
            自定义参数
          </Button>
        </div>
        <p className="text-[10px] text-[var(--color-muted)] leading-relaxed box-border m-0">
          {busyEnd || busyVid
            ? "尾帧或视频生成中，请等待当前任务结束后再试。"
            : nCandidates > 0
              ? "在现有候选基础上再提交任务，完成后列表会增加新候选；成片落盘后会自动选中最新一条。"
              : "快捷「首尾帧」为预览档（540p+turbo+双候选）；正式档或多参考请点「自定义参数」。无尾帧时请先在分镜或此处生成尾帧。"}
        </p>
      </div>
    </>
  )
}
