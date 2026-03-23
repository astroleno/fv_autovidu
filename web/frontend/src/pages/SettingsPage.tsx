/**
 * 设置页
 * API 地址、默认参数、剪映路径提示、ElevenLabs 连接测试
 */
import { useEffect, useState } from "react"
import { Button } from "@/components/ui"
import { dubApi } from "@/api/dub"
import { LS_JIANYING_DRAFT_PATH } from "@/components/business"

export default function SettingsPage() {
  const [apiUrl, setApiUrl] = useState("http://localhost:8000")
  const [model, setModel] = useState("viduq2-pro-fast")
  const [duration, setDuration] = useState(5)
  const [testStatus, setTestStatus] = useState<"idle" | "loading" | "ok" | "fail">("idle")
  /** 剪映草稿目录：仅存本地提示，导出时可在后续版本传给 draftPath */
  const [jianyingPathHint, setJianyingPathHint] = useState("")
  const [elTest, setElTest] = useState<"idle" | "loading" | "ok" | "fail">("idle")

  useEffect(() => {
    try {
      const s = localStorage.getItem(LS_JIANYING_DRAFT_PATH)
      if (s) setJianyingPathHint(s)
    } catch {
      /* ignore */
    }
  }, [])

  const persistJianyingHint = (v: string) => {
    setJianyingPathHint(v)
    try {
      localStorage.setItem(LS_JIANYING_DRAFT_PATH, v)
    } catch {
      /* ignore */
    }
  }

  const testConnection = async () => {
    setTestStatus("loading")
    try {
      const res = await fetch(`${apiUrl}/api/episodes`)
      setTestStatus(res.ok ? "ok" : "fail")
    } catch {
      setTestStatus("fail")
    }
  }

  const testElevenLabs = async () => {
    setElTest("loading")
    try {
      const cfg = await dubApi.configured()
      if (!cfg.data.configured) {
        setElTest("fail")
        return
      }
      await dubApi.voices()
      setElTest("ok")
    } catch {
      setElTest("fail")
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-4xl font-extrabold uppercase tracking-tighter text-[var(--color-newsprint-black)] mb-10 font-headline">设置</h1>
      <div className="space-y-6">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider mb-1">API 地址</label>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--color-newsprint-black)]"
          />
          <div className="flex items-center gap-2 mt-2">
            <Button variant="secondary" onClick={testConnection} disabled={testStatus === "loading"}>
              {testStatus === "loading" ? "测试中..." : "测试连接"}
            </Button>
            {testStatus === "ok" && <span className="text-green-600 text-sm">连接成功</span>}
            {testStatus === "fail" && <span className="text-red-600 text-sm">连接失败</span>}
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider mb-1">默认视频模型</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--color-newsprint-black)]"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-wider mb-1">默认时长（秒）</label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full px-3 py-2 border border-[var(--color-newsprint-black)] box-border"
          />
        </div>

        <div
          className="border border-dashed border-[var(--color-newsprint-black)] p-4 rounded-md box-border"
        >
          <h2 className="text-sm font-black uppercase tracking-wider mb-2">剪映草稿目录（可选）</h2>
          <p className="text-xs text-[var(--color-muted)] mb-2">
            与粗剪页「剪映草稿导出」弹窗共用；导出成功后会自动写回此处，打开弹窗时也会预填。
          </p>
          <input
            type="text"
            value={jianyingPathHint}
            onChange={(e) => persistJianyingHint(e.target.value)}
            placeholder="/Movies/JianyingPro/User Data/Projects"
            className="w-full px-3 py-2 border border-[var(--color-newsprint-black)] box-border text-sm"
          />
        </div>

        <div
          className="border border-dashed border-[var(--color-newsprint-black)] p-4 rounded-md box-border"
        >
          <h2 className="text-sm font-black uppercase tracking-wider mb-2">ElevenLabs 配音</h2>
          <p className="text-xs text-[var(--color-muted)] mb-2">
            API Key 需在项目根目录 <code className="font-mono">.env</code> 中配置{" "}
            <code className="font-mono">ELEVENLABS_API_KEY</code> 并重启后端，无法仅通过前端写入。
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => void testElevenLabs()}
              disabled={elTest === "loading"}
            >
              {elTest === "loading" ? "测试中…" : "测试连接 / 拉取音色"}
            </Button>
            {elTest === "ok" && (
              <span className="text-green-600 text-sm">可连接</span>
            )}
            {elTest === "fail" && (
              <span className="text-red-600 text-sm">失败或未配置</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
