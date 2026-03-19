/**
 * SceneGroup Scene 折叠分组容器
 * 可折叠/展开，children 为 Shot 列表（网格或表格）
 */
import { useState } from "react"
import type { Scene } from "@/types"
import { ChevronDown, ChevronRight } from "lucide-react"

interface SceneGroupProps {
  scene: Scene
  children: React.ReactNode
}

export function SceneGroup({ scene, children }: SceneGroupProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="mb-12">
      <div
        className="flex items-center justify-between py-4 border-b-2 border-[var(--color-border)] mb-6 cursor-pointer"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-4">
          {collapsed ? (
            <ChevronRight className="w-5 h-5 text-[var(--color-muted)]" />
          ) : (
            <ChevronDown className="w-5 h-5 text-[var(--color-muted)]" />
          )}
          <h3 className="text-xl font-bold text-[var(--color-ink)]">
            Scene {scene.sceneNumber}: {scene.title}
          </h3>
          <span className="px-2 py-0.5 border border-[var(--color-newsprint-black)] text-[10px] font-black uppercase tracking-wider text-[var(--color-muted)]">
            {scene.shots.length} Shots
          </span>
        </div>
      </div>
      {!collapsed && children}
    </div>
  )
}
