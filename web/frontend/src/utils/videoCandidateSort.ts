/**
 * 视频候选顺序与「物理最新」判定
 *
 * 主键：`VideoCandidate.createdAt`（ISO 8601，与后端 `generate.py` 写入一致）。
 * 若多候选同秒创建（秒级精度），以 **数组下标较大者** 为「更新」——与 `add_video_candidate` 追加语义一致。
 *
 * 见 `docs/superpowers/specs/2025-03-26-video-generation-modes-retry-design.md` §6.1。
 */
import type { VideoCandidate } from "@/types/episode"

/**
 * 返回「物理最新」候选：先按 `createdAt` 字典序比较；相等时取 **数组中更靠后** 的项（同秒 tie-break）。
 */
export function pickNewestCandidate(
  candidates: VideoCandidate[]
): VideoCandidate | null {
  if (candidates.length === 0) return null
  let bestIdx = 0
  for (let i = 1; i < candidates.length; i++) {
    const a = candidates[bestIdx]
    const b = candidates[i]
    if (b.createdAt > a.createdAt) {
      bestIdx = i
    } else if (b.createdAt === a.createdAt) {
      // 同秒：后追加的条目更「新」
      bestIdx = i
    }
  }
  return candidates[bestIdx]
}

/**
 * 某候选是否为当前镜下「物理最新」（createdAt 最大；同秒则数组下标最大）。
 */
export function isPhysicallyNewest(
  cand: VideoCandidate,
  all: VideoCandidate[]
): boolean {
  const n = pickNewestCandidate(all)
  return n !== null && n.id === cand.id
}
