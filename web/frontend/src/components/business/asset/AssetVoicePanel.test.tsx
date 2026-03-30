import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AssetVoicePanel } from "./AssetVoicePanel"

describe("AssetVoicePanel", () => {
  it("renders bound voice controls and emits save / preview actions", async () => {
    const user = userEvent.setup()
    const onVoiceChange = vi.fn()
    const onPreviewTextChange = vi.fn()
    const onSave = vi.fn()
    const onPreview = vi.fn()

    render(
      <AssetVoicePanel
        assetName="Alice"
        voices={[
          { voiceId: "voice-a", name: "Voice A" },
          { voiceId: "voice-b", name: "Voice B" },
        ]}
        voiceId="voice-a"
        previewText="我是 Alice。"
        configured={true}
        busy={false}
        previewBusy={false}
        audioSrc="/api/files/proj/ep/dub_previews/alice.mp3"
        onVoiceChange={onVoiceChange}
        onPreviewTextChange={onPreviewTextChange}
        onSave={onSave}
        onPreview={onPreview}
      />
    )

    expect(screen.getByLabelText(/角色音色/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/试听文案/i)).toHaveValue("我是 Alice。")
    expect(screen.getByLabelText(/已生成试听/i)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/角色音色/i), "voice-b")
    expect(onVoiceChange).toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: /保存音色绑定/i }))
    expect(onSave).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: /生成试听/i }))
    expect(onPreview).toHaveBeenCalledTimes(1)
  })
})
