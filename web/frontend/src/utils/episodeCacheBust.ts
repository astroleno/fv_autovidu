/**
 * episodeCacheBust
 *
 * 说明：分镜/资产/COS 代理图片的 URL 通过 getFileUrl(..., cacheBust) 拼接 `?v=` 打破浏览器缓存。
 * - pulledAt：平台「拉取」写入 episode.json，仅随 pull 变化；
 * - 尾帧、视频、单帧重生等 **仅写本地磁盘** 时 pulledAt 往往不变，若只用它作为 v=，
 *   则「状态已从 JSON 更新但 URL 未变」时浏览器会继续显示旧的空白图或旧尾帧。
 *
 * localMediaEpoch：纯前端维护的单调递增计数（见 episodeStore.bumpLocalMediaCache），
 * 在任务进入终态并重新拉详情后递增一次，使同一相对路径下得新的查询串，强制重新请求图片。
 */

/**
 * 组合「拉取时间戳」与「本地媒体写入世代」，供 getFileUrl 的第三参使用。
 *
 * @param pulledAt - 后端 episode.pulledAt，可能为空
 * @param localMediaEpoch - 本地 bump 次数，0 表示尚未因生成任务 bump
 * @returns undefined 表示不传 v=（与历史行为一致）；否则为 `pulledAt|loc:n` 或其一
 */
export function buildEpisodeMediaCacheBust(
  pulledAt: string | undefined | null,
  localMediaEpoch: number
): string | undefined {
  const p = typeof pulledAt === "string" ? pulledAt.trim() : ""
  const loc = localMediaEpoch > 0 ? `loc:${localMediaEpoch}` : ""
  const parts = [p, loc].filter(Boolean)
  if (parts.length === 0) return undefined
  return parts.join("|")
}
