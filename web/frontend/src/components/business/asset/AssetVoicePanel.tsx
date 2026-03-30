import { Loader2, Volume2 } from "lucide-react"
import { Button } from "@/components/ui"

export interface AssetVoicePanelProps {
  assetName: string
  voices: Array<{ voiceId: string; name: string }>
  voiceId: string
  previewText: string
  configured: boolean
  busy: boolean
  previewBusy: boolean
  audioSrc?: string
  onVoiceChange: (voiceId: string) => void
  onPreviewTextChange: (text: string) => void
  onSave: () => void
  onPreview: () => void
}

export function AssetVoicePanel({
  assetName,
  voices,
  voiceId,
  previewText,
  configured,
  busy,
  previewBusy,
  audioSrc,
  onVoiceChange,
  onPreviewTextChange,
  onSave,
  onPreview,
}: AssetVoicePanelProps) {
  if (!configured) {
    return (
      <div className="rounded border border-dashed border-[var(--color-newsprint-black)] p-3 text-sm text-[var(--color-muted)]">
        未配置 ElevenLabs，暂时无法为角色绑定音色或生成试听。
      </div>
    )
  }

  return (
    <section className="space-y-3">
      <div>
        <label
          htmlFor="asset-voice-select"
          className="mb-1 block text-xs font-black uppercase tracking-wider text-[var(--color-muted)]"
        >
          角色音色
        </label>
        <select
          id="asset-voice-select"
          aria-label="角色音色"
          className="w-full border border-[var(--color-newsprint-black)] bg-white px-3 py-2 text-sm"
          value={voiceId}
          onChange={(e) => onVoiceChange(e.target.value)}
          disabled={busy || previewBusy}
        >
          <option value="">请选择角色音色</option>
          {voices.map((voice) => (
            <option key={voice.voiceId} value={voice.voiceId}>
              {voice.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="asset-voice-preview-text"
          className="mb-1 block text-xs font-black uppercase tracking-wider text-[var(--color-muted)]"
        >
          试听文案
        </label>
        <textarea
          id="asset-voice-preview-text"
          aria-label="试听文案"
          className="min-h-24 w-full border border-[var(--color-newsprint-black)] bg-white px-3 py-2 text-sm leading-relaxed"
          value={previewText}
          onChange={(e) => onPreviewTextChange(e.target.value)}
          disabled={busy || previewBusy}
          placeholder={`我是${assetName}，这是我的音色试听。`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={!voiceId || busy || previewBusy} onClick={onSave}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          保存音色绑定
        </Button>
        <Button type="button" variant="primary" disabled={!voiceId || previewBusy} onClick={onPreview}>
          {previewBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
          生成试听
        </Button>
      </div>

      {audioSrc ? (
        <div className="space-y-1">
          <p className="text-xs font-black uppercase tracking-wider text-[var(--color-muted)]">
            已生成试听
          </p>
          <audio aria-label="已生成试听" controls className="w-full" src={audioSrc} />
        </div>
      ) : null}
    </section>
  )
}
