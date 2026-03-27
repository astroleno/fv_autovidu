/**
 * 设置页 — Feeling 多环境与 Profile 区块。
 *
 * 行为说明：
 * - 从 useContextStore 读取/写入 currentContextId，与 Axios 拦截器、静态文件 basePath 一致；
 * - 环境下拉框决定可选 Profile 列表；
 * - 「验证登录」调用 POST /api/contexts/validate，成功后表明当前 Profile 的 env 凭据可登录平台；
 * - 若后端返回 configured: false，整块降级为提示「仅 .env」，不强制用户选择 Profile。
 */
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui"
import { contextsApi } from "@/api/contexts"
import { useContextStore } from "@/stores"

export function FeelingContextSection() {
  const {
    environments,
    profiles,
    configured,
    contextsLoading,
    contextsError,
    currentContextId,
    fetchContexts,
    setContextId,
    getProfilesForEnv,
  } = useContextStore()

  /** 当前选中的环境键（dev / prod / …），用于筛选 Profile 下拉框 */
  const [envKey, setEnvKey] = useState<string>("")
  /** 校验接口状态 */
  const [validateState, setValidateState] = useState<"idle" | "loading" | "ok" | "fail">("idle")
  const [validateMsg, setValidateMsg] = useState<string>("")

  useEffect(() => {
    void fetchContexts()
  }, [fetchContexts])

  /**
   * 环境与持久化 Profile 对齐：
   * - 若已选 currentContextId，环境下拉框须是该 profile 的 envKey（避免 UI 显示 dev 但实际请求仍带 prod Profile）；
   * - 未选 Profile 时，仅在 envKey 仍为空时默认第一个环境。
   */
  useEffect(() => {
    if (currentContextId) {
      const p = profiles.find((x) => x.id === currentContextId)
      if (p && environments.some((e) => e.key === p.envKey)) {
        setEnvKey(p.envKey)
      } else if (environments.length > 0) {
        setEnvKey((prev) => prev || environments[0].key)
      }
      return
    }
    setEnvKey((prev) => {
      if (prev !== "") return prev
      return environments[0]?.key ?? ""
    })
  }, [environments, profiles, currentContextId])

  const filteredProfiles = useMemo(() => {
    if (!envKey) return []
    return getProfilesForEnv(envKey)
  }, [envKey, getProfilesForEnv, profiles])

  const currentProfileLabel = useMemo(() => {
    if (!currentContextId) return ""
    const p = profiles.find((x) => x.id === currentContextId)
    return p?.label ?? currentContextId
  }, [currentContextId, profiles])

  const runValidate = async () => {
    if (!currentContextId) {
      setValidateState("fail")
      setValidateMsg("请先选择 Profile")
      return
    }
    setValidateState("loading")
    setValidateMsg("")
    try {
      await contextsApi.validate(currentContextId)
      setValidateState("ok")
      setValidateMsg("登录校验通过")
    } catch (e) {
      setValidateState("fail")
      setValidateMsg(e instanceof Error ? e.message : String(e))
    }
  }

  if (contextsLoading && !configured && environments.length === 0) {
    return (
      <div className="border border-dashed border-[var(--color-newsprint-black)] p-4 rounded-md box-border">
        <p className="text-xs text-[var(--color-muted)]">正在检测多上下文配置…</p>
      </div>
    )
  }

  if (!configured) {
    return (
      <div
        className="border border-dashed border-[var(--color-newsprint-black)] p-4 rounded-md box-border"
      >
        <h2 className="text-sm font-black uppercase tracking-wider mb-2">Feeling 环境与账号</h2>
        <p className="text-xs text-[var(--color-muted)] mb-2">
          后端未检测到 <code className="font-mono">config/feeling_contexts.json</code>
          。Windows 打包版请确认文件位于 <strong>exe 同级的</strong>
          <code className="font-mono">config/feeling_contexts.json</code>
          ，或 <code className="font-mono">_internal/config/</code> 下，且扩展名为{" "}
          <code className="font-mono">.json</code>。
          当前为<strong>全局 .env</strong>模式（与多 Profile 无关）：<code className="font-mono">.env</code>{" "}
          会照常加载，请求不携带 <code className="font-mono">X-FV-Context-Id</code>
          ，数据目录为扁平 <code className="font-mono">DATA_ROOT/项目/剧集</code>。
        </p>
        {contextsError ? (
          <p className="text-xs text-red-600">加载失败：{contextsError}</p>
        ) : null}
        <Button type="button" variant="secondary" className="mt-2" onClick={() => void fetchContexts()}>
          重新检测
        </Button>
      </div>
    )
  }

  return (
    <div
      className="border border-dashed border-[var(--color-newsprint-black)] p-4 rounded-md box-border space-y-4"
    >
      <h2 className="text-sm font-black uppercase tracking-wider">Feeling 环境与账号</h2>
      <p className="text-xs text-[var(--color-muted)]">
        选择 Profile 后，所有 API 请求会携带上下文头，数据与任务会与该工作空间隔离。生产环境 Profile 请在顶栏留意红色标识。
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider mb-1">环境</label>
          <select
            value={envKey}
            onChange={(e) => setEnvKey(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--color-newsprint-black)] bg-white text-sm box-border"
          >
            {environments.map((env) => (
              <option key={env.key} value={env.key}>
                {env.label} ({env.key})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider mb-1">Profile</label>
          <select
            value={currentContextId ?? ""}
            onChange={(e) => {
              const v = e.target.value
              setContextId(v || null)
            }}
            className="w-full px-3 py-2 border border-[var(--color-newsprint-black)] bg-white text-sm box-border"
          >
            <option value="">（不指定 · 等同旧版）</option>
            {filteredProfiles.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.enabled}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => void runValidate()} disabled={validateState === "loading"}>
          {validateState === "loading" ? "验证中…" : "验证登录"}
        </Button>
        {currentProfileLabel ? (
          <span className="text-xs text-[var(--color-muted)]">
            当前：<strong>{currentProfileLabel}</strong>
          </span>
        ) : (
          <span className="text-xs text-amber-800">未选择 Profile（请求不带头）</span>
        )}
      </div>
      {validateState === "ok" ? <span className="text-green-600 text-sm">{validateMsg}</span> : null}
      {validateState === "fail" ? <span className="text-red-600 text-sm">{validateMsg}</span> : null}
    </div>
  )
}
