/**
 * storyboardFieldClasses — 分镜表内「先看起来像纯文案，点击再编辑」的共用样式
 *
 * ## 产品约定
 * - 与 `ShotPromptCells`（画面描述 / 图片提示词 / 视频提示词）一致：**非编辑态无框**，仅 `text-xs` 弱化色 + hover 浅底；
 * - **编辑态**才出现 `border-2` 主色描边与浅纸色底（仅限当前正在编辑的那一格）。
 *
 * ## 使用组件
 * - `ShotPromptCells`：预览按钮 + 展开 textarea
 * - `ShotDialogueCells`：台词 / 译文两列预览 + 单点编辑
 * - `ShotDialogueInjectCell`：是否将台词注入 Vidu 视频 composed prompt（checkbox）
 * - `ShotDurationCell`：「N秒」预览 + 单行输入编辑
 */

/**
 * 预览态：整块区域可点击，视觉与提示词列「未编辑」时一致。
 */
export const STORYBOARD_TABLE_PREVIEW_BUTTON_CLASS = [
  "w-full text-left truncate block cursor-text",
  "hover:bg-[var(--color-divider)]/50 -m-1 p-1 rounded",
  "text-xs text-[var(--color-muted)]",
].join(" ")

/**
 * 画面描述 / 图片提示词 / 视频提示词 — **外层 button**（可点击、hover 底）
 * 内层请配合 `STORYBOARD_TABLE_PREVIEW_PROMPT_CLIPPED_TEXT_CLASS` 使用 `line-clamp`，
 * 避免在部分浏览器上把 `-webkit-box` 直接打在 `<button>` 上不稳定。
 */
export const STORYBOARD_TABLE_PREVIEW_PROMPT_BUTTON_CLASS = [
  "w-full min-w-0 text-left cursor-text",
  "hover:bg-[var(--color-divider)]/50 -m-1 p-1 rounded",
  "text-xs text-[var(--color-muted)]",
  "box-border",
].join(" ")

/**
 * 上述三列 — **内层文案**：先按列宽自动换行、保留用户换行（pre-wrap），
 * 最多 **5 行**（`line-clamp-5`），再多则末尾省略号；短文案自然只占 1～3 行。
 *
 * **高度与首尾帧列对齐**：`ShotFrameCompare` 列表 `row` 下单张缩略图为 `h-[7.5rem]`（120px），
 * 此处用 `max-h-[7.5rem]` 封顶，配合 `text-xs` + `leading-relaxed` 时整体视觉与双图行高约一致。
 */
export const STORYBOARD_TABLE_PREVIEW_PROMPT_CLIPPED_TEXT_CLASS = [
  "block w-full min-w-0 text-left leading-relaxed",
  "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
  "max-h-[7.5rem]",
  "line-clamp-5",
].join(" ")

/**
 * 时长等短文案预览：**禁止 truncate**，避免「6秒」在窄计算宽度下变成「6…」；
 * `whitespace-nowrap` + `max-w-full` 在列拉宽后整段可见。
 */
export const STORYBOARD_TABLE_PREVIEW_SHORT_CLASS = [
  "inline-block max-w-full whitespace-nowrap text-left cursor-text align-middle",
  "hover:bg-[var(--color-divider)]/50 -m-1 px-1 py-0.5 rounded",
  "text-xs text-[var(--color-muted)]",
].join(" ")

/**
 * 编辑态多行（台词 / 译文 / 提示词）：与 `ShotPromptCells` 展开编辑一致。
 */
export const STORYBOARD_TABLE_INLINE_EDIT_TEXTAREA_CLASS = [
  "p-2 text-xs border-2 border-[var(--color-primary)]",
  "bg-[var(--color-newsprint-off-white)] resize-y",
  "focus:outline-none max-w-full w-full min-w-0",
  "select-text [user-select:text] box-border",
].join(" ")

/**
 * 编辑态单行（时长秒数）：`type="text"` + `inputMode="numeric"` 时配合，避免原生 number 控件样式。
 */
export const STORYBOARD_TABLE_INLINE_EDIT_INPUT_CLASS = [
  "w-full min-w-[3rem] max-w-full",
  "px-2 py-1.5 text-xs font-mono tabular-nums text-[var(--color-ink)]",
  "border-2 border-[var(--color-primary)] bg-[var(--color-newsprint-off-white)]",
  "focus:outline-none box-border",
].join(" ")
