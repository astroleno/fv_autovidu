/**
 * 文件路径工具
 * 本地文件通过 /api/files/ 代理访问
 * @param relativePath - 相对路径，如 assets/xxx.png
 * @param basePath - 基础路径：`projectId/episodeId`，或多上下文时为 `contextId/projectId/episodeId`（见 buildEpisodeFileBasePath / useEpisodeFileBasePath）
 * @param cacheBust - 缓存破坏参数（如 pulledAt），用于强制刷新图片
 */
export function getFileUrl(
  relativePath: string,
  basePath = "",
  cacheBust?: string
): string {
  if (!relativePath) return ""
  const path = basePath ? `${basePath}/${relativePath}`.replace(/\/+/g, "/") : relativePath
  const base = `/api/files/${path}`
  if (cacheBust) return `${base}?v=${encodeURIComponent(cacheBust)}`
  return base
}
