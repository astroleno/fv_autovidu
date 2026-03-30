import type { GenerateVideoRequest } from "@/types"

export interface RetryVideoDialogInitialValue {
  mode: GenerateVideoRequest["mode"]
  model?: string
  resolution?: string
  referenceAssetIds?: string[]
  isPreview?: boolean
  candidateCount?: number
}

export interface RetryVideoDialogConfig {
  dialogTitle: string
  lockedMode?: "first_frame"
  initialValue: RetryVideoDialogInitialValue
}

export function buildRetryVideoDialogConfig(
  base: GenerateVideoRequest
): RetryVideoDialogConfig {
  return {
    dialogTitle: "重试失败镜头",
    lockedMode: base.mode === "first_frame" ? "first_frame" : undefined,
    initialValue: {
      mode: base.mode,
      model: base.model,
      resolution: base.resolution,
      referenceAssetIds: base.referenceAssetIds,
      isPreview: Boolean(base.isPreview),
      candidateCount: base.isPreview ? base.candidateCount : undefined,
    },
  }
}
