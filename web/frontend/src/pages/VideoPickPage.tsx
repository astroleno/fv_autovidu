/**
 * 选片总览页（VideoPickPage）
 *
 * 路由：/project/:projectId/episode/:episodeId/pick
 *
 * 职责：
 * - 在单页内浏览本集所有镜头的视频候选，支持原地选定与预览精出（与 ShotDetailPage 行为对齐）
 * - 按 Scene 折叠分组（复用 SceneGroup），筛选维度针对「选片」场景定制（含无视频快捷筛选）
 *
 * 刻意不包含：批量尾帧/视频、框选、配音条、导出面板等（保留在 StoryboardPage）
 */
import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router"
import { Clapperboard, LayoutGrid, Package } from "lucide-react"
import { useEpisodeMediaCacheBust } from "@/hooks"
import { useEpisodeStore } from "@/stores"
import { Skeleton } from "@/components/ui"
import { SceneGroup, VideoPickCard } from "@/components/business"
import { flattenShots } from "@/types"
import type { Shot } from "@/types"
import { aspectRatioGroupKey } from "@/utils/aspectRatio"
import { routes } from "@/utils/routes"

/** 选片页专用筛选：与分镜板 STATUS_FILTERS 区分，不写入 shotStore，避免跨页污染 */
type PickStatusFilter = "all" | "video_done" | "selected" | "no_video"

const PICK_STATUS_FILTERS: { value: PickStatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "video_done", label: "待选片" },
  { value: "selected", label: "已选定" },
  { value: "no_video", label: "无视频" },
]

/**
 * 判断单条镜头是否命中当前选片筛选
 * - no_video：无任意候选（引导用户回分镜板生成）
 * - video_done / selected：与后端 Shot.status 一致
 */
function shotMatchesPickFilter(
  shot: Shot,
  filter: PickStatusFilter
): boolean {
  switch (filter) {
    case "all":
      return true
    case "no_video":
      return shot.videoCandidates.length === 0
    case "video_done":
      return shot.status === "video_done"
    case "selected":
      return shot.status === "selected"
    default:
      return true
  }
}

/**
 * 选片页第二维筛选：按约化画幅分组（多组 9:16 / 16:9 / 1:1 等并存时只看我关心的一组）
 */
function shotMatchesAspectRatioKey(
  shot: Shot,
  aspectKey: string | "all"
): boolean {
  if (aspectKey === "all") return true
  return aspectRatioGroupKey(shot.aspectRatio) === aspectKey
}

export default function VideoPickPage() {
  const { projectId: routeProjectId, episodeId } = useParams<{
    projectId?: string
    episodeId: string
  }>()
  const {
    currentEpisode,
    loading,
    error: episodeError,
    fetchEpisodeDetail,
  } = useEpisodeStore()
  const cacheBust = useEpisodeMediaCacheBust(currentEpisode?.pulledAt)
  const [pickFilter, setPickFilter] = useState<PickStatusFilter>("all")
  /** 单集内多组画幅时：按 aspectRatioGroupKey 筛选；仅一种比例时不展示该行 */
  const [aspectRatioFilter, setAspectRatioFilter] = useState<string | "all">(
    "all"
  )

  useEffect(() => {
    if (episodeId) void fetchEpisodeDetail(episodeId)
  }, [episodeId, fetchEpisodeDetail])

  /**
   * 切换剧集时重置筛选，避免沿用上一次的「无视频」或画幅组条件造成空白困惑
   */
  useEffect(() => {
    setPickFilter("all")
    setAspectRatioFilter("all")
  }, [episodeId])

  const allShots = useMemo(
    () => (currentEpisode ? flattenShots(currentEpisode) : []),
    [currentEpisode]
  )

  /** 本集出现的画幅组（已约化）：例如同时存在 9:16、16:9、1:1 三组则 length===3 */
  const aspectRatioBuckets = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of allShots) {
      const k = aspectRatioGroupKey(s.aspectRatio)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))
      .map(([key, count]) => ({ key, count }))
  }, [allShots])

  const showAspectRatioFilter = aspectRatioBuckets.length > 1

  const filteredCount = useMemo(
    () =>
      allShots.filter(
        (s) =>
          shotMatchesPickFilter(s, pickFilter) &&
          shotMatchesAspectRatioKey(s, aspectRatioFilter)
      ).length,
    [allShots, pickFilter, aspectRatioFilter]
  )

  if (!episodeId) return null

  if (loading && !currentEpisode) {
    return (
      <div
        className="p-8 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <Skeleton height={48} className="mb-8" />
        <div className="grid grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={200} />
          ))}
        </div>
      </div>
    )
  }

  if (!currentEpisode) {
    const is404 =
      episodeError?.toLowerCase().includes("not found") ||
      episodeError?.includes("未找到")
    return (
      <div
        className="p-8 max-w-lg mx-auto text-center space-y-4 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <p className="text-[var(--color-newsprint-black)] font-bold">
          {is404 ? "本地尚未找到该剧集数据" : "未找到该剧集"}
        </p>
        <p className="text-sm text-[var(--color-muted)]">
          {is404
            ? "请从对应项目详情页使用「拉取后进入」，或顶部「从平台拉取」写入本地后再打开。"
            : episodeError || "请确认路由中的剧集 ID 是否正确。"}
        </p>
        {routeProjectId ? (
          <Link
            to={routes.project(routeProjectId)}
            className="inline-block text-sm font-bold text-[var(--color-primary)] underline"
          >
            返回项目详情
          </Link>
        ) : null}
      </div>
    )
  }

  const basePath = `${currentEpisode.projectId}/${currentEpisode.episodeId}`
  const projectId = routeProjectId ?? currentEpisode.projectId
  const totalShots = allShots.length

  return (
    <div
      className="p-8 box-border"
      style={{ boxSizing: "border-box" }}
    >
      <div className="mb-10 border-l-4 border-[var(--color-primary)] pl-6 box-border"
        style={{ boxSizing: "border-box" }}
      >
        <h1 className="text-4xl font-extrabold tracking-tighter text-[var(--color-newsprint-black)] uppercase mb-1 font-headline">
          {currentEpisode.episodeTitle} — 选片总览
        </h1>
        <p className="text-[var(--color-newsprint-black)] font-medium opacity-70 text-sm uppercase tracking-tight">
          共 {totalShots} 个镜头 · 当前筛选显示 {filteredCount} 个
          {showAspectRatioFilter
            ? ` · 画幅组 ${aspectRatioBuckets.length} 种（可筛选）`
            : null}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold uppercase tracking-wider">
          <span className="text-[var(--color-muted)] font-medium normal-case tracking-normal text-[13px] max-w-xl">
            在此页对照参考信息与候选视频并选定；需要编辑提示词或单帧重生请进镜头详情。
          </span>
          <Link
            to={routes.episode(projectId, episodeId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-newsprint-black)] bg-transparent hover:bg-[var(--color-outline-variant)] transition-colors box-border"
            style={{ boxSizing: "border-box" }}
          >
            <LayoutGrid className="w-4 h-4 shrink-0" aria-hidden />
            分镜板
          </Link>
          <Link
            to={routes.timeline(projectId, episodeId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-newsprint-black)] bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity box-border"
            style={{ boxSizing: "border-box" }}
          >
            <Clapperboard className="w-4 h-4 shrink-0" aria-hidden />
            粗剪时间线
          </Link>
          <Link
            to={routes.assets(projectId, episodeId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-newsprint-black)] bg-transparent hover:bg-[var(--color-outline-variant)] transition-colors box-border"
            style={{ boxSizing: "border-box" }}
          >
            <Package className="w-4 h-4 shrink-0" aria-hidden />
            资产库
          </Link>
        </div>
      </div>

      {/* 选片专用筛选条：样式与 StoryboardPage 按钮组保持一致 */}
      <div
        className="mb-8 flex flex-wrap items-center gap-2 box-border"
        style={{ boxSizing: "border-box" }}
      >
        {PICK_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setPickFilter(f.value)}
            className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border transition-colors box-border ${
              pickFilter === f.value
                ? "bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)] border-[var(--color-newsprint-black)]"
                : "bg-transparent text-[var(--color-ink)] border-[var(--color-newsprint-black)] hover:bg-[var(--color-outline-variant)]"
            }`}
            style={{ boxSizing: "border-box" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showAspectRatioFilter ? (
        <div
          className="mb-6 flex flex-wrap items-center gap-2 box-border"
          style={{ boxSizing: "border-box" }}
        >
          <span className="text-[10px] font-black uppercase text-[var(--color-muted)] mr-1 shrink-0">
            画幅
          </span>
          <button
            type="button"
            onClick={() => setAspectRatioFilter("all")}
            className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border transition-colors box-border ${
              aspectRatioFilter === "all"
                ? "bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)] border-[var(--color-newsprint-black)]"
                : "bg-transparent text-[var(--color-ink)] border-[var(--color-newsprint-black)] hover:bg-[var(--color-outline-variant)]"
            }`}
            style={{ boxSizing: "border-box" }}
          >
            全部比例
          </button>
          {aspectRatioBuckets.map(({ key, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setAspectRatioFilter(key)}
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider border transition-colors box-border ${
                aspectRatioFilter === key
                  ? "bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)] border-[var(--color-newsprint-black)]"
                  : "bg-transparent text-[var(--color-ink)] border-[var(--color-newsprint-black)] hover:bg-[var(--color-outline-variant)]"
              }`}
              style={{ boxSizing: "border-box" }}
            >
              {key}（{count}）
            </button>
          ))}
        </div>
      ) : null}

      {currentEpisode.scenes.map((scene) => {
        const sceneShots = scene.shots.filter(
          (s) =>
            shotMatchesPickFilter(s, pickFilter) &&
            shotMatchesAspectRatioKey(s, aspectRatioFilter)
        )
        if (sceneShots.length === 0) return null
        return (
          <SceneGroup key={scene.sceneId} scene={{ ...scene, shots: sceneShots }}>
            <div
              className="flex flex-col gap-6 box-border"
              style={{ boxSizing: "border-box" }}
            >
              {sceneShots.map((shot) => (
                <VideoPickCard
                  key={shot.shotId}
                  shot={shot}
                  projectId={projectId}
                  episodeId={episodeId}
                  basePath={basePath}
                  cacheBust={cacheBust}
                />
              ))}
            </div>
          </SceneGroup>
        )
      })}
    </div>
  )
}
