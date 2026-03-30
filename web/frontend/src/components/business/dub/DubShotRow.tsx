/**
 * 单镜 STS 行：折叠展示元信息与本镜音色；展开后懒加载视频/原声/生成声试听。
 */
import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui"
import type { DubStatus, Shot, ShotAsset } from "@/types"
import { getFileUrl } from "@/utils/file"

export interface DubShotRowProps {
  /** 分镜数据 */
  shot: Shot
  /** 当前选中候选上的配音状态 */
  dub: DubStatus | null
  /** 是否存在已选视频候选（可配音） */
  dubEligible: boolean
  /** getFileUrl 用的剧集根路径前缀 */
  basePath: string
  /** 本镜当前选中的 ElevenLabs voiceId（已含覆盖逻辑） */
  effectiveVoiceId: string
  /** 音色下拉选项 */
  voices: Array<{ voiceId: string; name: string }>
  /** 当前镜可选的角色资产列表 */
  speakerAssets: ShotAsset[]
  /** 当前显式指定的说话角色资产 id；空表示自动匹配 */
  speakerAssetId: string
  mode: "sts" | "tts"
  /** 单镜提交中 */
  busy: boolean
  savingVoice?: boolean
  savingSpeaker?: boolean
  expanded: boolean
  onToggleExpand: () => void
  onVoiceChange: (voiceId: string) => void
  onSpeakerAssetChange: (assetId: string) => void
  onDubThisShot: () => void
  /** 由父组件传入用于深链滚动 */
  scrollAnchor?: boolean
}

function linePreview(shot: Shot): string {
  const t =
    (shot.dialogueTranslation && shot.dialogueTranslation.trim()) ||
    (shot.dialogue && shot.dialogue.trim()) ||
    ""
  if (!t) return "—"
  return t.length > 48 ? `${t.slice(0, 48)}…` : t
}

export function DubShotRow({
  shot,
  dub,
  dubEligible,
  basePath,
  effectiveVoiceId,
  voices,
  speakerAssets,
  speakerAssetId,
  mode,
  busy,
  savingVoice = false,
  savingSpeaker = false,
  expanded,
  onToggleExpand,
  onVoiceChange,
  onSpeakerAssetChange,
  onDubThisShot,
  scrollAnchor,
}: DubShotRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null)
  const videoMutedId = useId()
  /** 展开内：视频是否静音（便于只听提取原声或只听画面） */
  const [videoMuted, setVideoMuted] = useState(true)

  useEffect(() => {
    if (scrollAnchor && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "center", behavior: "smooth" })
    }
  }, [scrollAnchor])

  const selected = shot.videoCandidates.find((c) => c.selected)
  const videoUrl =
    selected?.videoPath && basePath
      ? getFileUrl(selected.videoPath, basePath)
      : ""
  const dubbedUrl =
    dub?.audioPath && dub.status === "completed" && basePath
      ? getFileUrl(dub.audioPath, basePath)
      : ""
  const originalUrl =
    dub?.originalAudioPath && basePath
      ? getFileUrl(dub.originalAudioPath, basePath)
      : ""

  const statusLabel = (() => {
    if (!dubEligible) return "无已选视频"
    if (!dub) return "未生成"
    switch (dub.status) {
      case "completed":
        return "完成"
      case "processing":
        return "处理中"
      case "failed":
        return dub.error ? `失败：${dub.error.slice(0, 24)}` : "失败"
      case "stale":
        return "已过期(候选已换)"
      default:
        return dub.status
    }
  })()

  return (
    <>
      <tr
        ref={rowRef}
        className="border-b border-[var(--color-outline-variant)] align-top"
      >
        <td className="py-2 px-2 text-[var(--color-muted)]">{shot.shotNumber}</td>
        <td className="py-2 px-2 font-mono text-[11px] max-w-[7rem] truncate" title={shot.shotId}>
          {shot.shotId.slice(0, 10)}…
        </td>
        <td className="py-2 px-2 text-[11px] text-[var(--color-ink)] max-w-[12rem]">
          {linePreview(shot)}
        </td>
        <td className="py-2 px-2">
          <select
            className="w-full min-w-[8rem] max-w-[12rem] border border-[var(--color-newsprint-black)] px-1 py-1 text-[11px] box-border"
            style={{ boxSizing: "border-box" }}
            value={effectiveVoiceId}
            onChange={(e) => onVoiceChange(e.target.value)}
            disabled={voices.length === 0 || !dubEligible || savingVoice}
          >
            <option value="">跟随集默认 / 未设置</option>
            {voices.map((v) => (
              <option key={v.voiceId} value={v.voiceId}>
                {v.name}
              </option>
            ))}
          </select>
        </td>
        <td className="py-2 px-2 text-[11px]">{statusLabel}</td>
        <td className="py-2 px-2 whitespace-nowrap">
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-[11px] text-[var(--color-primary)] font-bold"
            onClick={() => onToggleExpand()}
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            {expanded ? "收起" : "试听"}
          </button>
        </td>
        <td className="py-2 px-2">
          <Button
            type="button"
            variant="secondary"
            className="text-[11px] px-2 py-1 h-auto"
            disabled={busy || !dubEligible || !effectiveVoiceId}
            onClick={() => void onDubThisShot()}
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "本镜配音"}
          </Button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-[var(--color-divider)] bg-[var(--color-outline-variant)]/20">
          <td colSpan={7} className="p-3 box-border" style={{ boxSizing: "border-box" }}>
            <div className="flex flex-col gap-3 text-[11px]">
              <div className="text-[var(--color-muted)]">
                模式：<strong>{mode === "sts" ? "STS 换声" : "TTS"}</strong>
                {mode === "sts" && !originalUrl && dubEligible ? (
                  <span className="ml-2">（生成后将显示提取原声与成品对比）</span>
                ) : null}
              </div>
              <div className="flex flex-col gap-1 max-w-sm">
                <label
                  htmlFor={`speaker-asset-${shot.shotId}`}
                  className="font-bold text-[var(--color-ink)]"
                >
                  说话角色资产
                </label>
                <select
                  id={`speaker-asset-${shot.shotId}`}
                  aria-label="说话角色资产"
                  className="w-full border border-[var(--color-newsprint-black)] px-2 py-1 text-[11px] box-border"
                  style={{ boxSizing: "border-box" }}
                  value={speakerAssetId}
                  onChange={(e) => onSpeakerAssetChange(e.target.value)}
                  disabled={savingSpeaker}
                >
                  <option value="">自动匹配（按对白角色名）</option>
                  {speakerAssets.map((asset) => (
                    <option key={asset.assetId} value={asset.assetId}>
                      {asset.name} · {asset.assetId.slice(0, 8)}…
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-[var(--color-muted)]">
                  当对白角色名与资产名不一致，或同名角色有多个资产时，请在此显式指定。
                </p>
              </div>
              {videoUrl ? (
                <div className="flex flex-col gap-1 max-w-md">
                  <label className="flex items-center gap-2 cursor-pointer" htmlFor={videoMutedId}>
                    <input
                      id={videoMutedId}
                      type="checkbox"
                      checked={videoMuted}
                      onChange={(e) => setVideoMuted(e.target.checked)}
                    />
                    视频静音（关闭后可听原片音轨；STS 成品请听下方「生成」）
                  </label>
                  <video
                    key={videoUrl}
                    className="w-full max-h-48 rounded border border-[var(--color-divider)] bg-black"
                    src={videoUrl}
                    controls
                    muted={videoMuted}
                    preload="metadata"
                  />
                </div>
              ) : (
                <p className="text-[var(--color-muted)]">无已选视频文件</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {originalUrl ? (
                  <div className="space-y-1">
                    <div className="font-bold text-[var(--color-ink)]">原声（提取）</div>
                    <audio key={originalUrl} src={originalUrl} controls className="w-full" preload="metadata" />
                  </div>
                ) : mode === "sts" && dubEligible ? (
                  <div className="text-[var(--color-muted)]">尚无提取原声（STS 完成后可用）</div>
                ) : null}
                {dubbedUrl ? (
                  <div className="space-y-1">
                    <div className="font-bold text-[var(--color-ink)]">生成配音</div>
                    <audio key={dubbedUrl} src={dubbedUrl} controls className="w-full" preload="metadata" />
                  </div>
                ) : (
                  <div className="text-[var(--color-muted)]">尚无生成音频</div>
                )}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}
