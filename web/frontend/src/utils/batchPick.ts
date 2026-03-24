/**
 * 批量操作：根据「全部符合条件」或「仅已勾选」过滤镜头列表
 */
import type { Shot } from "@/types"
import type { BatchPickMode } from "@/stores/shotStore"

/**
 * @param mode - all_eligible：返回 eligible 全部；manual：仅保留 shotId 在 pickedIds 中的项
 */
export function filterShotsByBatchPick(
  mode: BatchPickMode,
  pickedIds: string[],
  eligible: Shot[]
): Shot[] {
  if (mode === "all_eligible") return eligible
  const set = new Set(pickedIds)
  return eligible.filter((s) => set.has(s.shotId))
}
