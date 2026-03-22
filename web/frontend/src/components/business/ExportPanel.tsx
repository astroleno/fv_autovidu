/**
 * 导出面板：粗剪 MP4（FFmpeg 拼接）与剪映草稿 ZIP（draft_info + 素材）
 *
 * 使用下拉菜单集中入口，避免工具栏按钮过多；带 padding 的容器使用 box-sizing: border-box。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, Download, Loader2, Scissors } from "lucide-react"
import { Button } from "@/components/ui"
import { useToastStore } from "@/stores"
import { exportApi } from "@/api/export"

/** 与 SettingsPage 共用：本机剪映草稿根目录备忘，导出时可选复制草稿 */
const LS_JIANYING_HINT = "fv_settings_jianying_draft_path_hint"

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
  const [busy, setBusy] = useState<"rough" | "jianying" | null>(null)
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

  const runJianyingZip = useCallback(async () => {
    setBusy("jianying")
    try {
      let draftPath: string | undefined
      try {
        const raw = localStorage.getItem(LS_JIANYING_HINT)?.trim()
        if (raw) draftPath = raw
      } catch {
        /* ignore */
      }
      const res = await exportApi.jianyingDraft({
        episodeId,
        createZip: true,
        canvasSize: "720p",
        ...(draftPath ? { draftPath } : {}),
      })
      const zip = res.data.zipPath
      if (zip) {
        pushToast(`剪映草稿 ZIP 已生成：${zip}`, "success", 6000)
        window.open(filesUrl(zip), "_blank", "noopener,noreferrer")
      } else {
        pushToast(`剪映草稿已写入目录：${res.data.draftDir}`, "success", 6000)
      }
      if (res.data.missingShots?.length) {
        pushToast(
          `以下分镜未包含（无已选视频或文件缺失）：${res.data.missingShots.join(", ")}`,
          "info",
          8000
        )
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast(`剪映导出失败：${msg}`, "error")
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
            onClick={() => void runJianyingZip()}
          >
            {busy === "jianying" ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Scissors className="w-4 h-4 shrink-0" />
            )}
            剪映草稿 ZIP
          </button>
        </div>
      )}
    </div>
  )
}
