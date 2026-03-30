/**
 * 单镜头「快捷出视频 / 再生成（追加候选）」请求体构造与任务完成 Toast 汇总
 *
 * 术语：此处「再生成」指质量不满意时追加新候选；**不是** `BatchResultSummary` 里失败任务的「重试失败镜头」。
 * 详见 `docs/superpowers/specs/2025-03-26-video-generation-modes-retry-design.md` §5。
 *
 * 背景：
 * - 后端 `POST /generate/video` 在 **未** 传 `isPreview` 时，首尾帧模式会走正式档默认（1080p + viduq3-pro），
 *   与产品「预览试错 = 540p + turbo」不一致。
 * - `VideoModeSelector` 勾选「预览模式」时显式传 `isPreview + candidateCount + 540p + viduq3-turbo`；
 *   选片卡 / 分镜卡上的**一键按钮**应与该策略对齐，避免用户误以为在跑低成本预览。
 *
 * 注意：`first_frame`（仅首帧 i2v）未显式传 model/resolution 时，后端默认 viduq3-turbo + 540p
 * （与弹窗/批量首帧推荐档一致）；若需其它档位请用「自定义参数」显式选择。
 */
import type {
  GenerateVideoRequest,
  TaskStatusResponse,
  VideoMode,
} from "@/types"
import type { ToastType } from "@/components/ui/Toast"

/** 单镜头首帧快捷档：与后端默认、参数弹窗推荐档保持一致。 */
export const FIRST_FRAME_QUICK_DEFAULT = {
  model: "viduq3-turbo",
  resolution: "540p",
} as const

/** 与 VideoModeSelector 勾选「预览模式」时一致：turbo + 540p，默认每镜头 2 条候选任务 */
export const FIRST_LAST_QUICK_PREVIEW = {
  model: "viduq3-turbo",
  resolution: "540p",
  /** 与弹窗预览默认 candidateCount 对齐；仅 isPreview=true 时后端允许多于 1 */
  candidateCount: 2,
} as const

/** 单镜头工具条上展示的快捷参数摘要，避免默认档位成为“盲提”。 */
export function getSingleVideoQuickSummaryLines(
  hasEndFramePath: boolean
): string[] {
  return [
    `仅首帧快捷: ${FIRST_FRAME_QUICK_DEFAULT.model} / ${FIRST_FRAME_QUICK_DEFAULT.resolution}`,
    hasEndFramePath
      ? `首尾帧快捷: ${FIRST_LAST_QUICK_PREVIEW.model} / ${FIRST_LAST_QUICK_PREVIEW.resolution} / ${String(FIRST_LAST_QUICK_PREVIEW.candidateCount)} 候选`
      : "首尾帧快捷: 需先生成尾帧后可用",
    "更多模型、分辨率、多参考图请点“自定义参数”。",
  ]
}

/**
 * 构造单镜头快捷视频请求体。
 * - `first_last_frame`：走预览档（与弹窗「预览模式」一致），会生成多条 taskId，需轮询全部结束后再 Toast。
 * - 其它 mode：保持「由后端推断默认 model/resolution」的旧行为。
 */
export function buildSingleShotVideoQuickRequest(
  episodeId: string,
  shotId: string,
  mode: VideoMode
): GenerateVideoRequest {
  if (mode === "first_last_frame") {
    return {
      episodeId,
      shotIds: [shotId],
      mode: "first_last_frame",
      model: FIRST_LAST_QUICK_PREVIEW.model,
      resolution: FIRST_LAST_QUICK_PREVIEW.resolution,
      isPreview: true,
      candidateCount: FIRST_LAST_QUICK_PREVIEW.candidateCount,
    }
  }
  return {
    episodeId,
    shotIds: [shotId],
    mode,
    model: undefined,
    resolution: undefined,
  }
}

type PushToast = (message: string, type?: ToastType, durationMs?: number) => void

/**
 * 视频批量任务**全部**返回终态后：根据每条 TaskStatusResponse 弹出汇总 Toast。
 * - 解决「仅看 results[0]」在预览多 task 时漏判失败的问题。
 * - 成功提示默认 7s，避免用户错过右上角短时 Toast。
 */
export function toastAfterVideoTasksSettled(
  results: TaskStatusResponse[],
  push: PushToast,
  shotLabel: string
): void {
  if (results.length === 0) {
    push(
      "视频任务状态异常：未返回任务结果，请刷新页面或到镜头详情查看",
      "error",
      8000
    )
    return
  }
  const failed = results.filter((r) => r.status === "failed")
  if (failed.length > 0) {
    const msg = failed
      .map((r) => r.error?.trim())
      .filter(Boolean)
      .join("；")
    push(
      msg ? msg.slice(0, 600) : "部分或全部视频生成失败",
      "error",
      8000
    )
    return
  }
  const allSuccess = results.every((r) => r.status === "success")
  if (allSuccess) {
    push(`视频任务已全部完成（${shotLabel}）`, "success", 7000)
    return
  }
  push(
    `视频任务已结束（${shotLabel}），状态异常，请在本页或镜头详情确认`,
    "info",
    8000
  )
}
