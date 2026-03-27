/**
 * 视频候选「精出 1080p」展示条件：与后端 POST /generate/video/promote 支持的模式一致。
 * 仅 first_frame / first_last_frame 可精出；reference 等不展示按钮，避免 400。
 */
import type { VideoCandidate } from "@/types"

export function candidateCanPromoteToFullQuality(c: VideoCandidate): boolean {
  return (
    Boolean(c.isPreview) &&
    c.taskStatus === "success" &&
    c.seed > 0 &&
    (c.mode === "first_frame" || c.mode === "first_last_frame")
  )
}
