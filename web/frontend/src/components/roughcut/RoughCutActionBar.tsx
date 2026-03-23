/**
 * 粗剪台 — 操作栏（原型：分辨率、添加音频、自动对齐、保存、导出）
 * 除导出外均为占位或后续迭代，避免误导用户已具备后端能力。
 */
import { useState } from "react"
import { Music, Wand2 } from "lucide-react"
import { ExportPanel } from "@/components/business"
import { useToastStore } from "@/stores"

export interface RoughCutActionBarProps {
  episodeId: string
  /** 无可用片段时禁用导出下拉 */
  exportDisabled?: boolean
}

/**
 * 与原型一致的横向工具条：左侧参数与辅助按钮，右侧主操作
 */
export function RoughCutActionBar({ episodeId, exportDisabled }: RoughCutActionBarProps) {
  const pushToast = useToastStore((s) => s.push)
  /** 分辨率仅作 UI 状态，实际导出分辨率由后端/FFmpeg 策略决定 */
  const [resolution, setResolution] = useState("1080p")

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-4 border border-[var(--color-newsprint-black)] border-t-0 bg-white px-4 py-3 text-[var(--color-newsprint-black)] box-border"
      style={{ boxSizing: "border-box" }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase font-mono text-[var(--color-muted)]">
            Res.
          </span>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="border border-[var(--color-newsprint-black)] bg-white px-2 py-1 text-[10px] font-bold uppercase focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] box-border"
            style={{ boxSizing: "border-box" }}
            aria-label="分辨率（展示）"
          >
            <option value="720p">720p (HD)</option>
            <option value="1080p">1080p (FHD)</option>
            <option value="4k">4K (UHD)</option>
          </select>
        </div>
        <div className="hidden h-6 w-px bg-[var(--color-newsprint-black)] sm:block" />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="flex items-center gap-1 border border-[var(--color-newsprint-black)] px-2 py-1.5 text-[10px] font-bold uppercase hover:bg-[var(--color-newsprint-black)] hover:text-white disabled:opacity-40 box-border"
            style={{ boxSizing: "border-box" }}
            disabled
            title="音轨编辑后续版本开放"
          >
            <Music className="h-3.5 w-3.5" />
            Add Audio
          </button>
          <button
            type="button"
            className="flex items-center gap-1 border border-[var(--color-newsprint-black)] px-2 py-1.5 text-[10px] font-bold uppercase hover:bg-[var(--color-newsprint-black)] hover:text-white disabled:opacity-40 box-border"
            style={{ boxSizing: "border-box" }}
            disabled
            title="对齐策略规划中"
          >
            <Wand2 className="h-3.5 w-3.5" />
            Auto Align
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="border border-[var(--color-newsprint-black)] px-3 py-2 text-[10px] font-bold uppercase hover:bg-black/5 box-border"
          style={{ boxSizing: "border-box" }}
          onClick={() =>
            pushToast("项目保存：当前以本地 episode.json 为准，云端保存后续接入", "info", 4000)
          }
        >
          Save Project
        </button>
        <ExportPanel episodeId={episodeId} disabled={exportDisabled} />
      </div>
    </section>
  )
}
