import test from "node:test"
import assert from "node:assert/strict"

import type { GenerateVideoRequest } from "../src/types/api.ts"
import { buildRetryVideoDialogConfig } from "../src/utils/videoBatchRetry.ts"

test("buildRetryVideoDialogConfig: 首帧批量重试锁定 first_frame 并回填模型参数", () => {
  const base: GenerateVideoRequest = {
    episodeId: "ep-1",
    shotIds: ["shot-1", "shot-2"],
    mode: "first_frame",
    model: "viduq3-turbo",
    resolution: "540p",
  }

  assert.deepEqual(buildRetryVideoDialogConfig(base), {
    dialogTitle: "重试失败镜头",
    lockedMode: "first_frame",
    initialValue: {
      mode: "first_frame",
      model: "viduq3-turbo",
      resolution: "540p",
      referenceAssetIds: undefined,
      isPreview: false,
      candidateCount: undefined,
    },
  })
})

test("buildRetryVideoDialogConfig: 首尾帧预览重试保留预览参数但不锁模式", () => {
  const base: GenerateVideoRequest = {
    episodeId: "ep-1",
    shotIds: ["shot-1"],
    mode: "first_last_frame",
    model: "viduq3-turbo",
    resolution: "540p",
    isPreview: true,
    candidateCount: 2,
  }

  assert.deepEqual(buildRetryVideoDialogConfig(base), {
    dialogTitle: "重试失败镜头",
    lockedMode: undefined,
    initialValue: {
      mode: "first_last_frame",
      model: "viduq3-turbo",
      resolution: "540p",
      referenceAssetIds: undefined,
      isPreview: true,
      candidateCount: 2,
    },
  })
})
