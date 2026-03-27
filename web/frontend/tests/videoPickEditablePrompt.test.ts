import test from "node:test"
import assert from "node:assert/strict"

import {
  consumeIgnoreBlurSave,
  persistPromptDraft,
} from "../src/components/business/videoPickEditablePromptLogic.ts"

test("consumeIgnoreBlurSave: ignore=true skips blur save once and clears flag", () => {
  assert.deepEqual(consumeIgnoreBlurSave(true), {
    ignoreNextBlur: false,
    shouldSave: false,
  })
})

test("consumeIgnoreBlurSave: ignore=false allows blur save", () => {
  assert.deepEqual(consumeIgnoreBlurSave(false), {
    ignoreNextBlur: false,
    shouldSave: true,
  })
})

test("persistPromptDraft: unchanged draft does not call onCommit", async () => {
  let called = false

  const result = await persistPromptDraft({
    draft: " keep same ",
    currentValue: "keep same",
    onCommit: async () => {
      called = true
    },
  })

  assert.equal(result, "unchanged")
  assert.equal(called, false)
})

test("persistPromptDraft: awaits successful save", async () => {
  let savedValue = ""

  const result = await persistPromptDraft({
    draft: " new value ",
    currentValue: "old value",
    onCommit: async (next) => {
      savedValue = next
    },
  })

  assert.equal(result, "saved")
  assert.equal(savedValue, "new value")
})

test("persistPromptDraft: propagates save failure", async () => {
  await assert.rejects(
    persistPromptDraft({
      draft: "new value",
      currentValue: "old value",
      onCommit: async () => {
        throw new Error("save failed")
      },
    }),
    /save failed/
  )
})
