/**
 * 选片总览页（VideoPickPage）
 *
 * 路由：/project/:projectId/episode/:episodeId/pick
 *
 * 职责：
 * - 在单页内浏览本集所有镜头的视频候选，支持原地选定与预览精出（单镜头精细迭代在 picking 模式）
 * - 按 Scene 折叠分组（复用 SceneGroup），筛选维度针对「选片」场景定制（含无视频快捷筛选）
 *
 * 刻意不包含：批量尾帧/视频、框选、全量配音与剪映导出等（在后期制作页 PostProductionPage，与分镜职责分离）
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { flushSync } from "react-dom"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { Clapperboard, LayoutGrid, Mic, Package } from "lucide-react"
import { useEpisodeMediaCacheBust } from "@/hooks"
import { useEpisodeFileBasePath } from "@/hooks/useEpisodeFileBasePath"
import {
  useEpisodeStore,
  useVideoPickStore,
  readStoredVideoPickMode,
  writeStoredVideoPickMode,
} from "@/stores"
import { Skeleton } from "@/components/ui"
import {
  SceneGroup,
  VideoPickCard,
  VideoPickFocusPanel,
  VideoPickModeToggle,
} from "@/components/business"
import { flattenShots } from "@/types"
import type { Shot } from "@/types"
import { aspectRatioGroupKey } from "@/utils/aspectRatio"
import {
  findFirstPendingShotIndex,
  resolveRequestedShotIndex,
} from "@/utils/videoPickHelpers"
import { routes } from "@/utils/routes"
import { postProductionHrefWithShot } from "@/utils/postProductionDeepLink"

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
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  /** 深链一次性参数：由 ShotDetailRedirectPage 或 videopickShot 写入，消费后 replace 清除 */
  const requestedShotId = searchParams.get("shotId")
  const consumedDeepLinkRef = useRef(false)
  /**
   * 记录上一次 URL 中的 shotId 查询值（含 null），用于同集内从「无 query」再点分镜链到「新 shotId」时，
   * 与 consumedDeepLinkRef 配合：仅当参数变为新的非空值时重新允许消费深链。
   */
  const prevShotIdParamRef = useRef<string | null>(null)
  const resetSessionEpisodeRef = useRef<string | null>(null)
  /**
   * 与 localStorage 模式恢复配合：深链处理成功时置为当前 episodeId，避免后续 effect 覆盖为 overview。
   */
  const episodeModeAppliedRef = useRef<string | null>(null)

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
  const mode = useVideoPickStore((s) => s.mode)
  const currentShotIndex = useVideoPickStore((s) => s.currentShotIndex)
  const enterPicking = useVideoPickStore((s) => s.enterPicking)
  const exitPicking = useVideoPickStore((s) => s.exitPicking)
  const resetSessionForEpisode = useVideoPickStore(
    (s) => s.resetSessionForEpisode
  )
  const cacheBust = useEpisodeMediaCacheBust(currentEpisode?.pulledAt)
  const basePath = useEpisodeFileBasePath()
  const [pickFilter, setPickFilter] = useState<PickStatusFilter>("all")
  /** 单集内多组画幅时：按 aspectRatioGroupKey 筛选；仅一种比例时不展示该行 */
  const [aspectRatioFilter, setAspectRatioFilter] = useState<string | "all">(
    "all"
  )

  /**
   * 深链进入时恢复「全部 + 全部画幅」，保证目标镜头出现在 filteredFlatShots 中且索引与全量列表一致。
   */
  const resetFilters = useCallback(() => {
    setPickFilter("all")
    setAspectRatioFilter("all")
  }, [])

  /**
   * 换集：必须在「参数追踪 / 深链消费」两个 layout 之前执行，避免沿用上集的 shot 参数基线。
   * useLayoutEffect 保证早于下方深链逻辑与 paint，与 episodeId 变更同一帧内 URL 可能仍带 ?shotId= 对齐。
   */
  useLayoutEffect(() => {
    consumedDeepLinkRef.current = false
    prevShotIdParamRef.current = null
  }, [episodeId])

  /**
   * 同集内第二次及以后从分镜点进（URL 再次出现 ?shotId=）：此前 consumedDeepLinkRef 已为 true，
   * 需在消费前根据「新的 shotId 查询串」重新打开闸门；仅当 requestedShotId 相对上一快照变化且非空时重置。
   */
  useLayoutEffect(() => {
    if (
      requestedShotId &&
      requestedShotId !== prevShotIdParamRef.current
    ) {
      consumedDeepLinkRef.current = false
    }
    prevShotIdParamRef.current = requestedShotId
  }, [requestedShotId])

  /**
   * `?shotId=` 定位：必须在同一帧内 flush 筛选再 enterPicking，避免索引用到旧筛选下的列表。
   * 先于 useEffect(localStorage 模式恢复) 执行，避免被 overview 覆盖。
   */
  useLayoutEffect(() => {
    if (!currentEpisode || !episodeId || !routeProjectId) return
    if (!requestedShotId || consumedDeepLinkRef.current) return
    const projectId = routeProjectId ?? currentEpisode.projectId
    const allShots = flattenShots(currentEpisode)
    const index = resolveRequestedShotIndex(allShots, requestedShotId)
    if (index == null) {
      consumedDeepLinkRef.current = true
      navigate(routes.videopick(projectId, episodeId), { replace: true })
      return
    }
    consumedDeepLinkRef.current = true
    episodeModeAppliedRef.current = episodeId
    flushSync(() => {
      resetFilters()
    })
    enterPicking(index)
    writeStoredVideoPickMode(episodeId, "picking")
    navigate(routes.videopick(projectId, episodeId), { replace: true })
  }, [
    currentEpisode,
    enterPicking,
    episodeId,
    navigate,
    requestedShotId,
    resetFilters,
    routeProjectId,
  ])

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

  /**
   * 切换剧集时清空选片模式会话态（激活候选、撤销栈等）。
   * 仅在当前页面首次进入该 episode 时执行一次；
   * 若本次是 `?shotId=` 深链进入，则保留已在 useLayoutEffect 中写入的目标索引，避免消费查询参数后又被回置为 0。
   */
  useEffect(() => {
    if (!episodeId) return
    if (resetSessionEpisodeRef.current === episodeId) return
    resetSessionEpisodeRef.current = episodeId
    resetSessionForEpisode({
      preserveCurrentShotIndex: Boolean(requestedShotId),
    })
  }, [episodeId, requestedShotId, resetSessionForEpisode])

  const allShots = useMemo(
    () => (currentEpisode ? flattenShots(currentEpisode) : []),
    [currentEpisode]
  )

  /**
   * 与列表渲染一致的筛选后扁平镜头序列（叙事顺序），供 Picking 模式与 flatIndex 对齐。
   */
  const filteredFlatShots = useMemo(() => {
    if (!currentEpisode) return []
    return flattenShots(currentEpisode).filter(
      (s) =>
        shotMatchesPickFilter(s, pickFilter) &&
        shotMatchesAspectRatioKey(s, aspectRatioFilter)
    )
  }, [currentEpisode, pickFilter, aspectRatioFilter])

  const shotIdToFlatIndex = useMemo(() => {
    const m = new Map<string, number>()
    filteredFlatShots.forEach((s, i) => {
      m.set(s.shotId, i)
    })
    return m
  }, [filteredFlatShots])

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

  const filteredCount = filteredFlatShots.length

  useEffect(() => {
    if (!episodeId || !currentEpisode) return
    /** 有未消费的 shotId 查询参数时由 useLayoutEffect 先处理，避免本 effect 抢跑成 overview */
    if (requestedShotId) return
    if (episodeModeAppliedRef.current === episodeId) return
    const m = readStoredVideoPickMode(episodeId)
    if (filteredFlatShots.length === 0) {
      if (allShots.length === 0) return
      episodeModeAppliedRef.current = episodeId
      if (m === "picking") enterPicking(0)
      else exitPicking()
      return
    }
    episodeModeAppliedRef.current = episodeId
    if (m === "picking") {
      enterPicking(findFirstPendingShotIndex(filteredFlatShots))
    } else {
      exitPicking()
    }
  }, [
    episodeId,
    currentEpisode,
    filteredFlatShots,
    allShots.length,
    enterPicking,
    exitPicking,
    requestedShotId,
  ])

  /** 模式变更时写回 localStorage（切换剧集后的首次 reset 跳过，避免覆盖待恢复的模式） */
  const skipNextModePersistRef = useRef(false)
  useEffect(() => {
    skipNextModePersistRef.current = true
  }, [episodeId])

  useEffect(() => {
    if (!episodeId) return
    if (skipNextModePersistRef.current) {
      skipNextModePersistRef.current = false
      return
    }
    writeStoredVideoPickMode(episodeId, mode)
  }, [episodeId, mode])

  /** 从 Picking 返回列表时恢复进入选片前滚动位置 */
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (!episodeId) return
    if (prevModeRef.current === "picking" && mode === "overview") {
      const key = `fv_pick_scroll_${episodeId}`
      const y = sessionStorage.getItem(key)
      if (y != null) {
        requestAnimationFrame(() => {
          window.scrollTo(0, Number(y))
        })
      }
    }
    prevModeRef.current = mode
  }, [episodeId, mode])

  const saveScrollAndEnterPicking = useCallback(() => {
    if (!episodeId) return
    sessionStorage.setItem(
      `fv_pick_scroll_${episodeId}`,
      String(window.scrollY)
    )
  }, [episodeId])

  const handleEnterPickingFromToolbar = useCallback(() => {
    saveScrollAndEnterPicking()
    enterPicking(findFirstPendingShotIndex(filteredFlatShots))
  }, [enterPicking, filteredFlatShots, saveScrollAndEnterPicking])

  const handleEnterPickingFromCard = useCallback(
    (flatIndex: number) => {
      saveScrollAndEnterPicking()
      enterPicking(flatIndex)
    },
    [enterPicking, saveScrollAndEnterPicking]
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

  const projectId = routeProjectId ?? currentEpisode.projectId
  const totalShots = allShots.length
  /** 选片模式中带上当前镜 shotId，与 postProductionDeepLink 单测一致 */
  const postProductionHref = postProductionHrefWithShot(
    projectId,
    episodeId,
    mode === "picking" ? filteredFlatShots[currentShotIndex]?.shotId : undefined
  )

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
          <VideoPickModeToggle onEnterPicking={handleEnterPickingFromToolbar} />
          <span className="text-[var(--color-muted)] font-medium normal-case tracking-normal text-[13px] max-w-xl">
            列表模式扫全局；进入选片模式后在右侧参考区编辑视频提示词、时长并发起重试。完整编辑画面/图像提示词请回分镜表。
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
            粗剪预览
          </Link>
          <Link
            to={routes.assets(projectId, episodeId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-newsprint-black)] bg-transparent hover:bg-[var(--color-outline-variant)] transition-colors box-border"
            style={{ boxSizing: "border-box" }}
          >
            <Package className="w-4 h-4 shrink-0" aria-hidden />
            资产库
          </Link>
          <Link
            to={postProductionHref}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-newsprint-black)] bg-transparent hover:bg-[var(--color-outline-variant)] transition-colors box-border"
            style={{ boxSizing: "border-box" }}
          >
            <Mic className="w-4 h-4 shrink-0" aria-hidden />
            后期制作
          </Link>
        </div>
      </div>

      {mode === "picking" ? (
        <VideoPickFocusPanel
          filteredShots={filteredFlatShots}
          projectId={projectId}
          episodeId={episodeId}
          basePath={basePath}
          cacheBust={cacheBust}
        />
      ) : (
        <>
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
                  flatIndex={shotIdToFlatIndex.get(shot.shotId) ?? 0}
                  onEnterPicking={handleEnterPickingFromCard}
                />
              ))}
            </div>
          </SceneGroup>
        )
      })}
        </>
      )}
    </div>
  )
}
