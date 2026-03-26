/**
 * 粗剪台（Rough Cut）模块导出
 * 与原型 reference/frontend/stitch/timeline_newsprint 对齐的页面级组件集合
 */
export { RoughCutMetaBar } from "./RoughCutMetaBar"
export type { RoughCutMetaBarProps } from "./RoughCutMetaBar"
export { RoughCutActiveShotInfo } from "./RoughCutActiveShotInfo"
export type { RoughCutActiveShotInfoProps } from "./RoughCutActiveShotInfo"
export { RoughCutVideoPlayer } from "./RoughCutVideoPlayer"
export type { RoughCutVideoPlayerProps } from "./RoughCutVideoPlayer"
export { RoughCutActionBar } from "./RoughCutActionBar"
export type { RoughCutActionBarProps } from "./RoughCutActionBar"
export { RoughCutTimeline } from "./RoughCutTimeline"
export type { RoughCutTimelineProps, RoughCutTrackItem } from "./RoughCutTimeline"
export {
  formatTimeMmSs,
  formatTimeHhMmSs,
  buildRulerTicks,
  layoutDurationSec,
  getTimelineSeekTarget,
  timelinePercentFromClientX,
} from "./roughcutUtils"
export type { TimelineSeekTarget } from "./roughcutUtils"
