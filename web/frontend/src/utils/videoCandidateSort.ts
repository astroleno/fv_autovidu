/**
 * 视频候选顺序与「物理最新」判定
 *
 * 与 `VideoCandidate.createdAt`（ISO 8601）对齐：用于选片页展示「最新」标签，
 * 不依赖服务端额外字段（见 docs/superpowers/specs/2025-03-26-video-generation-modes-retry-design.md §6.1）。
 */
import type { VideoCandidate } from "@/types/episode"

/**
 * 按 `createdAt` 字典序比较，返回较新的一条（相等时保留先传入的 tie-break）。
 */
export function pickNewestCandidate(
  candidates: VideoCandidate[]
): VideoCandidate | null {
  if (candidates.length === 0) return null
  return candidates.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b))
}

/**
 * 某候选是否为当前镜下 createdAt 最大（物理最新）。
 */
export function isPhysicallyNewest(
  cand: VideoCandidate,
  all: VideoCandidate[]
): boolean {
  const n = pickNewestCandidate(all)
  return n !== null && n.id === cand.id
}
