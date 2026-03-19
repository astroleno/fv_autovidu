/**
 * 类型定义统一导出
 */
export type {
  Episode,
  Scene,
  Shot,
  ShotStatus,
  ShotAsset,
  VideoCandidate,
  AssetType,
  VideoMode,
  TaskStatus,
} from "./episode"
export { flattenShots } from "./episode"
export type {
  PullEpisodeRequest,
  GenerateEndframeRequest,
  GenerateEndframeResponse,
  GenerateVideoRequest,
  GenerateVideoResponse,
  RegenFrameRequest,
  RegenFrameResponse,
  SelectCandidateRequest,
  ExportRoughCutRequest,
  ExportRoughCutResponse,
  TaskStatusResponse,
} from "./api"
