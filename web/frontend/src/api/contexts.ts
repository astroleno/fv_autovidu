/**
 * Feeling 多上下文 API：列出环境/Profile、校验登录（走后端读 env 凭据）。
 */
import { apiClient } from "./client"

export type ContextEnvironment = {
  key: string
  label: string
  baseUrl: string
}

export type ContextProfile = {
  id: string
  label: string
  envKey: string
  enabled: boolean
}

export type ContextsListResponse = {
  environments: ContextEnvironment[]
  profiles: ContextProfile[]
  configured: boolean
}

export const contextsApi = {
  list: () => apiClient.get<ContextsListResponse>("/contexts"),
  validate: (contextId: string) =>
    apiClient.post<{ ok: boolean; contextId: string }>("/contexts/validate", {
      contextId,
    }),
}
