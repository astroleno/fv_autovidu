/**
 * 配音管理面板：音色选择、STS/TTS、批量配音、轮询任务、状态摘要
 */
import { useCallback, useEffect, useState } from "react"
import { Loader2, Mic } from "lucide-react"
import { Button } from "@/components/ui"
import { dubApi } from "@/api/dub"
import { useTaskStore, useToastStore, useEpisodeStore } from "@/stores"
import type { DubStatus } from "@/types"

export interface DubPanelProps {
  episodeId: string
}

export function DubPanel({ episodeId }: DubPanelProps) {
  const pushToast = useToastStore((s) => s.push)
  const startPolling = useTaskStore((s) => s.startPolling)
  const fetchEpisodeDetail = useEpisodeStore((s) => s.fetchEpisodeDetail)

  const [elOk, setElOk] = useState<boolean | null>(null)
  const [voices, setVoices] = useState<Array<{ voiceId: string; name: string }>>([])
  const [voiceId, setVoiceId] = useState("")
  const [mode, setMode] = useState<"sts" | "tts">("sts")
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<
    Array<{ shotId: string; dub: DubStatus | null }>
  >([])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await dubApi.status(episodeId)
      setRows(
        res.data.shots.map((r) => ({
          shotId: r.shotId,
          dub: (r.dub as DubStatus | null) ?? null,
        }))
      )
    } catch {
      setRows([])
    }
  }, [episodeId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

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
        setVoices(v.data.voices.map((x) => ({ voiceId: x.voiceId, name: x.name })))
        if (v.data.voices.length > 0) {
          setVoiceId(v.data.voices[0].voiceId)
        }
      } catch {
        if (!cancelled) setElOk(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleBatch = async () => {
    if (!voiceId) {
      pushToast("请选择音色", "error")
      return
    }
    setBusy(true)
    try {
      const res = await dubApi.process({
        episodeId,
        voiceId,
        mode,
        concurrency: 2,
      })
      const ids = res.data.tasks.map((t) => t.taskId)
      if (ids.length === 0) {
        pushToast("未创建配音任务", "info")
        return
      }
      pushToast(`已提交 ${ids.length} 个配音任务`, "success")
      startPolling(ids, {
        episodeId,
        onAnyTerminal: () => void refreshStatus(),
        onAllSettled: () => {
          void fetchEpisodeDetail(episodeId)
          void refreshStatus()
          pushToast("配音任务已结束", "info")
        },
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast(`配音提交失败：${msg}`, "error")
    } finally {
      setBusy(false)
    }
  }

  if (elOk === false) {
    return (
      <div
        className="rounded border border-dashed border-[var(--color-newsprint-black)] p-4 text-sm text-[var(--color-muted)]"
        style={{ boxSizing: "border-box" }}
      >
        <div className="flex items-center gap-2 font-bold text-[var(--color-ink)] mb-1">
          <Mic className="w-4 h-4" />
          配音（ElevenLabs）
        </div>
        <p>服务端未配置 ELEVENLABS_API_KEY，请在项目根 .env 中配置后重启后端。</p>
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
        配音管理
      </div>
      <div className="flex flex-wrap gap-3 items-end mb-3">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider mb-1">
            音色
          </label>
          <select
            className="min-w-[12rem] border border-[var(--color-newsprint-black)] px-2 py-1.5 text-sm"
            style={{ boxSizing: "border-box" }}
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            disabled={elOk !== true || voices.length === 0}
          >
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
          disabled={busy || !voiceId}
          onClick={() => void handleBatch()}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          批量配音
        </Button>
      </div>
      <p className="text-xs text-[var(--color-muted)] mb-2">
        仅对当前<strong>已选定</strong>视频候选配音；切换候选后需重新生成。
      </p>
      <div className="max-h-40 overflow-y-auto border border-[var(--color-divider)] text-xs">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-divider)]">
              <th className="py-1 px-2">Shot</th>
              <th className="py-1 px-2">状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((r) => (
              <tr key={r.shotId} className="border-b border-[var(--color-outline-variant)]">
                <td className="py-1 px-2 font-mono">{r.shotId.slice(0, 8)}…</td>
                <td className="py-1 px-2">{r.dub?.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
