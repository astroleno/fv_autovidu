/**
 * API Client 基础配置
 * Axios 实例，baseURL /api，timeout 30s
 * 错误拦截器统一处理，可扩展 Toast 通知
 */
import axios, { type AxiosError } from "axios"

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
