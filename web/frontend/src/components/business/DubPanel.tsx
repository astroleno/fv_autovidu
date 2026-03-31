/**
 * STS 配音工作台（一期）：集默认音色 + 单镜覆盖（持久化到 episode.json）、按镜列表、
 * 展开试听（视频/原声/生成）、懒加载仅在展开行挂载媒体；批量/单镜调用 dub API。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Mic } from "lucide-react"
import { Button } from "@/components/ui"
import { dubApi } from "@/api/dub"
import { useTaskStore, useToastStore, useEpisodeStore } from "@/stores"
import { useEpisodeFileBasePath } from "@/hooks/useEpisodeFileBasePath"
import type { DubStatus } from "@/types"
import { flattenShots } from "@/types"
import { DubShotRow } from "./dub/DubShotRow"
import { DubEpisodeSummary } from "./dub/DubEpisodeSummary"
import {
  effectiveVoiceIdForShot,
  speakerAssetIdForShot,
  speakerAssetsForShot,
} from "./dub/dubVoiceResolve"

export interface DubPanelProps {
  episodeId: string
  /** 与选片页一致：URL ?shotId= 深链，首次展开并滚到该行 */
  initialHighlightShotId?: string
}

export function DubPanel({ episodeId, initialHighlightShotId }: DubPanelProps) {
  const pushToast = useToastStore((s) => s.push)
  const startPolling = useTaskStore((s) => s.startPolling)
  const fetchEpisodeDetail = useEpisodeStore((s) => s.fetchEpisodeDetail)
  const updateShot = useEpisodeStore((s) => s.updateShot)
  const updateEpisodeLocales = useEpisodeStore((s) => s.updateEpisodeLocales)
  const currentEpisode = useEpisodeStore((s) => s.currentEpisode)
  const basePath = useEpisodeFileBasePath()

  const [elOk, setElOk] = useState<boolean | null>(null)
  const [voices, setVoices] = useState<Array<{ voiceId: string; name: string }>>([])
  const [mode, setMode] = useState<"sts" | "tts">("sts")
  const [batchBusy, setBatchBusy] = useState(false)
  const [busyShotId, setBusyShotId] = useState<string | null>(null)
  const [savingDefaultVoice, setSavingDefaultVoice] = useState(false)
  const [savingVoiceShotId, setSavingVoiceShotId] = useState<string | null>(null)
  const [savingSpeakerShotId, setSavingSpeakerShotId] = useState<string | null>(null)
  const [dubByShot, setDubByShot] = useState<Record<string, DubStatus | null>>({})
  const [expandedShotId, setExpandedShotId] = useState<string | null>(null)
  const [didApplyHighlight, setDidApplyHighlight] = useState(false)

  const shots = useMemo(() => {
    if (!currentEpisode || currentEpisode.episodeId !== episodeId) return []
    return flattenShots(currentEpisode)
  }, [currentEpisode, episodeId])
  const episodeAssets = currentEpisode?.assets ?? []

  const defaultVoiceId =
    currentEpisode?.episodeId === episodeId
      ? (currentEpisode.dubDefaultVoiceId ?? "").trim()
      : ""

  const refreshStatus = useCallback(async () => {
    try {
      const res = await dubApi.status(episodeId)
      const m: Record<string, DubStatus | null> = {}
      for (const r of res.data.shots) {
        m[r.shotId] = (r.dub as DubStatus | null) ?? null
      }
      setDubByShot(m)
    } catch {
      setDubByShot({})
    }
  }, [episodeId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  /** 拉取 ElevenLabs 配置与音色列表 */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await dubApi.configured()
        if (cancelled) return
        setElOk(cfg.data.configured)
        if (!cfg.data.configured) return
        const v = await dubApi.voices()
        if (cancelled) return
        const list = v.data.voices.map((x) => ({
          voiceId: x.voiceId,
          name: x.name,
        }))
        setVoices(list)
      } catch {
        if (!cancelled) setElOk(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [episodeId])

  /** 深链：展开并滚到目标镜（仅一次） */
  useEffect(() => {
    if (!initialHighlightShotId || didApplyHighlight) return
    if (!shots.some((s) => s.shotId === initialHighlightShotId)) return
    setExpandedShotId(initialHighlightShotId)
    setDidApplyHighlight(true)
  }, [initialHighlightShotId, didApplyHighlight, shots])

  const effectiveVoice = useCallback(
    (shotId: string) => {
      const shot = shots.find((item) => item.shotId === shotId)
      if (!shot) return defaultVoiceId
      return effectiveVoiceIdForShot(
        shot,
        currentEpisode ?? null,
        episodeAssets,
        defaultVoiceId,
      )
    },
    [currentEpisode, defaultVoiceId, episodeAssets, shots],
  )

  const setOverrideForShot = useCallback(
    async (shotId: string, voiceId: string) => {
      const shot = shots.find((item) => item.shotId === shotId)
      const normalized = voiceId.trim()
      const inherited = shot
        ? (() => {
            const assetId = speakerAssetIdForShot(shot, episodeAssets)
            const bound =
              assetId && currentEpisode?.characterVoices
                ? (currentEpisode.characterVoices[assetId]?.voiceId ?? "").trim()
                : ""
            return bound || defaultVoiceId
          })()
        : defaultVoiceId
      const nextOverride = normalized && normalized !== inherited ? normalized : ""
      setSavingVoiceShotId(shotId)
      try {
        await updateShot(episodeId, shotId, {
          dubVoiceIdOverride: nextOverride,
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        pushToast(`保存本镜音色失败：${msg}`, "error")
      } finally {
        setSavingVoiceShotId(null)
      }
    },
    [currentEpisode?.characterVoices, defaultVoiceId, episodeAssets, episodeId, pushToast, shots, updateShot]
  )

  const setSpeakerAssetForShot = useCallback(
    async (shotId: string, assetId: string) => {
      setSavingSpeakerShotId(shotId)
      try {
        await updateShot(episodeId, shotId, {
          dubSpeakerAssetId: assetId.trim(),
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        pushToast(`保存说话角色失败：${msg}`, "error")
      } finally {
        setSavingSpeakerShotId(null)
      }
    },
    [episodeId, pushToast, updateShot]
  )

  const handleDefaultVoiceChange = useCallback(
    async (vid: string) => {
      setSavingDefaultVoice(true)
      try {
        await updateEpisodeLocales(episodeId, { dubDefaultVoiceId: vid.trim() })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        pushToast(`保存集默认音色失败：${msg}`, "error")
      } finally {
        setSavingDefaultVoice(false)
      }
    },
    [episodeId, pushToast, updateEpisodeLocales]
  )

  const pollTaskIds = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      startPolling(ids, {
        episodeId,
        onAnyTerminal: () => void refreshStatus(),
        onAllSettled: () => {
          void fetchEpisodeDetail(episodeId)
          void refreshStatus()
          pushToast("配音任务已结束", "info")
        },
      })
    },
    [episodeId, fetchEpisodeDetail, pushToast, refreshStatus, startPolling]
  )

  const handleBatch = async () => {
    setBatchBusy(true)
    try {
      const unresolved: string[] = []
      for (const s of shots) {
        const sel = s.videoCandidates.find((c) => c.selected)
        if (!sel?.videoPath) continue
        const eff = effectiveVoice(s.shotId)
        if (!eff) unresolved.push(s.shotId)
      }
      if (unresolved.length > 0) {
        pushToast(
          `以下镜头未设置音色：${unresolved.slice(0, 3).join(", ")}${unresolved.length > 3 ? "…" : ""}`,
          "error"
        )
        return
      }
      const res = await dubApi.process({
        episodeId,
        mode,
        concurrency: 2,
      })
      const ids = res.data.tasks.map((t) => t.taskId)
      if (ids.length === 0) {
        pushToast("未创建配音任务", "info")
        return
      }
      pushToast(`已提交 ${ids.length} 个配音任务`, "success")
      pollTaskIds(ids)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast(`配音提交失败：${msg}`, "error")
    } finally {
      setBatchBusy(false)
    }
  }

  const handleDubOneShot = async (shotId: string) => {
    if (!effectiveVoice(shotId)) {
      pushToast("请选择音色", "error")
      return
    }
    setBusyShotId(shotId)
    try {
      const res = await dubApi.processShot({
        episodeId,
        shotId,
        mode,
      })
      pushToast("已提交本镜配音", "success")
      pollTaskIds([res.data.taskId])
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast(`本镜配音失败：${msg}`, "error")
    } finally {
      setBusyShotId(null)
    }
  }

  if (elOk === false) {
    return (
      <div
        className="rounded border border-dashed border-[var(--color-newsprint-black)] p-4 text-sm text-[var(--color-muted)] space-y-2"
        style={{ boxSizing: "border-box" }}
      >
        <div className="flex items-center gap-2 font-bold text-[var(--color-ink)]">
          <Mic className="w-4 h-4" />
          配音（ElevenLabs）— 可选功能
        </div>
        <p className="leading-relaxed">
          当前<strong>未配置</strong>
          <code className="mx-1 px-1 bg-[var(--color-outline-variant)] text-[var(--color-ink)] text-xs">
            ELEVENLABS_API_KEY
          </code>
          ，因此<strong>无法使用本面板内的 STS/TTS 配音</strong>（需调用 ElevenLabs 云端，没有密钥服务端不能代你请求）。
        </p>
        <p className="leading-relaxed text-[var(--color-ink)]">
          <strong>其它流程不受影响：</strong>
          分镜拉取、尾帧/视频生成（Vidu）、任务轮询、剪映导出等均可照常使用；它们不依赖 ElevenLabs。
        </p>
        <p className="text-xs">
          若需要配音：在项目根 <code className="font-mono">.env</code> 中配置 Key 后重启后端；设置页可测试连通性。
        </p>
      </div>
    )
  }

  return (
    <div
      className="rounded border border-[var(--color-newsprint-black)] p-4 bg-[var(--color-newsprint-off-white)]"
      style={{ boxSizing: "border-box" }}
    >
      <div className="flex items-center gap-2 font-bold text-[var(--color-ink)] mb-3">
        <Mic className="w-4 h-4" />
        STS 配音工作台
      </div>
      {currentEpisode && currentEpisode.episodeId === episodeId ? (
        <DubEpisodeSummary
          episode={currentEpisode}
          shots={shots}
          voices={voices}
          dubByShot={dubByShot}
        />
      ) : null}
      <div className="flex flex-wrap gap-3 items-end mb-3">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider mb-1">
            集默认音色
          </label>
          <select
            className="min-w-[12rem] border border-[var(--color-newsprint-black)] px-2 py-1.5 text-sm"
            style={{ boxSizing: "border-box" }}
            value={defaultVoiceId}
            onChange={(e) => void handleDefaultVoiceChange(e.target.value)}
            disabled={elOk !== true || voices.length === 0 || savingDefaultVoice}
          >
            <option value="">请选择集默认音色</option>
            {voices.map((v) => (
              <option key={v.voiceId} value={v.voiceId}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-3 items-center">
          <label className="flex items-center gap-1 text-sm cursor-pointer">
            <input
              type="radio"
              name="dub-mode"
              checked={mode === "sts"}
              onChange={() => setMode("sts")}
            />
            STS 换声
          </label>
          <label className="flex items-center gap-1 text-sm cursor-pointer">
            <input
              type="radio"
              name="dub-mode"
              checked={mode === "tts"}
              onChange={() => setMode("tts")}
            />
            TTS 文本
          </label>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="gap-2"
          disabled={batchBusy}
          onClick={() => void handleBatch()}
        >
          {batchBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          批量配音（已选视频镜）
        </Button>
      </div>
      <p className="text-xs text-[var(--color-muted)] mb-2">
        仅对当前<strong>已选定</strong>视频候选配音；切换候选后需重新生成。单镜可选与集默认不同的音色（本机记忆）。
      </p>
      <div className="max-h-[min(70vh,32rem)] overflow-y-auto border border-[var(--color-divider)] text-xs">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-divider)] bg-[var(--color-outline-variant)]/30">
              <th className="py-2 px-2 w-8">#</th>
              <th className="py-2 px-2">镜头</th>
              <th className="py-2 px-2">台词摘要</th>
              <th className="py-2 px-2 min-w-[9rem]">本镜音色</th>
              <th className="py-2 px-2">状态</th>
              <th className="py-2 px-2 w-16">试听</th>
              <th className="py-2 px-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {shots.slice(0, 200).map((shot) => {
              const selected = shot.videoCandidates.find((c) => c.selected)
              const dubEligible = Boolean(selected?.videoPath)
              const dub = dubByShot[shot.shotId] ?? shot.dub ?? null
              const eff = effectiveVoice(shot.shotId)
              const expanded = expandedShotId === shot.shotId
              const speakerAssets = speakerAssetsForShot(shot, episodeAssets)
              return (
                <DubShotRow
                  key={shot.shotId}
                  shot={shot}
                  dub={dub}
                  dubEligible={dubEligible}
                  basePath={basePath}
                  effectiveVoiceId={eff}
                  voices={voices}
                  speakerAssets={speakerAssets}
                  speakerAssetId={(shot.dubSpeakerAssetId ?? "").trim()}
                  mode={mode}
                  busy={busyShotId === shot.shotId}
                  savingVoice={savingVoiceShotId === shot.shotId}
                  savingSpeaker={savingSpeakerShotId === shot.shotId}
                  expanded={expanded}
                  onToggleExpand={() =>
                    setExpandedShotId((prev) =>
                      prev === shot.shotId ? null : shot.shotId
                    )
                  }
                  onVoiceChange={(v) => void setOverrideForShot(shot.shotId, v)}
                  onSpeakerAssetChange={(assetId) =>
                    void setSpeakerAssetForShot(shot.shotId, assetId)
                  }
                  onDubThisShot={() => void handleDubOneShot(shot.shotId)}
                  scrollAnchor={
                    Boolean(
                      initialHighlightShotId &&
                        didApplyHighlight &&
                        shot.shotId === initialHighlightShotId
                    )
                  }
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
