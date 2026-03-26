/**
 * 批量生成视频：模式 / 模型 / 分辨率选择弹窗
 * 与 StoryboardPage 批量「生成视频」配合，确认后提交 generateApi.video
 *
 * 单镜无尾帧时由父组件传入 `firstLastFrameAllowed={false}`，禁用首尾帧选项，
 * 避免用户从「自定义参数」仍选首尾帧而落到后端报错（与产品 spec 一致）。
 */
import { useEffect, useState } from "react"
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
  /**
   * 首尾帧：产品策略为「预览 = 540p + turbo」「正式 = 1080p + pro」，避免 720p+turbo 这种折中无意义组合。
   * 与官方 Start end to Video（start-end2video）一致，见 https://platform.vidu.com/docs/start-end-to-video
   */
  first_last_frame: [
    { value: "viduq3-pro", label: "viduq3-pro（默认，正式生成）" },
    { value: "viduq3-turbo", label: "viduq3-turbo（预览推荐）" },
    { value: "viduq2-pro-fast", label: "viduq2-pro-fast" },
    { value: "viduq2-pro", label: "viduq2-pro" },
    { value: "viduq2-turbo", label: "viduq2-turbo" },
    { value: "viduq1", label: "viduq1" },
    { value: "viduq1-classic", label: "viduq1-classic" },
    { value: "vidu2.0", label: "vidu2.0" },
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
  /** 首尾帧预览：固定 540p + turbo + 每镜头多候选（与正式 1080p+pro 区分） */
  isPreview?: boolean
  /** 每镜头候选数 1~3，仅与 isPreview 同时生效 */
  candidateCount?: number
}

interface VideoModeSelectorProps {
  open: boolean
  onClose: () => void
  /** 将参与生成的 shot 数量 */
  shotCount: number
  /** 剧集级资产 id 列表（用于多参考图模式勾选） */
  episodeAssetIds: string[]
  onConfirm: (result: VideoModeSelectorResult) => void
  /**
   * 是否允许选择「首尾帧双图」模式。单镜选片且无尾帧路径时应为 false（禁用该 radio）。
   * 未传时视为 true，保持分镜批量等场景的原有默认。
   */
  firstLastFrameAllowed?: boolean
}

export function VideoModeSelector({
  open,
  onClose,
  shotCount,
  episodeAssetIds,
  onConfirm,
  firstLastFrameAllowed = true,
}: VideoModeSelectorProps) {
  /** 默认首尾帧 + 正式档：1080p + viduq3-pro（与预览档 540p+turbo 二选一） */
  const [mode, setMode] = useState<VideoMode>("first_last_frame")
  const [model, setModel] = useState("viduq3-pro")
  const [resolution, setResolution] = useState("1080p")
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>([])
  /** 仅 first_last_frame：勾选后为预览档（540p+turbo+多候选） */
  const [previewEnabled, setPreviewEnabled] = useState(false)
  const [candidateCount, setCandidateCount] = useState(2)

  const models = MODEL_OPTIONS[mode]

  const handleModeChange = (m: VideoMode) => {
    setMode(m)
    const defaultModel = MODEL_OPTIONS[m][0]?.value ?? "viduq2-pro-fast"
    setModel(defaultModel)
    if (m === "first_last_frame") {
      // 进入首尾帧：默认正式档（1080p + pro），避免与预览档混淆
      setResolution("1080p")
      setPreviewEnabled(false)
    } else {
      setPreviewEnabled(false)
    }
  }

  const handlePreviewToggle = (checked: boolean) => {
    setPreviewEnabled(checked)
    if (checked) {
      // 预览档：低成本试错，锁种后再走精出或改选 1080p+pro 正式生成
      setResolution("540p")
      setModel("viduq3-turbo")
      setCandidateCount(2)
    } else {
      // 关闭预览：回到正式档默认
      setResolution("1080p")
      setModel("viduq3-pro")
    }
  }

  /**
   * 弹窗打开且当前镜不允许首尾帧时：若内部状态仍为 first_last_frame（含初始默认值），
   * 强制切到 first_frame 并同步默认模型，避免用户未改 radio 就点「开始生成」。
   */
  useEffect(() => {
    if (!open || firstLastFrameAllowed) return
    if (mode !== "first_last_frame") return
    const dm = MODEL_OPTIONS.first_frame[0]?.value ?? "viduq2-pro-fast"
    setMode("first_frame")
    setModel(dm)
    setPreviewEnabled(false)
  }, [open, firstLastFrameAllowed, mode])

  const handleConfirm = () => {
    if (mode === "first_last_frame" && !firstLastFrameAllowed) {
      return
    }
    const base = {
      mode,
      model,
      resolution,
      referenceAssetIds:
        mode === "reference" && referenceAssetIds.length > 0
          ? referenceAssetIds
          : undefined,
    }
    if (mode === "first_last_frame" && previewEnabled) {
      onConfirm({
        ...base,
        isPreview: true,
        candidateCount: Math.min(3, Math.max(1, candidateCount)),
      })
    } else {
      onConfirm(base)
    }
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
          ).map(([value, label]) => {
            const flDisabled =
              value === "first_last_frame" && !firstLastFrameAllowed
            return (
              <label
                key={value}
                className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm ${
                  flDisabled
                    ? "opacity-60 cursor-not-allowed"
                    : "cursor-pointer"
                }`}
              >
                <input
                  type="radio"
                  name="vid-mode"
                  checked={mode === value}
                  disabled={flDisabled}
                  onChange={() => {
                    if (!flDisabled) handleModeChange(value)
                  }}
                />
                <span>{label}</span>
                {flDisabled ? (
                  <span
                    className="text-[11px] text-[var(--color-muted)] w-full pl-6 box-border"
                    style={{ boxSizing: "border-box" }}
                  >
                    当前镜头无尾帧路径，请先在分镜板或此处生成尾帧后再选此项。
                  </span>
                ) : null}
              </label>
            )
          })}
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

        {mode === "first_last_frame" && (
          <div className="border border-dashed border-[var(--color-newsprint-black)] p-3 box-border space-y-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={previewEnabled}
                onChange={(e) => handlePreviewToggle(e.target.checked)}
              />
              <span>
                预览模式（540p + turbo + 多候选；正式生成请关此项，用上方 1080p + pro）
              </span>
            </label>
            {previewEnabled && (
              <div>
                <label className="block text-xs font-bold uppercase text-[var(--color-muted)] mb-1">
                  每镜头候选数
                </label>
                <select
                  value={String(candidateCount)}
                  onChange={(e) => setCandidateCount(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-[var(--color-newsprint-black)] box-border bg-white"
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </div>
            )}
          </div>
        )}

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
