/**
 * 剧集静态资源在 /api/files/ 下的路径前缀。
 *
 * - 无多上下文（未选 Profile）：`projectId/episodeId`，与旧版一致；
 * - 有多上下文：`contextId/projectId/episodeId`，首段为 feeling_contexts.json 的 profile key，
 *   后端 files 路由据此映射到 DATA_ROOT/{envKey}/{workspaceKey}/...
 */
export function buildEpisodeFileBasePath(
  contextId: string | null | undefined,
  projectId: string,
  episodeId: string
): string {
  const c = contextId != null && String(contextId).trim() ? String(contextId).trim() : ""
  if (c) {
    return `${c}/${projectId}/${episodeId}`.replace(/\/+/g, "/")
  }
  return `${projectId}/${episodeId}`.replace(/\/+/g, "/")
}
