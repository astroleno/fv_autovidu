import test from "node:test"
import assert from "node:assert/strict"

import {
  FIRST_LAST_QUICK_PREVIEW,
  getSingleVideoQuickSummaryLines,
} from "../src/utils/videoQuickRegenerate.ts"

test("getSingleVideoQuickSummaryLines: 有尾帧时展示两路快捷参数", () => {
  assert.deepEqual(getSingleVideoQuickSummaryLines(true), [
    "仅首帧快捷: viduq3-turbo / 540p",
    `首尾帧快捷: ${FIRST_LAST_QUICK_PREVIEW.model} / ${FIRST_LAST_QUICK_PREVIEW.resolution} / ${String(FIRST_LAST_QUICK_PREVIEW.candidateCount)} 候选`,
    "更多模型、分辨率、多参考图请点“自定义参数”。",
  ])
})

test("getSingleVideoQuickSummaryLines: 无尾帧时说明首尾帧快捷不可用", () => {
  assert.deepEqual(getSingleVideoQuickSummaryLines(false), [
    "仅首帧快捷: viduq3-turbo / 540p",
    "首尾帧快捷: 需先生成尾帧后可用",
    "更多模型、分辨率、多参考图请点“自定义参数”。",
  ])
})
