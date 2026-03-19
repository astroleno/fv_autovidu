/**
 * 格式化工具
 * 时间、状态等
 */
import type { Episode, ShotStatus } from "@/types"
import { flattenShots } from "@/types"

/** 相对时间，如 "2小时前" */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffM = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)

  if (diffM < 60) return `${diffM} 分钟前`
  if (diffH < 24) return `${diffH} 小时前`
  return `${diffD} 天前`
}

/** Episode 进度统计 */
export function getEpisodeStats(episode: Episode) {
  const shots = flattenShots(episode)
  const total = shots.length
  const pending = shots.filter(
    (s) =>
      s.status === "pending" ||
      s.status === "endframe_generating" ||
      s.status === "video_generating"
  ).length
  const endframeDone = shots.filter((s) => s.status === "endframe_done").length
  const videoDone = shots.filter((s) => s.status === "video_done").length
  const selected = shots.filter((s) => s.status === "selected").length

  const percent =
    total > 0 ? Math.round((selected / total) * 100) : 0

  return {
    total,
    pending,
    endframeDone,
    videoDone,
    selected,
    percent,
  }
}

/** ShotStatus 中文标签 */
export const shotStatusLabels: Record<ShotStatus, string> = {
  pending: "待处理",
  endframe_generating: "尾帧生成中",
  endframe_done: "尾帧完成",
  video_generating: "视频生成中",
  video_done: "视频完成",
  selected: "已选定",
  error: "出错",
}
