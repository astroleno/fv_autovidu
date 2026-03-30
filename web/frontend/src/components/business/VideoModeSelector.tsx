/**
 * 批量生成视频：模式 / 模型 / 分辨率选择弹窗
 * 与 StoryboardPage 批量「生成视频」配合，确认后提交 generateApi.video
 *
 * 单镜无尾帧时由父组件传入 `firstLastFrameAllowed={false}`，禁用首尾帧选项，
 * 避免用户从「自定义参数」仍选首尾帧而落到后端报错（与产品 spec 一致）。
 *
 * `lockedMode`：锁定为单一模式时隐藏「模式」单选，用于「批量视频·首帧模式」等需在提交前
 * 显式选择模型/分辨率的场景（此前首帧批量曾硬编码 viduq2-pro-fast+720p，与 540p+turbo 预期不符）。
 */
import { useEffect, useState } from "react"
import type { VideoMode } from "@/types"
import { Dialog, Button } from "@/components/ui"
import { ReferenceImagePicker } from "./ReferenceImagePicker"

/** 仅首帧 i2v：与产品「预览试错」一致，默认推荐 viduq3-turbo + 540p（可在下拉中改选） */
const FIRST_FRAME_DEFAULT_MODEL = "viduq3-turbo"
const FIRST_FRAME_DEFAULT_RESOLUTION = "540p"

const MODEL_OPTIONS: Record<VideoMode, { value: string; label: string }[]> = {
  first_frame: [
    { value: "viduq3-turbo", label: "viduq3-turbo（默认，预览/试错）" },
    { value: "viduq2-pro-fast", label: "viduq2-pro-fast" },
    { value: "viduq2-pro", label: "viduq2-pro" },
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

export interface VideoModeSelectorInitialValue {
  mode?: VideoMode
  model?: string
  resolution?: string
  referenceAssetIds?: string[]
  isPreview?: boolean
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
  /**
   * 锁定为单一模式时隐藏「模式」fieldset，仅展示模型/分辨率（及该模式下的附加项）。
   * 例：`first_frame` 用于分镜「批量视频·首帧模式」，避免硬编码模型。
   */
  lockedMode?: VideoMode
  /** 弹窗标题；不传时由 lockedMode 推导（如批量首帧视频） */
  dialogTitle?: string
  /** 打开时回填既有选择；用于失败重试等场景 */
  initialValue?: VideoModeSelectorInitialValue
}

export function VideoModeSelector({
  open,
  onClose,
  shotCount,
  episodeAssetIds,
  onConfirm,
  firstLastFrameAllowed = true,
  lockedMode,
  dialogTitle: dialogTitleProp,
  initialValue,
}: VideoModeSelectorProps) {
  /** 默认首尾帧 + 正式档：1080p + viduq3-pro（与预览档 540p+turbo 二选一） */
  const [mode, setMode] = useState<VideoMode>("first_last_frame")
  const [model, setModel] = useState("viduq3-pro")
  const [resolution, setResolution] = useState("1080p")
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>([])
  /** 仅 first_last_frame：勾选后为预览档（540p+turbo+多候选） */
  const [previewEnabled, setPreviewEnabled] = useState(false)
  const [candidateCount, setCandidateCount] = useState(2)

  const effectiveMode: VideoMode = lockedMode ?? mode
  const models = MODEL_OPTIONS[effectiveMode]

  /** 弹窗标题：批量尾帧完成 vs 批量首帧等 */
  const dialogTitle =
    dialogTitleProp ??
    (lockedMode === "first_frame" ? "批量首帧视频" : "批量生成视频")

  useEffect(() => {
    if (!open) return

    let nextMode: VideoMode =
      lockedMode ??
      initialValue?.mode ??
      (firstLastFrameAllowed ? "first_last_frame" : "first_frame")
    if (nextMode === "first_last_frame" && !firstLastFrameAllowed) {
      nextMode = "first_frame"
    }

    const nextPreview =
      nextMode === "first_last_frame" && Boolean(initialValue?.isPreview)
    const fallbackModel =
      nextMode === "first_frame"
        ? FIRST_FRAME_DEFAULT_MODEL
        : nextMode === "reference"
          ? (MODEL_OPTIONS.reference[0]?.value ?? "viduq2-pro")
          : nextPreview
            ? "viduq3-turbo"
            : "viduq3-pro"
    const fallbackResolution =
      nextMode === "first_frame"
        ? FIRST_FRAME_DEFAULT_RESOLUTION
        : nextMode === "reference"
          ? "720p"
          : nextPreview
            ? "540p"
            : "1080p"

    setMode(nextMode)
    setPreviewEnabled(nextPreview)
    setModel(initialValue?.model ?? fallbackModel)
    setResolution(initialValue?.resolution ?? fallbackResolution)
    setReferenceAssetIds(initialValue?.referenceAssetIds ?? [])
    setCandidateCount(initialValue?.candidateCount ?? 2)
  }, [open, lockedMode, initialValue, firstLastFrameAllowed])

  const handleModeChange = (m: VideoMode) => {
    setMode(m)
    if (m === "first_last_frame") {
      setModel("viduq3-pro")
      setResolution("1080p")
      setPreviewEnabled(false)
    } else if (m === "first_frame") {
      setModel(FIRST_FRAME_DEFAULT_MODEL)
      setResolution(FIRST_FRAME_DEFAULT_RESOLUTION)
      setPreviewEnabled(false)
    } else {
      const defaultModel = MODEL_OPTIONS[m][0]?.value ?? "viduq2-pro"
      setModel(defaultModel)
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

  const handleConfirm = () => {
    if (effectiveMode === "first_last_frame" && !firstLastFrameAllowed) {
      return
    }
    const base = {
      mode: effectiveMode,
      model,
      resolution,
      referenceAssetIds:
        effectiveMode === "reference" && referenceAssetIds.length > 0
          ? referenceAssetIds
          : undefined,
    }
    if (effectiveMode === "first_last_frame" && previewEnabled) {
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
    <Dialog open={open} onClose={onClose} title={dialogTitle}>
      <div className="space-y-4 max-w-md box-border p-1">
        <p className="text-sm text-[var(--color-muted)]">
          待生成镜头数：<strong>{shotCount}</strong>
        </p>

        {!lockedMode ? (
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
        ) : (
          <p className="text-xs text-[var(--color-muted)] border border-dashed border-[var(--color-newsprint-black)] p-3 box-border">
            {lockedMode === "first_frame"
              ? "模式已固定为「仅首帧 i2v」。请在下方选择模型与分辨率后提交。"
              : "模式已固定。请在下方调整模型与分辨率（及参考资产）后提交。"}
          </p>
        )}

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

        {effectiveMode === "first_last_frame" && (
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

        {effectiveMode === "reference" && episodeAssetIds.length > 0 && (
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
            确认并提交
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
