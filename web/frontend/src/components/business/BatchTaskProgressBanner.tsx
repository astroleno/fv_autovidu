/**
 * BatchTaskProgressBanner
 * ------------------------
 * 当 taskStore 中存在未结束的批量任务时，在分镜板顶部展示简要进度提示，
 * 与镜头卡片上的 endframe_generating / 后端状态互补（用户无需仅靠 Toast 猜测是否在跑）。
 *
 * 任务 ID 前缀约定（与后端 generate.py 一致）：
 * - endframe-xxxx → 尾帧生成
 * - video-xxxx → 视频生成
 * - regen-xxxx → 单帧重生（首帧图）
 * - wan27-xxxx → 万相 2.7 组图批量重生首帧
 */
import { useMemo } from "react"
import { Loader2 } from "lucide-react"
import { useTaskStore } from "@/stores/taskStore"

/** 判断任务是否已结束（终态） */
function isTerminal(status: string): boolean {
  return status === "success" || status === "failed"
}

export function BatchTaskProgressBanner() {
  const activeTasks = useTaskStore((s) => s.activeTasks)

  const { endframeCount, videoCount, regenCount, wan27Count, total } =
    useMemo(() => {
      let endframeCount = 0
      let videoCount = 0
      let regenCount = 0
      let wan27Count = 0
      activeTasks.forEach((t) => {
        if (isTerminal(t.status)) return
        if (t.taskId.startsWith("endframe-")) endframeCount += 1
        else if (t.taskId.startsWith("video-")) videoCount += 1
        else if (t.taskId.startsWith("wan27-")) wan27Count += 1
        else if (t.taskId.startsWith("regen-")) regenCount += 1
      })
      return {
        endframeCount,
        videoCount,
        regenCount,
        wan27Count,
        total: endframeCount + videoCount + regenCount + wan27Count,
      }
    }, [activeTasks])

  if (total === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex flex-wrap items-center gap-3 rounded border border-[var(--color-primary)] bg-[var(--color-outline-variant)] px-4 py-3 text-sm font-medium text-[var(--color-newsprint-black)]"
      style={{ boxSizing: "border-box" }}
    >
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-[var(--color-primary)]"
        aria-hidden
      />
      <span>
        后台任务进行中：
        {endframeCount > 0 && (
          <span className="font-semibold"> 尾帧 {endframeCount} 个</span>
        )}
        {endframeCount > 0 &&
          (videoCount > 0 || regenCount > 0 || wan27Count > 0) && (
            <span>；</span>
          )}
        {videoCount > 0 && (
          <span className="font-semibold"> 视频 {videoCount} 个</span>
        )}
        {videoCount > 0 && (regenCount > 0 || wan27Count > 0) && <span>；</span>}
        {wan27Count > 0 && (
          <span className="font-semibold"> 万相组图 {wan27Count} 个</span>
        )}
        {wan27Count > 0 && regenCount > 0 && <span>；</span>}
        {regenCount > 0 && (
          <span className="font-semibold"> 单帧重生 {regenCount} 个</span>
        )}
        。尾帧/视频批量完成后将弹出汇总；镜头状态与缩略图会随进度刷新。
      </span>
    </div>
  )
}
