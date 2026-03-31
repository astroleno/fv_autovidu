/**
 * 剪映草稿导出成功后的结果卡：主路径可复制、展示仓库内草稿目录与统计。
 */
import { useState } from "react"
import { Button } from "@/components/ui"

export interface JianyingExportResultCardProps {
  /** 优先展示：复制到剪映目录后的绝对路径（若存在） */
  primaryPath: string
  /** 仓库内生成的草稿目录（api 返回 draftDir） */
  draftDir: string
  exportedShots: number
  exportedAt: string
}

export function JianyingExportResultCard({
  primaryPath,
  draftDir,
  exportedShots,
  exportedAt,
}: JianyingExportResultCardProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(primaryPath)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className="rounded border border-[var(--color-newsprint-black)] bg-white p-4 space-y-3 box-border"
      style={{ boxSizing: "border-box" }}
      data-testid="jianying-export-result"
    >
      <p className="text-[10px] font-black uppercase tracking-wider text-[var(--color-muted)]">
        最近一次导出
      </p>
      <div className="space-y-1">
        <p className="text-xs font-bold text-[var(--color-newsprint-black)]">剪映可打开路径（推荐）</p>
        <code className="block break-all rounded border border-[var(--color-divider)] bg-[var(--color-newsprint-off-white)] px-2 py-1.5 text-[11px] leading-snug">
          {primaryPath}
        </code>
        <Button type="button" variant="secondary" className="text-xs" onClick={() => void handleCopy()}>
          {copied ? "已复制" : "复制路径"}
        </Button>
      </div>
      <div className="space-y-1 text-[11px] text-[var(--color-muted)]">
        <p>
          <span className="font-bold text-[var(--color-newsprint-black)]">仓库内草稿：</span>
          <code className="break-all">{draftDir}</code>
        </p>
        <p>
          已导出镜头段：<strong className="text-[var(--color-ink)]">{exportedShots}</strong> · {exportedAt}
        </p>
      </div>
    </div>
  )
}
