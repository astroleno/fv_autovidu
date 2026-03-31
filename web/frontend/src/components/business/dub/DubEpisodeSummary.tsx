/**
 * 配音 Tab 顶部汇总：音色编排（集默认、角色绑定、按生效音色分组镜头）与台词表（原文/译文/角色/配音状态）。
 *
 * 数据与 DubPanel 列表一致，便于在展开逐镜前掌握全局。
 */
import type { DubStatus, Episode, Shot } from "@/types"
import { effectiveVoiceIdForShot } from "./dubVoiceResolve"

export interface DubEpisodeSummaryProps {
  episode: Episode
  shots: Shot[]
  /** ElevenLabs 音色列表（用于 id → 展示名） */
  voices: Array<{ voiceId: string; name: string }>
  /** 与 DubPanel 同步：GET dub status + 行内 shot.dub */
  dubByShot: Record<string, DubStatus | null>
}

function voiceDisplayName(
  voiceId: string,
  voices: Array<{ voiceId: string; name: string }>,
): string {
  const v = voices.find((x) => x.voiceId === voiceId)
  return v ? `${v.name}` : voiceId || "—"
}

function dubRowStatus(
  dub: DubStatus | null | undefined,
  dubEligible: boolean,
): string {
  if (!dubEligible) return "无已选视频"
  if (!dub) return "未生成"
  switch (dub.status) {
    case "completed":
      return "完成"
    case "processing":
      return "处理中"
    case "failed":
      return dub.error ? `失败：${dub.error.slice(0, 32)}` : "失败"
    case "stale":
      return "已过期"
    case "pending":
      return "排队中"
    default:
      return String(dub.status)
  }
}

function dialogueRole(shot: Shot): string {
  const r = (shot.associatedDialogue?.role ?? "").trim()
  return r || "—"
}

function dialogueOriginal(shot: Shot): string {
  return (shot.dialogue ?? "").trim() || "—"
}

function dialogueTranslation(shot: Shot): string {
  return (shot.dialogueTranslation ?? "").trim() || "—"
}

export function DubEpisodeSummary({
  episode,
  shots,
  voices,
  dubByShot,
}: DubEpisodeSummaryProps) {
  const episodeAssets = episode.assets ?? []
  const defaultVid = (episode.dubDefaultVoiceId ?? "").trim()

  /** 角色资产 id → 绑定音色展示名 */
  const characterRows = Object.entries(episode.characterVoices ?? {}).map(
    ([assetId, binding]) => {
      const assetName =
        episodeAssets.find((a) => a.assetId === assetId)?.name ??
        shotAssetNameFromShots(shots, assetId) ??
        assetId
      const vid = (binding.voiceId ?? "").trim()
      return {
        assetId,
        assetName,
        voiceLabel: vid ? voiceDisplayName(vid, voices) : "未绑定",
        voiceId: vid || "—",
      }
    },
  )

  /** 生效音色 voiceId → 镜头号列表（用于快速扫一眼哪些镜共用同一音色） */
  const byEffective = new Map<string, number[]>()
  for (const s of shots) {
    const eff = effectiveVoiceIdForShot(s, episode, episodeAssets, defaultVid)
    const key = eff || "(未配置)"
    const prev = byEffective.get(key) ?? []
    prev.push(s.shotNumber)
    byEffective.set(key, prev)
  }

  return (
    <div
      className="mb-4 space-y-4 rounded border border-[var(--color-divider)] bg-white/80 p-4 box-border"
      style={{ boxSizing: "border-box" }}
      data-testid="dub-episode-summary"
    >
      <section>
        <h3 className="text-[11px] font-black uppercase tracking-wider text-[var(--color-muted)] mb-2">
          音色编排总览
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div
            className="rounded border border-[var(--color-outline-variant)] p-3 box-border"
            style={{ boxSizing: "border-box" }}
          >
            <p className="text-[10px] font-bold uppercase text-[var(--color-muted)] mb-1">
              集默认音色
            </p>
            <p className="text-[var(--color-newsprint-black)] font-semibold">
              {defaultVid
                ? `${voiceDisplayName(defaultVid, voices)}`
                : "未设置（请在下方面板选择）"}
            </p>
            {defaultVid ? (
              <code className="mt-1 block text-[10px] text-[var(--color-muted)] break-all">
                {defaultVid}
              </code>
            ) : null}
          </div>
          <div
            className="rounded border border-[var(--color-outline-variant)] p-3 box-border"
            style={{ boxSizing: "border-box" }}
          >
            <p className="text-[10px] font-bold uppercase text-[var(--color-muted)] mb-1">
              语言（本集）
            </p>
            <p className="text-[var(--color-ink)]">
              配音目标语：<strong>{episode.dubTargetLocale?.trim() || "—"}</strong>
            </p>
            <p className="text-[var(--color-ink)] mt-1">
              原文语言：<strong>{episode.sourceLocale?.trim() || "—"}</strong>
            </p>
          </div>
        </div>

        {characterRows.length > 0 ? (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase text-[var(--color-muted)] mb-1">
              角色资产绑定音色
            </p>
            <div className="overflow-x-auto border border-[var(--color-divider)] text-xs">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[var(--color-outline-variant)]/40 text-left text-[var(--color-muted)]">
                    <th className="py-1.5 px-2 font-bold">角色 / 资产</th>
                    <th className="py-1.5 px-2 font-bold">绑定音色</th>
                    <th className="py-1.5 px-2 font-bold">voiceId</th>
                  </tr>
                </thead>
                <tbody>
                  {characterRows.map((row) => (
                    <tr
                      key={row.assetId}
                      className="border-t border-[var(--color-outline-variant)]"
                    >
                      <td className="py-1.5 px-2">{row.assetName}</td>
                      <td className="py-1.5 px-2">{row.voiceLabel}</td>
                      <td className="py-1.5 px-2 font-mono text-[10px] break-all">
                        {row.voiceId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            暂无角色级音色绑定；镜头将使用集默认音色，除非在下方为单镜指定覆盖或匹配到角色。
          </p>
        )}

        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase text-[var(--color-muted)] mb-1">
            各镜最终生效音色（解析后）
          </p>
          <ul className="text-xs space-y-1 text-[var(--color-ink)]">
            {Array.from(byEffective.entries()).map(([vidKey, nums]) => (
              <li key={vidKey}>
                <span className="font-mono font-semibold text-[var(--color-newsprint-black)]">
                  {vidKey === "(未配置)"
                    ? "(未配置)"
                    : voiceDisplayName(
                        vidKey,
                        voices,
                      )}
                </span>
                <span className="text-[var(--color-muted)]"> · 镜头 </span>
                {nums.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h3 className="text-[11px] font-black uppercase tracking-wider text-[var(--color-muted)] mb-2">
          台词与配音状态总览
        </h3>
        <div
          className="max-h-[min(50vh,22rem)] overflow-auto border border-[var(--color-divider)] text-xs box-border"
          style={{ boxSizing: "border-box" }}
        >
          <table className="w-full border-collapse min-w-[640px]">
            <thead>
              <tr className="text-left bg-[var(--color-outline-variant)]/40 text-[var(--color-muted)] border-b border-[var(--color-divider)]">
                <th className="py-2 px-2 w-10">#</th>
                <th className="py-2 px-2 w-20">角色</th>
                <th className="py-2 px-2 min-w-[8rem]">原文台词</th>
                <th className="py-2 px-2 min-w-[8rem]">译文</th>
                <th className="py-2 px-2 w-28">本镜生效音色</th>
                <th className="py-2 px-2 w-32">配音状态</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((shot) => {
                const selected = shot.videoCandidates.find((c) => c.selected)
                const dubEligible = Boolean(selected?.videoPath)
                const dub = dubByShot[shot.shotId] ?? shot.dub ?? null
                const eff = effectiveVoiceIdForShot(
                  shot,
                  episode,
                  episodeAssets,
                  defaultVid,
                )
                return (
                  <tr
                    key={shot.shotId}
                    className="border-b border-[var(--color-outline-variant)] align-top"
                  >
                    <td className="py-2 px-2 text-[var(--color-muted)]">{shot.shotNumber}</td>
                    <td className="py-2 px-2">{dialogueRole(shot)}</td>
                    <td className="py-2 px-2 whitespace-pre-wrap break-words">
                      {dialogueOriginal(shot)}
                    </td>
                    <td className="py-2 px-2 whitespace-pre-wrap break-words">
                      {dialogueTranslation(shot)}
                    </td>
                    <td className="py-2 px-2 font-mono text-[10px] break-all">
                      {eff ? voiceDisplayName(eff, voices) : "—"}
                    </td>
                    <td className="py-2 px-2">{dubRowStatus(dub, dubEligible)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/** 从镜头内嵌 assets 反查资产名（episode.assets 未含该 id 时） */
function shotAssetNameFromShots(shots: Shot[], assetId: string): string | undefined {
  for (const sh of shots) {
    const a = sh.assets?.find((x) => x.assetId === assetId)
    if (a) return a.name
  }
  return undefined
}
