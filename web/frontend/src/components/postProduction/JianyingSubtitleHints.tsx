/**
 * 剪映导出 Tab 的说明文案：字幕数据来源与磁盘写入两阶段说明。
 *
 * 文案与后端 `jianying_text_track.subtitle_text_from_shot` 优先级一致，避免用户疑惑「为何是这些字」。
 */
export function JianyingSubtitleHints() {
  return (
    <div
      className="space-y-2 rounded border border-[var(--color-outline-variant)] bg-[var(--color-newsprint-off-white)]/60 p-3 text-xs leading-relaxed text-[var(--color-ink)] box-border"
      style={{ boxSizing: "border-box" }}
      data-testid="jianying-subtitle-hints"
    >
      <p className="font-bold text-[var(--color-newsprint-black)]">字幕文案从哪来</p>
      <ol className="list-decimal list-inside space-y-1 text-[var(--color-muted)]">
        <li>优先使用镜头里已填的「译文」字段（与配音目标语一致时用于烧录字幕）。</li>
        <li>若无译文，则使用平台拉取的「台词」原文。</li>
        <li>若仍无，则尝试结构化台词（角色 + 内容）。</li>
      </ol>
      <p className="font-bold text-[var(--color-newsprint-black)] pt-1">导出会写到哪里</p>
      <ul className="list-disc list-inside space-y-1 text-[var(--color-muted)]">
        <li>服务端会先在仓库数据目录下生成本次剪映草稿，再复制到你填写的「剪映草稿根目录」。</li>
        <li>导出成功后请用下方结果区路径在访达 / 资源管理器中打开；若复制失败，可仅使用仓库内草稿路径自行拷贝。</li>
      </ul>
    </div>
  )
}
