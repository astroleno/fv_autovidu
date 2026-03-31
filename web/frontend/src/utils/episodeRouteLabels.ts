/**
 * 根据当前 pathname 解析「剧集上下文下」最后一级面包屑文案。
 *
 * 与 SideNavBar 中剧集子导航一一对应，供 AppLayout / TopNavBar 使用。
 * 判断顺序：先匹配更长、更具体的路径（如 shot/.../regen），避免误伤。
 */

/**
 * @param pathname location.pathname（可含 query，会先剥离）
 * @returns 无对应子页时返回空字符串（例如停留在项目详情无 episode 子路径）
 */
export function getEpisodeSubpageLabel(pathname: string): string {
  const clean = pathname.split("?")[0]?.replace(/\/$/, "") || pathname
  /** 单帧重生页：…/shot/:shotId/regen */
  if (clean.includes("/shot/") && clean.endsWith("/regen")) {
    return "单帧重生"
  }
  if (clean.includes("/shot/")) {
    return "镜头"
  }
  if (clean.endsWith("/post-production")) {
    return "后期制作"
  }
  if (clean.endsWith("/pick")) {
    return "选片总览"
  }
  if (clean.endsWith("/timeline")) {
    return "粗剪预览"
  }
  if (clean.endsWith("/assets")) {
    return "资产库"
  }
  /** 分镜板：/project/:pid/episode/:eid 且无后续段 */
  if (/\/episode\/[^/]+$/.test(clean)) {
    return "分镜板"
  }
  return ""
}
