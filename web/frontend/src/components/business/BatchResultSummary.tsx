/**
 * 批量任务结果汇总弹窗
 *
 * 在批量尾帧 / 批量视频轮询全部结束后展示成功数、失败数与失败镜头明细，
 * 可选「重试失败镜头」（由父组件传入回调，再次调用 generate API）。
 */
import { Dialog } from "@/components/ui/Dialog"
import { Button } from "@/components/ui"
import type { TaskStatusResponse } from "@/types"

export interface BatchResultSummaryProps {
  open: boolean
  onClose: () => void
  /** 用于标题区分：尾帧批量 / 视频批量 */
  kind: "endframe" | "video"
  /** taskId -> shotId，来自 BatchEndframeResponse / GenerateVideoResponse */
  taskToShotId: Record<string, string>
  /** 最后一次轮询得到的任务状态列表 */
  results: TaskStatusResponse[]
  /** 点击「重试失败镜头」时传出失败 shotId 列表 */
  onRetryFailed?: (failedShotIds: string[]) => void
}

/**
 * 根据轮询结果统计成功/失败并附带 shotId（便于展示）
 */
function buildRows(
  taskToShotId: Record<string, string>,
  results: TaskStatusResponse[]
) {
  const rows: {
    taskId: string
    shotId: string
    ok: boolean
    error?: string
  }[] = []
  for (const t of results) {
    const shotId = taskToShotId[t.taskId] ?? t.taskId
    const ok = t.status === "success"
    rows.push({
      taskId: t.taskId,
      shotId,
      ok,
      error: t.error ?? (ok ? undefined : "任务失败"),
    })
  }
  const successCount = rows.filter((r) => r.ok).length
  const failCount = rows.length - successCount
  return { rows, successCount, failCount }
}

export function BatchResultSummary({
  open,
  onClose,
  kind,
  taskToShotId,
  results,
  onRetryFailed,
}: BatchResultSummaryProps) {
  const { rows, successCount, failCount } = buildRows(taskToShotId, results)
  const failedShotIds = rows.filter((r) => !r.ok).map((r) => r.shotId)
  const title =
    kind === "endframe" ? "批量尾帧结果" : "批量视频结果"

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div
        className="space-y-4 text-sm text-[var(--color-newsprint-black)] box-border"
        style={{ boxSizing: "border-box" }}
      >
        <p className="font-bold">
          成功 <span className="text-green-700">{successCount}</span> / 失败{" "}
          <span className="text-red-700">{failCount}</span>（共 {rows.length} 项）
        </p>
        {failCount > 0 && (
          <div className="border border-[var(--color-newsprint-black)] max-h-48 overflow-auto p-3 box-border bg-[var(--color-outline-variant)]/30">
            <p className="text-xs font-black uppercase tracking-wider mb-2">
              失败镜头
            </p>
            <ul className="space-y-1 text-xs font-mono">
              {rows
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.taskId}>
                    shotId={r.shotId} — {r.error ?? "未知错误"}
                  </li>
                ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-end pt-2">
          {failCount > 0 && onRetryFailed && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onRetryFailed(failedShotIds)
                onClose()
              }}
            >
              重试失败镜头
            </Button>
          )}
          <Button type="button" variant="primary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
