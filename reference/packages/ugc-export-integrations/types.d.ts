/**
 * TypeScript 声明：剪映导出与 ElevenLabs STS 相关类型
 * 说明：与 manifest 的完整结构以运行时为准，此处仅列出接入常用字段。
 */

/** VEO shot 输出中参与剪映导出的最小字段 */
export interface VeoOutputExportable {
  /** 分镜 ID */
  shotId?: string;
  status: string;
  /** 已完成时指向本地相对路径（相对项目 runtime） */
  rawClip?: string;
  timelineWindow?: {
    timelineStartSec?: number;
    targetDurationSec?: number;
    sourceStartSec?: number;
    sourceEndSec?: number;
    [key: string]: unknown;
  };
  generatedDurationSec?: number;
  usableDurationSec?: number;
  dub?: unknown;
  [key: string]: unknown;
}

/** `exportDraft` 所需的 manifest 最小形态 */
export interface VeoManifestForJianyingExport {
  veoOutputs?: VeoOutputExportable[];
  draftExport?: unknown;
  [key: string]: unknown;
}

/** `jianyingDraftExportService.exportDraft` 入参 */
export interface ExportDraftOptions {
  manifest: VeoManifestForJianyingExport;
  /** 变体 runtime 根目录（与 veoShotPipelineService.getRuntimeDir 一致） */
  baseDir: string;
  /** 剪映草稿根目录（可选，将草稿复制到该路径下的 draftId 子目录） */
  draftPath?: string | null;
  /** 是否在 runtime 下额外生成 zip */
  createZip?: boolean;
}

/** `exportDraft` 返回 */
export interface ExportDraftResult {
  draftId: string;
  draftDir: string;
  stagingDir: string;
  zipPath: string | null;
  mode: string;
  targetPath: string | null;
  missingShots: string[];
  exportedAt: string;
  totalSegments: number;
  warning: string | null;
}

/** ElevenLabs STS 可选参数（与服务端 `speechToSpeech` 一致） */
export interface SpeechToSpeechOptions {
  remove_background_noise?: boolean;
  modelId?: string;
}

/** ElevenLabs STS 返回 */
export interface SpeechToSpeechResult {
  audioBuffer: Buffer;
  durationSec: number | null;
  contentType: string;
}

/** 剪映服务模块（与 server/services/jianyingDraftExportService.js 对齐） */
export interface JianyingDraftExportServiceModule {
  EXPORT_MODE: string;
  DRAFT_PLACEHOLDER: string;
  collectExportableShots: (
    manifest: VeoManifestForJianyingExport,
  ) => { exportableShots: VeoOutputExportable[]; missingShots: string[] };
  buildAudioProtocolEntry: (...args: unknown[]) => Promise<unknown>;
  exportDraft: (opts: ExportDraftOptions) => Promise<ExportDraftResult>;
}

/** ElevenLabs 服务模块（与 server/services/elevenLabsService.js 对齐） */
export interface ElevenLabsServiceModule {
  ELEVENLABS_CONFIG_ERROR: string;
  isConfigured: () => boolean;
  designVoice: (
    voiceDescription: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  createVoiceFromPreview: (
    generatedVoiceId: string,
    voiceName: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  speechToSpeech: (
    voiceId: string,
    audioBuffer: Buffer,
    options?: SpeechToSpeechOptions,
  ) => Promise<SpeechToSpeechResult>;
  textToSpeech: (
    voiceId: string,
    text: string,
    options?: Record<string, unknown>,
  ) => Promise<SpeechToSpeechResult>;
  listVoices: () => Promise<
    Array<{ voiceId: string; name: string; labels: Record<string, unknown> }>
  >;
  deleteVoice: (voiceId: string) => Promise<boolean>;
}

/** 本包入口 `index.js` 导出形状（CommonJS：`require('@ugcflow/export-integrations')`） */
export interface UgcExportIntegrations {
  INTEGRATION: { id: string; version: string; jianyingExportMode: string };
  REPO_ROOT: string;
  jianying: JianyingDraftExportServiceModule;
  elevenLabs: ElevenLabsServiceModule;
  jianyingDraftExportService: JianyingDraftExportServiceModule;
  elevenLabsService: ElevenLabsServiceModule;
}
