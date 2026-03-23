/**
 * 导出面板：粗剪 MP4（FFmpeg 拼接）与剪映草稿导出
 *
 * 剪映导出通过弹窗填写「本机草稿根目录」并复制到剪映；不生成 ZIP（与「整包素材下载」若需可另做独立能力）；
 * 带 padding 的容器使用 box-sizing: border-box。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, Download, Loader2, Scissors } from "lucide-react"
import { Button } from "@/components/ui"
import { useToastStore } from "@/stores"
import { exportApi } from "@/api/export"
import { JianyingExportDialog } from "./JianyingExportDialog"

export interface ExportPanelProps {
  /** 当前剧集 ID */
  episodeId: string
  /** 禁用（例如未加载完成） */
  disabled?: boolean
}

/**
 * 将后端返回的相对路径（相对 DATA_ROOT）转为可点击的静态文件 URL
 */
function filesUrl(relativeFromDataRoot: string): string {
  const p = relativeFromDataRoot.replace(/^\/+/, "")
  return `/api/files/${p}`
}

export function ExportPanel({ episodeId, disabled = false }: ExportPanelProps) {
  const pushToast = useToastStore((s) => s.push)
  const [open, setOpen] = useState(false)
  const [jianyingDialogOpen, setJianyingDialogOpen] = useState(false)
  const [busy, setBusy] = useState<"rough" | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  /** 点击外部关闭下拉 */
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const runRoughCut = useCallback(async () => {
    setBusy("rough")
    try {
      const res = await exportApi.roughCut({ episodeId })
      const path = res.data.exportPath
      pushToast(`粗剪已导出：${path}`, "success", 6000)
      window.open(filesUrl(path), "_blank", "noopener,noreferrer")
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast(`粗剪导出失败：${msg}`, "error")
    } finally {
      setBusy(null)
      setOpen(false)
    }
  }, [episodeId, pushToast])

  const busyAny = busy !== null

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <Button
        type="button"
        variant="primary"
        className="gap-2"
        disabled={disabled || busyAny}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {busyAny ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        ) : (
          <Download className="w-4 h-4 shrink-0" />
        )}
        导出
        <ChevronDown className="w-4 h-4 shrink-0 opacity-80" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 min-w-[14rem] rounded-md border border-[var(--color-newsprint-black)] bg-[var(--color-newsprint-off-white)] shadow-lg py-1"
          style={{ boxSizing: "border-box", padding: "4px" }}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-outline-variant)] disabled:opacity-50"
            style={{ boxSizing: "border-box" }}
            disabled={busyAny}
            onClick={() => void runRoughCut()}
          >
            {busy === "rough" ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Download className="w-4 h-4 shrink-0" />
            )}
            粗剪 MP4
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-outline-variant)] disabled:opacity-50"
            style={{ boxSizing: "border-box" }}
            disabled={busyAny}
            onClick={() => {
              setOpen(false)
              setJianyingDialogOpen(true)
            }}
          >
            <Scissors className="w-4 h-4 shrink-0" />
            剪映草稿导出…
          </button>
        </div>
      )}

      <JianyingExportDialog
        open={jianyingDialogOpen}
        onClose={() => setJianyingDialogOpen(false)}
        episodeId={episodeId}
      />
    </div>
  )
}
