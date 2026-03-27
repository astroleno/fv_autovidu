/**
 * ShotDialogueInjectCell — 分镜表单列：是否将台词拼入 **Vidu 视频生成** 的 composed prompt。
 *
 * - **默认开启**（与后端 `includeDialogueInVideoPrompt` 默认 true 一致）。
 * - **关闭**时：仍保留 `dialogue` / `dialogueTranslation` 供字幕、配音、剪映等；仅生成视频时不追加 `[Dialogue …]` 块。
 * - 不修改 `videoPrompt` 字段，只 PATCH 布尔开关。
 */
import type { Shot } from "@/types"

export interface ShotDialogueInjectCellProps {
  shot: Shot
  episodeId: string
  updateShot: (
    episodeId: string,
    shotId: string,
    updates: Partial<Pick<Shot, "includeDialogueInVideoPrompt">>
  ) => Promise<void>
}

/** 未写入 episode.json 的旧数据视为 true */
function effectiveInclude(shot: Shot): boolean {
  return shot.includeDialogueInVideoPrompt !== false
}

export function ShotDialogueInjectCell({
  shot,
  episodeId,
  updateShot,
}: ShotDialogueInjectCellProps) {
  const checked = effectiveInclude(shot)

  return (
    <td
      className="py-3 px-2 align-top min-w-0 box-border text-center"
      style={{ boxSizing: "border-box" }}
    >
      <label className="inline-flex flex-col items-center gap-1 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={async (e) => {
            const next = e.target.checked
            if (next === checked) return
            await updateShot(episodeId, shot.shotId, {
              includeDialogueInVideoPrompt: next,
            })
          }}
          className="h-4 w-4 accent-[var(--color-primary)] cursor-pointer"
          aria-label={`镜头${shot.shotNumber}：生成视频时注入台词到 Vidu 提示词`}
        />
        <span className="text-[9px] font-bold uppercase text-[var(--color-muted)] leading-tight max-w-[52px]">
          视频含台词
        </span>
      </label>
    </td>
  )
}
