/**
 * 前端路由路径统一生成工具
 *
 * 避免在组件中手写 `/episode/...` 或 `/project/...` 字符串，减少漏改与拼写错误。
 * 与 App.tsx 中 createBrowserRouter 定义的路径保持一致。
 */

/** 应用内路径生成器（均不含域名与 base） */
export const routes = {
  /** 首页：项目列表 */
  home: () => "/",

  /** 本地已拉取剧集总览（调试用，非主导航） */
  localEpisodes: () => "/local-episodes",

  /** 单个项目详情（剧集列表 + 拉取） */
  project: (projectId: string) => `/project/${encodeURIComponent(projectId)}`,

  /** 项目下分镜板 */
  episode: (projectId: string, episodeId: string) =>
    `/project/${encodeURIComponent(projectId)}/episode/${encodeURIComponent(episodeId)}`,

  /** 资产库 */
  assets: (projectId: string, episodeId: string) =>
    `/project/${encodeURIComponent(projectId)}/episode/${encodeURIComponent(episodeId)}/assets`,

  /**
   * 资产库并定位到某条资产（打开详情弹窗）
   * AssetLibraryPage 读取 query `assetId` 后自动选中并展示大图
   */
  assetDetail: (projectId: string, episodeId: string, assetId: string) =>
    `${routes.assets(projectId, episodeId)}?assetId=${encodeURIComponent(assetId)}`,

  /** 镜头详情 */
  shot: (projectId: string, episodeId: string, shotId: string) =>
    `/project/${encodeURIComponent(projectId)}/episode/${encodeURIComponent(episodeId)}/shot/${encodeURIComponent(shotId)}`,

  /** 单帧重生页 */
  regen: (projectId: string, episodeId: string, shotId: string) =>
    `/project/${encodeURIComponent(projectId)}/episode/${encodeURIComponent(episodeId)}/shot/${encodeURIComponent(shotId)}/regen`,

  /** 时间线 */
  timeline: (projectId: string, episodeId: string) =>
    `/project/${encodeURIComponent(projectId)}/episode/${encodeURIComponent(episodeId)}/timeline`,

  /** 选片总览：同剧集中所有镜头的视频候选浏览与选定 */
  videopick: (projectId: string, episodeId: string) =>
    `/project/${encodeURIComponent(projectId)}/episode/${encodeURIComponent(episodeId)}/pick`,

  /**
   * 选片工作台·定位到指定镜头（shotId 为一次性启动参数，消费后由 VideoPickPage 清除）
   */
  videopickShot: (projectId: string, episodeId: string, shotId: string) =>
    `${routes.videopick(projectId, episodeId)}?shotId=${encodeURIComponent(shotId)}`,

  /** 设置 */
  settings: () => "/settings",
}
