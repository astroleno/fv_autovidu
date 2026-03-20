/**
 * 批量生成视频：模式 / 模型 / 分辨率选择弹窗
 * 与 StoryboardPage 批量「生成视频」配合，确认后提交 generateApi.video
 */
import { useState } from "react"
import type { VideoMode } from "@/types"
import { Dialog, Button } from "@/components/ui"
import { ReferenceImagePicker } from "./ReferenceImagePicker"

const MODEL_OPTIONS: Record<VideoMode, { value: string; label: string }[]> = {
  first_frame: [
    { value: "viduq2-pro-fast", label: "viduq2-pro-fast（默认）" },
    { value: "viduq2-pro", label: "viduq2-pro" },
    { value: "viduq3-turbo", label: "viduq3-turbo" },
    { value: "viduq3-pro", label: "viduq3-pro" },
  ],
  first_last_frame: [
    { value: "viduq3-turbo", label: "viduq3-turbo（默认）" },
    { value: "viduq3-pro", label: "viduq3-pro" },
  ],
  reference: [
    { value: "viduq2-pro", label: "viduq2-pro（默认）" },
    { value: "viduq2-pro-fast", label: "viduq2-pro-fast" },
    { value: "viduq3-turbo", label: "viduq3-turbo" },
  ],
}

export interface VideoModeSelectorResult {
  mode: VideoMode
  model: string
  resolution: string
  /** reference 模式下可选：限定资产 id，空则各 shot 使用自身全部资产 */
  referenceAssetIds?: string[]
}

interface VideoModeSelectorProps {
  open: boolean
  onClose: () => void
  /** 将参与生成的 shot 数量 */
  shotCount: number
  /** 剧集级资产 id 列表（用于多参考图模式勾选） */
  episodeAssetIds: string[]
  onConfirm: (result: VideoModeSelectorResult) => void
}

export function VideoModeSelector({
  open,
  onClose,
  shotCount,
  episodeAssetIds,
  onConfirm,
}: VideoModeSelectorProps) {
  const [mode, setMode] = useState<VideoMode>("first_last_frame")
  const [model, setModel] = useState("viduq3-turbo")
  const [resolution, setResolution] = useState("720p")
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>([])

  const models = MODEL_OPTIONS[mode]

  const handleModeChange = (m: VideoMode) => {
    setMode(m)
    const defaultModel = MODEL_OPTIONS[m][0]?.value ?? "viduq2-pro-fast"
    setModel(defaultModel)
  }

  const handleConfirm = () => {
    onConfirm({
      mode,
      model,
      resolution,
      referenceAssetIds:
        mode === "reference" && referenceAssetIds.length > 0
          ? referenceAssetIds
          : undefined,
    })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} title="批量生成视频">
      <div className="space-y-4 max-w-md box-border p-1">
        <p className="text-sm text-[var(--color-muted)]">
          待生成镜头数：<strong>{shotCount}</strong>
        </p>

        <fieldset className="space-y-2 border border-[var(--color-newsprint-black)] p-3 box-border">
          <legend className="text-xs font-bold uppercase px-1">模式</legend>
          {(
            [
              ["first_frame", "仅首帧 i2v"],
              ["first_last_frame", "首尾帧双图（推荐，需已生成尾帧）"],
              ["reference", "多参考图（使用各镜头关联资产）"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex items-center gap-2 cursor-pointer text-sm"
            >
              <input
                type="radio"
                name="vid-mode"
                checked={mode === value}
                onChange={() => handleModeChange(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <div>
          <label className="block text-xs font-bold uppercase text-[var(--color-muted)] mb-1">
            模型
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--color-newsprint-black)] box-border bg-white"
          >
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-[var(--color-muted)] mb-1">
            分辨率
          </label>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--color-newsprint-black)] box-border bg-white"
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="540p">540p</option>
          </select>
        </div>

        {mode === "reference" && episodeAssetIds.length > 0 && (
          <div className="border border-dashed border-[var(--color-newsprint-black)] p-3 box-border">
            <p className="text-xs text-[var(--color-muted)] mb-2">
              可选：全局限定参考资产（不选则每个镜头使用其关联的全部资产）
            </p>
            <ReferenceImagePicker
              assetIds={episodeAssetIds}
              selectedIds={referenceAssetIds}
              onChange={setReferenceAssetIds}
              max={7}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" type="button" onClick={handleConfirm}>
            开始生成
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
