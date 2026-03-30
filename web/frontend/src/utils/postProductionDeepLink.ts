/**
 * 后期制作页深链：带可选 shotId 查询参数，供选片等入口跳转并在 DubPanel 展开对应行。
 */
import { routes } from "@/utils/routes"

/**
 * @param projectId 项目 id
 * @param episodeId 剧集 id
 * @param shotId 可选；有值则附加 `?shotId=`（encodeURIComponent）
 */
export function postProductionHrefWithShot(
  projectId: string,
  episodeId: string,
  shotId?: string | null
): string {
  const base = routes.postProduction(projectId, episodeId)
  const s = shotId?.trim()
  if (!s) return base
  return `${base}?shotId=${encodeURIComponent(s)}`
}
