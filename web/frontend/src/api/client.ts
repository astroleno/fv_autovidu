/**
 * API Client 基础配置
 * Axios 实例，baseURL /api，默认 timeout 30s（列表/详情等快接口）
 * 拉取剧集、一键拉项目等长耗时接口请在单次请求上覆盖 timeout（见 LONG_REQUEST_TIMEOUT_MS）
 * 错误拦截器统一处理，可扩展 Toast 通知
 */
import axios, { type AxiosError } from "axios"

/** 拉取剧集 / 整项目拉取：后端同步下载多图，易超过 30s，单独使用更长超时（10 分钟） */
export const LONG_REQUEST_TIMEOUT_MS = 600_000

export const apiClient = axios.create({
  baseURL: "/api",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
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
