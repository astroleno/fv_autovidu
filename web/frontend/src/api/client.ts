/**
 * API Client 基础配置
 * Axios 实例，baseURL /api，默认 timeout 30s（列表/详情等快接口）
 * 拉取剧集、一键拉项目等长耗时接口请在单次请求上覆盖 timeout（见 LONG_REQUEST_TIMEOUT_MS）
 * 错误拦截器统一处理，可扩展 Toast 通知
 *
 * 请求拦截器：从 Zustand persist 的 localStorage 读取 currentContextId，注入 X-FV-Context-Id。
 * 不能直接 import useContextStore，否则会与 contextsApi 形成循环依赖。
 */
import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios"
import { CONTEXT_PERSIST_KEY } from "@/stores/contextPersistKey"

/** 拉取剧集 / 整项目拉取：后端同步下载多图，易超过 30s，单独使用更长超时（10 分钟） */
export const LONG_REQUEST_TIMEOUT_MS = 600_000

export const apiClient = axios.create({
  baseURL: "/api",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
})

/**
 * 与 zustand persist 默认序列化格式一致：{ state: { ... }, version }
 */
/**
 * 合并 baseURL 与相对 url，得到 pathname（用于判断是否为引导请求）。
 */
function combinedRequestPath(config: InternalAxiosRequestConfig): string {
  const url = config.url ?? ""
  const base = (config.baseURL ?? "").replace(/\/+$/, "")
  if (/^https?:\/\//i.test(url)) {
    try {
      return new URL(url).pathname || "/"
    } catch {
      return "/"
    }
  }
  const pathPart = url.startsWith("/") ? url : `/${url}`
  const merged = base ? `${base}${pathPart}` : pathPart
  return merged.replace(/\/{2,}/g, "/") || "/"
}

/**
 * GET/POST /api/contexts* 不得带陈旧 X-FV-Context-Id，否则中间件曾可能 400，
 * 前端无法拉到 configured: false 以清除 localStorage。
 */
function isContextsBootstrapPath(pathname: string): boolean {
  const p = (pathname || "").split("?")[0].replace(/\/+$/, "") || "/"
  if (p === "/api/contexts") return true
  return p.startsWith("/api/contexts/")
}

function readPersistedContextId(): string | null {
  try {
    const raw = localStorage.getItem(CONTEXT_PERSIST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: { currentContextId?: string | null } }
    const id = parsed?.state?.currentContextId
    if (id != null && String(id).trim()) return String(id).trim()
  } catch {
    /* 未初始化或非 JSON */
  }
  return null
}

apiClient.interceptors.request.use((config) => {
  if (isContextsBootstrapPath(combinedRequestPath(config))) {
    return config
  }
  const id = readPersistedContextId()
  if (id) {
    const h = config.headers
    if (h && typeof (h as { set?: (k: string, v: string) => void }).set === "function") {
      ;(h as { set: (k: string, v: string) => void }).set("X-FV-Context-Id", id)
    } else if (h) {
      ;(h as Record<string, string>)["X-FV-Context-Id"] = id
    }
  }
  return config
})

// 响应拦截器：统一错误处理
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const message =
      error.response?.data && typeof error.response.data === "object" && "detail" in error.response.data
        ? String((error.response.data as { detail?: unknown }).detail)
        : error.message || "网络请求失败"
    console.error("[API Error]", error.config?.url, message)
    return Promise.reject(new Error(message))
  }
)
