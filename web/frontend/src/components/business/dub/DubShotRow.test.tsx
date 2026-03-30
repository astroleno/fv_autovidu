/**
 * DubShotRow：折叠态展示与「试听」按钮交互（不挂载真实视频请求）
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DubShotRow } from "./DubShotRow"
import type { Shot } from "@/types"

function buildShot(overrides: Partial<Shot> = {}): Shot {
  return {
    shotId: "shot-xyz",
    shotNumber: 3,
    imagePrompt: "img",
    videoPrompt: "vp",
    duration: 5,
    cameraMovement: "push_in",
    aspectRatio: "9:16",
    firstFrame: "frames/S01.png",
    assets: [],
    status: "selected",
    endFrame: null,
    videoCandidates: [
      {
        id: "c1",
        videoPath: "videos/v.mp4",
        thumbnailPath: "",
        seed: 0,
        model: "m",
        mode: "first_frame",
        selected: true,
        createdAt: "",
        taskId: "t",
        taskStatus: "success",
      },
    ],
    ...overrides,
  }
}

describe("DubShotRow", () => {
  afterEach(() => {
    cleanup()
  })

  const baseProps = {
    dub: null,
    dubEligible: true,
    basePath: "proj/ep",
    effectiveVoiceId: "voice-1",
    voices: [{ voiceId: "voice-1", name: "Voice One" }],
    mode: "sts" as const,
    busy: false,
    onVoiceChange: () => {},
    onDubThisShot: () => {},
  }

  it("折叠态展示台词摘要", () => {
    render(
      <table>
        <tbody>
          <DubShotRow
            {...baseProps}
            shot={buildShot({ dialogue: "对白内容用于摘要" })}
            expanded={false}
            onToggleExpand={() => {}}
          />
        </tbody>
      </table>
    )
    expect(screen.getByText(/对白内容/)).toBeInTheDocument()
  })

  it("点击「试听」调用 onToggleExpand", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <table>
        <tbody>
          <DubShotRow
            {...baseProps}
            shot={buildShot()}
            expanded={false}
            onToggleExpand={onToggle}
          />
        </tbody>
      </table>
    )
    await user.click(screen.getByRole("button", { name: /试听/ }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
