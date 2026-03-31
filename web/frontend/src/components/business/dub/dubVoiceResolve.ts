/**
 * 本集/本镜「最终生效」ElevenLabs 音色解析（与 DubPanel 行为一致）。
 *
 * 优先级：镜头 dubVoiceIdOverride → 角色资产 characterVoices[assetId] → 集默认 dubDefaultVoiceId。
 * 说话角色资产：显式 dubSpeakerAssetId → 否则按 associatedDialogue.role 匹配角色资产名。
 */
import type { Episode, Shot, ShotAsset } from "@/types"

export function speakerAssetIdForShot(
  shot: Shot,
  episodeAssets: ShotAsset[],
): string {
  const manual = (shot.dubSpeakerAssetId ?? "").trim()
  if (manual) return manual
  const role = (shot.associatedDialogue?.role ?? "").trim()
  if (!role) return ""
  const seen = new Set<string>()
  for (const asset of [...(shot.assets ?? []), ...episodeAssets]) {
    if (asset.type !== "character") continue
    if (seen.has(asset.assetId)) continue
    seen.add(asset.assetId)
    if (asset.name.trim() === role) return asset.assetId
  }
  return ""
}

export function speakerAssetsForShot(
  shot: Shot,
  episodeAssets: ShotAsset[],
): ShotAsset[] {
  const seen = new Set<string>()
  const out: ShotAsset[] = []
  for (const asset of [...(shot.assets ?? []), ...episodeAssets]) {
    if (asset.type !== "character") continue
    if (seen.has(asset.assetId)) continue
    seen.add(asset.assetId)
    out.push(asset)
  }
  return out
}

/**
 * @returns 最终用于 STS/TTS 的 voiceId（可能为空字符串，表示未配置）
 */
export function effectiveVoiceIdForShot(
  shot: Shot,
  episode: Episode | null,
  episodeAssets: ShotAsset[],
  defaultVoiceId: string,
): string {
  const override = (shot.dubVoiceIdOverride ?? "").trim()
  if (override) return override
  const assetId = speakerAssetIdForShot(shot, episodeAssets)
  const bound =
    assetId && episode?.characterVoices
      ? (episode.characterVoices[assetId]?.voiceId ?? "").trim()
      : ""
  return bound || defaultVoiceId
}
