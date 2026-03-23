/**
 * 剪映草稿导出 — 弹窗表单（精简版）
 *
 * 职责：
 * - 仅收集「本机剪映草稿根目录」draftPath，后端将草稿复制到 `{draftPath}/{draftId}/`
 * - 打开时拉取侦测路径；输入框为空则自动填入侦测结果
 * - 导出成功后**始终**将路径写入 localStorage（与设置页共用键），不再提供「记住」开关
 *
 * 明确不包含：
 * - **ZIP**：与「复制到剪映目录」语义重复；若未来需要「打包下载全部素材」应单独做导出能力
 * - **画布选择**：由服务端默认 `canvasSize=1080p` 写入 draft_info；竖屏 9:16 等需在协议层迭代
 */
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Dialog } from "@/components/ui/Dialog"
import { Button } from "@/components/ui"
import { exportApi } from "@/api/export"
import { useToastStore } from "@/stores"
/** 与 SettingsPage、ExportPanel 共用键名 */
export const LS_JIANYING_DRAFT_PATH = "fv_settings_jianying_draft_path_hint"

export interface JianyingExportDialogProps {
  open: boolean
  onClose: () => void
  episodeId: string
}

export function JianyingExportDialog({ open, onClose, episodeId }: JianyingExportDialogProps) {
  const pushToast = useToastStore((s) => s.push)
  const [draftPath, setDraftPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<string[]>([])
  const [detectedPath, setDetectedPath] = useState<string | null>(null)

  /** 打开时：从本地恢复路径 + 拉取服务端侦测目录 */
  useEffect(() => {
    if (!open) return
    try {
      const raw = localStorage.getItem(LS_JIANYING_DRAFT_PATH)?.trim()
      if (raw) setDraftPath(raw)
    } catch {
      /* ignore */
    }
    let cancelled = false
    void exportApi
      .jianyingDraftPathHints()
      .then((res) => {
        if (cancelled) return
        setDetectedPath(res.data.detectedPath ?? null)
        setCandidates(res.data.candidates ?? [])
      })
      .catch(() => {
        if (!cancelled) setCandidates([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  /** 侦测返回后：若输入仍为空则填入侦测路径 */
  useEffect(() => {
    if (!open || !detectedPath) return
    setDraftPath((prev) => {
      const t = prev.trim()
      return t ? prev : detectedPath
    })
  }, [open, detectedPath])

  const applyCandidate = useCallback((p: string) => {
    setDraftPath(p)
  }, [])

  const handleSubmit = useCallback(async () => {
    const pathTrim = draftPath.trim()
    if (!pathTrim) {
      pushToast("请填写剪映草稿根目录，或使用本机侦测路径", "error")
      return
    }
    setBusy(true)
    try {
      try {
        localStorage.setItem(LS_JIANYING_DRAFT_PATH, pathTrim)
      } catch {
        /* ignore */
      }
      const res = await exportApi.jianyingDraft({
        episodeId,
        draftPath: pathTrim,
      })
      const data = res.data
      if (data.jianyingCopyPath) {
        pushToast(`剪映草稿已复制到：${data.jianyingCopyPath}`, "success", 10_000)
      } else {
        pushToast(`草稿已写入数据目录：${data.draftDir}`, "success", 8000)
      }
      if (data.missingShots?.length) {
        const n = data.missingShots.length
        pushToast(
          `另有 ${n} 个镜头未含入本次导出（无已落盘视频或文件缺失）。请在分镜中完成出片后再导出。`,
          "info",
          8000
        )
      }
      onClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast(`剪映导出失败：${msg}`, "error")
    } finally {
      setBusy(false)
    }
  }, [draftPath, episodeId, onClose, pushToast])

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} title="剪映草稿导出">
      <div className="space-y-4 text-sm text-[var(--color-ink)]">
        <p className="text-xs leading-relaxed text-[var(--color-muted)]">
          与后端<strong>同机</strong>时填写下方目录（可用侦测结果）。导出将草稿文件夹复制到该路径下的新草稿 ID 子目录，在剪映中打开即可。
          本流程<strong>不生成 ZIP</strong>；若需「整包素材下载」可后续单独做导出能力。
        </p>

        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase text-[var(--color-muted)]">
            剪映草稿根目录
          </label>
          <input
            type="text"
            value={draftPath}
            onChange={(e) => setDraftPath(e.target.value)}
            placeholder="例如：…/Movies/JianyingPro/User Data/Projects/com.lveditor.draft"
            className="w-full border border-[var(--color-newsprint-black)] px-3 py-2 font-mono text-xs box-border"
            style={{ boxSizing: "border-box" }}
            disabled={busy}
            autoComplete="off"
          />
          {(detectedPath || candidates.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {detectedPath ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => applyCandidate(detectedPath)}
                  className="max-w-full truncate border border-[var(--color-newsprint-black)] bg-[var(--color-outline-variant)] px-2 py-0.5 text-[10px] font-mono box-border hover:bg-[var(--color-primary)] hover:text-white"
                  style={{ boxSizing: "border-box" }}
                  title={detectedPath}
                >
                  使用本机侦测路径
                </button>
              ) : null}
              {candidates
                .filter((c) => c !== detectedPath)
                .map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={busy}
                    onClick={() => applyCandidate(c)}
                    className="max-w-[200px] truncate border border-[var(--color-newsprint-black)] px-2 py-0.5 text-[10px] font-mono box-border hover:bg-[var(--color-outline-variant)]"
                    style={{ boxSizing: "border-box" }}
                    title={c}
                  >
                    {c}
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-outline-variant)] pt-4">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void handleSubmit()}>
            {busy ? (
              <>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                导出中…
              </>
            ) : (
              "开始导出"
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
