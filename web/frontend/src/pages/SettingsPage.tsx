/**
 * 设置页
 * API 地址、默认参数、数据目录
 */
import { useState } from "react"
import { Button } from "@/components/ui"

export default function SettingsPage() {
  const [apiUrl, setApiUrl] = useState("http://localhost:8000")
  const [model, setModel] = useState("viduq2-pro-fast")
  const [duration, setDuration] = useState(5)
  const [testStatus, setTestStatus] = useState<"idle" | "loading" | "ok" | "fail">("idle")

  const testConnection = async () => {
    setTestStatus("loading")
    try {
      const res = await fetch(`${apiUrl}/api/episodes`)
      setTestStatus(res.ok ? "ok" : "fail")
    } catch {
      setTestStatus("fail")
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
            className="w-full px-3 py-2 border border-[var(--color-newsprint-black)]"
          />
        </div>
      </div>
    </div>
  )
}
