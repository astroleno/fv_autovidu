/**
 * storyboardTableColumnConfig — 分镜列表表可拖拽列宽：列键、默认值、下限、存储键
 *
 * - 与 `StoryboardPage` 表头 / `ShotRow` 单元格顺序严格一致（含可选「选」列）。
 * - 宽度存 `localStorage`，按剧集 `episodeId` 隔离，刷新后保留。
 */
export type StoryboardTableColKey =
  | "pick"
  | "number"
  | "duration"
  | "frames"
  | "video"
  | "status"
  | "dialogue"
  | "translation"
  | "dialogueInject"
  | "visualDesc"
  | "imagePrompt"
  | "videoPrompt"
  | "assets"
  | "candidates"
  | "actions"

/**
 * 初始列宽（px）。
 * - 编号/时长/视频/状态/候选等偏窄，为横向腾出空间给描述与提示词列（可换行后仍占宽度）。
 * - **画面描述 / 图片提示词 / 视频提示词** 三列默认同宽，便于扫读与拖拽对齐。
 */
export const STORYBOARD_COL_DEFAULTS_PX: Record<StoryboardTableColKey, number> =
  {
    pick: 44,
    number: 46,
    duration: 64,
    frames: 200,
    video: 112,
    status: 96,
    dialogue: 220,
    translation: 220,
    dialogueInject: 64,
    visualDesc: 200,
    imagePrompt: 200,
    videoPrompt: 200,
    assets: 168,
    candidates: 60,
    actions: 80,
  }

/** 拖拽时不窄于该值（px），避免列被拖到不可点 */
export const STORYBOARD_COL_MIN_PX: Record<StoryboardTableColKey, number> = {
  pick: 36,
  number: 44,
  duration: 64,
  frames: 120,
  video: 88,
  status: 80,
  dialogue: 120,
  translation: 120,
  dialogueInject: 56,
  visualDesc: 120,
  imagePrompt: 120,
  videoPrompt: 120,
  assets: 96,
  candidates: 56,
  actions: 64,
}

/**
 * 与当前 UI 一致的列顺序；`pick` 仅在框选模式出现。
 */
export function buildStoryboardColOrder(
  pickMode: boolean
): StoryboardTableColKey[] {
  const rest: StoryboardTableColKey[] = [
    "number",
    "duration",
    "frames",
    "video",
    "status",
    "dialogue",
    "translation",
    "dialogueInject",
    "visualDesc",
    "imagePrompt",
    "videoPrompt",
    "assets",
    "candidates",
    "actions",
  ]
  return pickMode ? ["pick", ...rest] : rest
}

export function storyboardColWidthsStorageKey(episodeId: string): string {
  return `fv-autovidu-storyboard-col-widths:${episodeId}`
}

export function mergeStoryboardColWidths(
  stored: Partial<Record<StoryboardTableColKey, number>> | null | undefined,
  order: StoryboardTableColKey[]
): Record<StoryboardTableColKey, number> {
  const out = { ...STORYBOARD_COL_DEFAULTS_PX }
  if (stored) {
    for (const k of order) {
      const v = stored[k]
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = Math.max(STORYBOARD_COL_MIN_PX[k], Math.round(v))
      }
    }
  }
  return out
}

export function sumStoryboardTableWidthPx(
  order: StoryboardTableColKey[],
  widths: Record<StoryboardTableColKey, number>
): number {
  return order.reduce((s, k) => s + (widths[k] ?? STORYBOARD_COL_DEFAULTS_PX[k]), 0)
}

/** 表头文案与无障碍名称 */
export const STORYBOARD_COL_HEADER_LABEL: Record<StoryboardTableColKey, string> =
  {
    pick: "选",
    number: "编号",
    duration: "时长",
    frames: "首尾帧",
    video: "视频",
    status: "状态",
    dialogue: "台词原文",
    translation: "译文",
    dialogueInject: "视频含台词",
    visualDesc: "画面描述",
    imagePrompt: "图片提示词",
    videoPrompt: "视频提示词",
    assets: "资产",
    candidates: "候选数",
    actions: "操作",
  }
