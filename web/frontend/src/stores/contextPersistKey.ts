/**
 * Zustand persist 与 Axios 拦截器共用的 localStorage 键名。
 *
 * 单独文件避免 `api/client.ts` ↔ `useContextStore.ts` 循环依赖：
 * client 仅依赖本常量；store 在创建时引用同一常量。
 */
export const CONTEXT_PERSIST_KEY = "fv-feeling-context"
