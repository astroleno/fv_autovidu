import { describe, it, expect } from "vitest"
import type { Episode, Shot, ShotAsset } from "@/types"
import { effectiveVoiceIdForShot, speakerAssetIdForShot } from "./dubVoiceResolve"

const epAssets: ShotAsset[] = [
  {
    assetId: "a-hero",
    name: "艾伦",
    type: "character",
    localPath: "x.png",
    prompt: "",
  },
]

const baseEpisode: Episode = {
  projectId: "p",
  episodeId: "e",
  episodeTitle: "T",
  episodeNumber: 1,
  pulledAt: "",
  scenes: [],
  dubDefaultVoiceId: "voice-default",
  characterVoices: {
    "a-hero": { voiceId: "voice-hero" },
  },
}

function shot(partial: Partial<Shot> & Pick<Shot, "shotId" | "shotNumber">): Shot {
  return {
    imagePrompt: "",
    videoPrompt: "",
    duration: 5,
    cameraMovement: "",
    aspectRatio: "9:16",
    firstFrame: "",
    assets: [],
    status: "selected",
    endFrame: null,
    videoCandidates: [],
    ...partial,
  }
}

describe("effectiveVoiceIdForShot", () => {
  it("镜头覆盖优先于角色与集默认", () => {
    const s = shot({
      shotId: "s1",
      shotNumber: 1,
      dubVoiceIdOverride: "voice-override",
      associatedDialogue: { role: "艾伦", content: "hi" },
    })
    expect(effectiveVoiceIdForShot(s, baseEpisode, epAssets, "voice-default")).toBe(
      "voice-override",
    )
  })

  it("无覆盖时按角色资产绑定音色", () => {
    const s = shot({
      shotId: "s1",
      shotNumber: 1,
      associatedDialogue: { role: "艾伦", content: "hi" },
    })
    expect(effectiveVoiceIdForShot(s, baseEpisode, epAssets, "voice-default")).toBe(
      "voice-hero",
    )
  })

  it("无角色匹配时回落集默认", () => {
    const s = shot({
      shotId: "s1",
      shotNumber: 1,
      dialogue: "alone",
    })
    expect(effectiveVoiceIdForShot(s, baseEpisode, epAssets, "voice-default")).toBe(
      "voice-default",
    )
  })
})

describe("speakerAssetIdForShot", () => {
  it("显式 dubSpeakerAssetId 优先", () => {
    const s = shot({
      shotId: "s1",
      shotNumber: 1,
      dubSpeakerAssetId: "manual-id",
      associatedDialogue: { role: "艾伦", content: "x" },
    })
    expect(speakerAssetIdForShot(s, epAssets)).toBe("manual-id")
  })
})
