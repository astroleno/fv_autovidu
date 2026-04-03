/**
 * 分镜板「批量操作」统一前置确认弹窗
 *
 * 与 `VideoModeSelector`（先选参数再点「开始生成」）并列：尾帧批量无模型/分辨率等额外项，
 * 但仍需二次确认镜头数量与操作说明，避免误触大量任务。
 *
 * 使用场景：`StoryboardPage` 批量生成尾帧、万相组图重生；其它无参批量可继续扩展 `kind`。
 *
 * 提交流程：用户点「确认并提交」后由父组件关闭本弹窗再调 API，加载态留在工具栏按钮（与视频批量一致）。
 */
import { Dialog, Button } from "@/components/ui"

/** 当前支持的批量操作类型（用于标题与说明文案） */
export type BatchOperationConfirmKind = "endframe" | "wan27_batch"

export interface BatchOperationConfirmDialogProps {
  /** 是否显示弹窗 */
  open: boolean
  /** 关闭弹窗（取消、遮罩、Esc） */
  onClose: () => void
  /** 操作类型，决定标题与正文 */
  kind: BatchOperationConfirmKind
  /**
   * 将参与本次批处理的镜头数；应与工具栏按钮括号内数字、当前筛选/框选范围一致，
   * 便于用户核对「即将消耗多少任务额度」的心理预期。
   */
  shotCount: number
  /** 用户点击「确认并提交」后调用；由父组件先关弹窗再发起 API */
  onConfirm: () => void
}

/** 按 kind 取弹窗标题（中文、与分镜用语一致） */
function titleForKind(kind: BatchOperationConfirmKind): string {
  switch (kind) {
    case "endframe":
      return "确认批量生成尾帧"
    case "wan27_batch":
      return "确认万相组图重生首帧"
    default:
      return "确认批量操作"
  }
}

/** 按 kind 取说明段落（可含 shotCount） */
function descriptionForKind(
  kind: BatchOperationConfirmKind,
  shotCount: number
): string {
  switch (kind) {
    case "endframe":
      return `即将为 ${shotCount} 个镜头提交尾帧生成任务。提交后将进入任务轮询，完成后会弹出结果汇总。`
    case "wan27_batch":
      return `即将通过阿里云万相 2.7 组图接口，按叙事顺序一次性重生 ${shotCount} 个镜头的首帧（覆盖原 PNG）。需已配置 DASHSCOPE_API_KEY；提交后轮询任务，完成后刷新缩略图。`
    default:
      return `即将处理 ${shotCount} 个镜头，请确认后继续。`
  }
}

export function BatchOperationConfirmDialog({
  open,
  onClose,
  kind,
  shotCount,
  onConfirm,
}: BatchOperationConfirmDialogProps) {
  const title = titleForKind(kind)
  const description = descriptionForKind(kind, shotCount)

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div
        className="space-y-4 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <p className="text-sm text-[var(--color-newsprint-black)] leading-relaxed">
          {description}
        </p>
        <p className="text-xs text-[var(--color-muted)] border border-dashed border-[var(--color-newsprint-black)] p-3 box-border">
          与「批量视频」一致：先在本弹窗确认，再向后端提交任务；取消则不产生请求。
        </p>
        <div
          className="flex justify-end gap-2 pt-2 box-border"
          style={{ boxSizing: "border-box" }}
        >
          <Button
            variant="secondary"
            type="button"
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={shotCount === 0}
            onClick={() => onConfirm()}
          >
            确认并提交
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
