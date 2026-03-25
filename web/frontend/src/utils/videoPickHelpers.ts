/**
 * 选片双模式（Overview / Picking）共享纯函数
 *
 * 与 UI 无关：默认激活候选、待选判定、导航索引等，便于单测与多处复用。
 */
import type { Shot } from "@/types"

/**
 * 进入镜头或切换镜头后的默认「激活」候选：
 * - 已有服务端已选候选 → 用其 id（与播放/提交一致）
 * - 尚无已选 → 第一个候选
 * - 无候选 → null
 */
export function getDefaultActiveCandidateId(shot: Shot): string | null {
  const list = shot.videoCandidates
  if (list.length === 0) return null
  const selected = list.find((c) => c.selected)
  if (selected) return selected.id
  return list[0]?.id ?? null
}

/**
 * 「待选」：存在至少一个候选，且当前没有任何候选被标为已选
 *（与选片筛选「待选片」video_done 语义接近，但以候选勾选为准）
 */
export function isShotPendingPick(shot: Shot): boolean {
  if (shot.videoCandidates.length === 0) return false
  return !shot.videoCandidates.some((c) => c.selected)
}

/**
 * 在扁平镜头列表中找第一个「待选」镜头的索引；若无则返回 0（保证有镜头时可进入）
 */
export function findFirstPendingShotIndex(shots: Shot[]): number {
  const i = shots.findIndex((s) => isShotPendingPick(s))
  return i >= 0 ? i : 0
}

/**
 * 左右键导航：在「仅待选」开启时跳过已选定镜头，沿 direction 找到下一个可用索引；无则返回 null
 */
export function nextNavigatedIndex(
  shots: Shot[],
  currentIndex: number,
  onlyPending: boolean,
  direction: -1 | 1
): number | null {
  const n = shots.length
  if (n === 0) return null

  const eligible = (i: number) =>
    !onlyPending || isShotPendingPick(shots[i]!)

  for (let step = 1; step < n; step++) {
    const i = currentIndex + direction * step
    if (i < 0 || i >= n) break
    if (eligible(i)) return i
  }
  return null
}
