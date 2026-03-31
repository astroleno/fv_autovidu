/**
 * 剪映字幕纵向参数（transform_y）在前端「示意画框」中的布局换算。
 *
 * 后端映射见 `jianying_text_track.build_text_track_payload` → `ClipSettings.transform_y`。
 * 此处只做示意条在容器内的 bottom 百分比，不保证与剪映渲染像素一致。
 */

const TRANSFORM_Y_MIN = -1
const TRANSFORM_Y_MAX = 0

/** 距底 6%～38%：滑块从 -1 到 0 时示意条整体上移 */
const BOTTOM_PERCENT_AT_MIN_Y = 6
const BOTTOM_PERCENT_AT_MAX_Y = 38

/**
 * 将业务允许的 transform_y 钳制到剪映导出所用区间。
 */
export function clampTransformY(value: number): number {
  if (Number.isNaN(value)) return -0.8
  return Math.min(TRANSFORM_Y_MAX, Math.max(TRANSFORM_Y_MIN, value))
}

/**
 * @param transformY 原始值（建议先经 clampTransformY）
 * @returns 用于 `position:absolute; bottom: X%` 的 X（画框高度的百分比）
 */
export function transformYToPreviewBottomPercent(transformY: number): number {
  const t = clampTransformY(transformY)
  const u = (t - TRANSFORM_Y_MIN) / (TRANSFORM_Y_MAX - TRANSFORM_Y_MIN)
  return BOTTOM_PERCENT_AT_MIN_Y + u * (BOTTOM_PERCENT_AT_MAX_Y - BOTTOM_PERCENT_AT_MIN_Y)
}
