/**
 * videoPickHelpers 纯函数单测（Node 内置 test runner，无 DOM）
 */
import test from "node:test"
import assert from "node:assert/strict"

import { resolveRequestedShotIndex } from "../src/utils/videoPickHelpers.ts"

test("resolveRequestedShotIndex: null / empty id → null", () => {
  assert.equal(resolveRequestedShotIndex([{ shotId: "a" }], null), null)
  assert.equal(resolveRequestedShotIndex([{ shotId: "a" }], ""), null)
})

test("resolveRequestedShotIndex: 找到时返回叙事序索引", () => {
  const shots = [{ shotId: "x" }, { shotId: "y" }, { shotId: "z" }]
  assert.equal(resolveRequestedShotIndex(shots, "y"), 1)
  assert.equal(resolveRequestedShotIndex(shots, "x"), 0)
})

test("resolveRequestedShotIndex: 不存在 → null", () => {
  assert.equal(
    resolveRequestedShotIndex([{ shotId: "a" }], "missing"),
    null
  )
})
