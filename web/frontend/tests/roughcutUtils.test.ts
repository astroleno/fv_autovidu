import test from "node:test"
import assert from "node:assert/strict"

import type { RoughCutTrackItem } from "../src/components/roughcut/RoughCutTimeline.tsx"
import {
  getTimelineSeekTarget,
  timelinePercentFromClientX,
} from "../src/components/roughcut/roughcutUtils.ts"

const items = [
  {
    kind: "clip",
    shot: { shotId: "shot-1", shotNumber: 1 },
    candidate: {},
    durationSec: 6,
  },
  {
    kind: "clip",
    shot: { shotId: "shot-2", shotNumber: 2 },
    candidate: {},
    durationSec: 5,
  },
  {
    kind: "pending",
    shot: { shotId: "shot-3", shotNumber: 3 },
    durationSec: 4,
  },
] as RoughCutTrackItem[]

test("timelinePercentFromClientX clamps within the interactive lane", () => {
  const rect = { left: 200, width: 1000 } as DOMRect

  assert.equal(timelinePercentFromClientX(150, rect), 0)
  assert.equal(timelinePercentFromClientX(700, rect), 50)
  assert.equal(timelinePercentFromClientX(1300, rect), 100)
})

test("getTimelineSeekTarget maps global time to the matching playable clip", () => {
  assert.deepEqual(getTimelineSeekTarget(items, 0), {
    shotId: "shot-1",
    clipTimeSec: 0,
    globalTimeSec: 0,
  })

  assert.deepEqual(getTimelineSeekTarget(items, 7.5), {
    shotId: "shot-2",
    clipTimeSec: 1.5,
    globalTimeSec: 7.5,
  })
})

test("getTimelineSeekTarget skips pending items when landing on a non-playable span", () => {
  assert.deepEqual(getTimelineSeekTarget(items, 13.5), {
    shotId: "shot-2",
    clipTimeSec: 5,
    globalTimeSec: 13.5,
  })
})
