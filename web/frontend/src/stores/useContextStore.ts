/**
 * Feeling 环境与 Profile（上下文）选择状态。
 *
 * - currentContextId 持久化到 localStorage，Axios 拦截器读同一键注入 X-FV-Context-Id；
 * - environments / profiles 来自 GET /api/contexts，应用启动或进入设置时刷新；
 * - configured === false 时表示未放置 feeling_contexts.json，前端降级为仅全局 .env（不带头）。
 */
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { contextsApi, type ContextEnvironment, type ContextProfile } from "@/api/contexts"
import { CONTEXT_PERSIST_KEY } from "./contextPersistKey"

export type { ContextEnvironment, ContextProfile }

type ContextState = {
  /** 与后端 profile key 一致；null 表示不带头（兼容旧模式） */
  currentContextId: string | null
  environments: ContextEnvironment[]
  profiles: ContextProfile[]
  configured: boolean
  contextsLoading: boolean
  contextsError: string | null

  fetchContexts: () => Promise<void>
  setContextId: (id: string | null) => void
  getProfilesForEnv: (envKey: string) => ContextProfile[]
  getCurrentProfile: () => ContextProfile | null
  getEnvironmentLabel: (envKey: string) => string
}

export const useContextStore = create<ContextState>()(
  persist(
    (set, get) => ({
      currentContextId: null,
      environments: [],
      profiles: [],
      configured: false,
      contextsLoading: false,
      contextsError: null,

      fetchContexts: async () => {
        set({ contextsLoading: true, contextsError: null })
        try {
          const { data } = await contextsApi.list()
          set({
            environments: data.environments ?? [],
            profiles: data.profiles ?? [],
            configured: Boolean(data.configured),
            contextsLoading: false,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          set({
            contextsError: msg,
            contextsLoading: false,
            environments: [],
            profiles: [],
            configured: false,
          })
        }
      },

      setContextId: (id) => {
        set({ currentContextId: id != null && String(id).trim() ? String(id).trim() : null })
      },

      getProfilesForEnv: (envKey) => {
        return get()
          .profiles.filter((p) => p.envKey === envKey && p.enabled !== false)
          .sort((a, b) => a.label.localeCompare(b.label))
      },

      getCurrentProfile: () => {
        const id = get().currentContextId
        if (!id) return null
        return get().profiles.find((p) => p.id === id) ?? null
      },

      getEnvironmentLabel: (envKey) => {
        const env = get().environments.find((e) => e.key === envKey)
        return env?.label ?? envKey
      },
    }),
    {
      name: CONTEXT_PERSIST_KEY,
      partialize: (s) => ({ currentContextId: s.currentContextId }),
    }
  )
)
