# 前端生成 Prompt

> 直接复制下方内容，粘贴到 AI 代码生成工具中使用。

---

## Prompt

```
帮我创建一个 AI 视频制作工作站的前端项目。

## 技术栈

- React 19 + TypeScript
- Vite
- Tailwind CSS 4
- React Router v7（文件路由）
- Zustand（状态管理）
- Lucide React（图标）
- Framer Motion（动画）

## 设计规范

### 主题色配色
- 主色：#168866（翡翠绿）
- 主色浅：#1da87e（hover 态）
- 主色深：#0f6b50（active 态）
- 主色极浅：#e6f5ef（背景色/Tag背景）
- 强调色：#f59e0b（警告/待处理状态，琥珀色）
- 错误色：#ef4444
- 成功色：#168866（复用主色）
- 背景色：#f8fafb（全局页面底）
- 卡片背景：#ffffff
- 文字主色：#1a1a2e
- 文字次要：#6b7280
- 边框色：#e5e7eb
- 分割线：#f0f0f0

### 设计风格
- 现代简洁的 Dashboard 风格，类似 Linear / Notion
- 圆角统一 8px（卡片 12px）
- 阴影使用 `shadow-sm`，hover 时 `shadow-md`
- 间距系统：4px 基准，常用 8/12/16/24/32
- 字体：系统字体栈，中文优先 "PingFang SC", "Microsoft YaHei"
- 所有交互有 hover/active 状态，transition 200ms
- 空状态都要有插画/图标 + 文字引导

## 项目定位

这是一个 **AI 视频分镜制作本地工作站**。用户在云端平台完成剧本分析、资产管理、分镜板出图后，数据被拉取到本地。本前端连接本地 Python FastAPI 后台（http://localhost:8000），完成后续的视频制作工作：

1. 查看已拉取的分镜数据（首帧图 + prompt + 资产）
2. 批量生成尾帧图（首帧 + prompt + 资产 → AI 生成）
3. 批量生成视频（首帧/首尾帧 → Vidu AI 生成 5s 视频）
4. 单帧带资产重新生成（对不满意的首帧，修改 prompt + 选择资产 → 重新生成）
5. 多候选视频对比选择
6. 视频粗剪拼接导出

## 数据结构

后台数据基于一个核心 JSON 文件 `episode.json`，结构如下：

```typescript
interface Episode {
  projectId: string;
  episodeId: string;
  episodeTitle: string;        // "第2集"
  episodeNumber: number;
  pulledAt: string;            // ISO 时间
  scenes: Scene[];
}

interface Scene {
  sceneId: string;
  sceneNumber: number;
  title: string;               // "废弃仓库外"
  shots: Shot[];
}

interface Shot {
  shotId: string;
  shotNumber: number;          // 全局编号，1-based
  imagePrompt: string;         // 画面描述 prompt
  videoPrompt: string;         // 视频动作 prompt
  duration: number;            // 视频时长秒数
  cameraMovement: string;      // push_in / pull_out / pan_left 等
  aspectRatio: string;         // "9:16" / "16:9"
  firstFrame: string;          // 本地路径 "frames/S01.png"
  assets: ShotAsset[];         // 关联的资产
  status: ShotStatus;
  endFrame: string | null;     // 本地路径 "endframes/S01_end.png"
  videoCandidates: VideoCandidate[];
}

type ShotStatus = 
  | "pending"         // 刚拉取，未开始
  | "endframe_generating"  // 尾帧生成中
  | "endframe_done"   // 尾帧已生成
  | "video_generating" // 视频生成中
  | "video_done"      // 视频已生成（有候选）
  | "selected"        // 已选定最终视频
  | "error";          // 出错

interface ShotAsset {
  assetId: string;
  name: string;                // "达里尔"
  type: "character" | "location" | "prop" | "other";
  localPath: string;           // "assets/达里尔.png"
  prompt: string;              // 资产描述文本
}

interface VideoCandidate {
  id: string;
  videoPath: string;           // "videos/S01/v1.mp4"
  thumbnailPath: string;       // "videos/S01/v1_thumb.jpg"
  seed: number;
  model: string;               // "viduq2-pro-fast"
  mode: "first_frame" | "first_last_frame" | "reference";
  selected: boolean;
  createdAt: string;
  taskId: string;              // Vidu 任务 ID
  taskStatus: "pending" | "processing" | "success" | "failed";
}
```

## 后台 API 接口

前端连接 `http://localhost:8000`，以下是需要对接的接口：

### Episode 管理
```
GET    /api/episodes                    → Episode[]      # 列出所有本地 episode
GET    /api/episodes/:episodeId         → Episode        # 获取单个 episode 完整数据
POST   /api/episodes/pull               → Episode        # 触发从平台拉取
       Body: { episodeId: string }
```

### Shot 操作
```
GET    /api/episodes/:episodeId/shots               → Shot[]    # 获取 shot 列表
GET    /api/episodes/:episodeId/shots/:shotId       → Shot      # 获取单个 shot
PATCH  /api/episodes/:episodeId/shots/:shotId       → Shot      # 更新 shot（改 prompt 等）
       Body: Partial<Shot>
```

### 生成操作
```
POST   /api/generate/endframe           → { taskId, shotId }
       Body: { episodeId, shotIds: string[] }     # 批量生成尾帧

POST   /api/generate/video              → { tasks: [{taskId, shotId}] }
       Body: { 
         episodeId, 
         shotIds: string[],
         mode: "first_frame" | "first_last_frame" | "reference",
         model?: string,
         duration?: number 
       }

POST   /api/generate/regen-frame        → { taskId, shotId, newFramePath }
       Body: { 
         episodeId, 
         shotId: string,
         imagePrompt: string,          # 修改后的 prompt
         assetIds: string[]            # 选中的资产 ID
       }
```

### 任务状态
```
GET    /api/tasks/:taskId               → TaskStatus
GET    /api/tasks/batch?ids=a,b,c       → TaskStatus[]   # 批量查询
```

### 选择 & 导出
```
POST   /api/shots/:shotId/select        → Shot
       Body: { candidateId: string }   # 选定某个候选视频

POST   /api/export/rough-cut            → { exportPath }
       Body: { episodeId, shotIds?: string[] }  # 按顺序拼接导出
```

### 静态文件
```
GET    /api/files/:path*                → 文件内容       # 访问本地图片/视频文件
       例: /api/files/frames/S01.png
       例: /api/files/videos/S01/v1.mp4
```

## 页面结构

### 布局
- 左侧固定侧边栏（240px宽，可折叠到 64px）
  - 顶部：Logo + 项目名 "FV Studio"
  - 导航项：Episode 列表（带数量 badge）、设置
  - 底部：系统状态指示（后台连接状态、正在运行的任务数）
- 右侧主内容区，顶部有面包屑导航

### 页面 1：Episode 列表页（/）
- 卡片网格展示所有已拉取的 Episode
- 每张卡片显示：
  - Episode 标题 + 编号
  - Shot 总数
  - 进度条（pending / endframe_done / video_done / selected 各阶段占比）
  - 拉取时间
  - 点击进入详情
- 右上角按钮：「从平台拉取新 Episode」（弹出 dialog 输入 episodeId）

### 页面 2：分镜板总览（/episode/:id）⭐ 核心页面
- 顶部信息栏：Episode 标题、Shot 总数、各状态统计
- 顶部操作栏：
  - 筛选：按状态筛选 Shot（全部 / 待处理 / 尾帧完成 / 视频完成 / 已选定）
  - 批量操作按钮组：
    - 「批量生成尾帧」（对所有 pending 的 shot）
    - 「批量生成视频」（对所有 endframe_done 的 shot）
    - 「导出粗剪」
  - 视图切换：网格视图 / 列表视图
- 按 Scene 分组展示，每个 Scene 是一个可折叠区块，标题显示场景名

#### Shot 卡片（网格视图，每行 3-5 个自适应）
```
┌─────────────────────────┐
│ S01  ▪ push_in  ▪ 5s    │  ← Shot 编号 + 运镜 + 时长
├─────────────────────────┤
│                         │
│   [首帧图 缩略图]        │  ← 点击可放大预览
│                         │
├─────────────────────────┤
│ 尾帧: [缩略图] / ⏳生成中 │  ← 尾帧状态
├─────────────────────────┤
│ 视频: ▶ v1  ▶ v2  ✓v3  │  ← 视频候选列表，✓ 表示选中
├─────────────────────────┤
│ 资产: 👤达里尔 🏠废弃仓库  │  ← 关联资产 tag
├─────────────────────────┤
│ [重生] [生成尾帧] [出视频] │  ← 操作按钮
└─────────────────────────┘
```

- 卡片左上角有状态色标：
  - pending = 灰色
  - endframe_generating / video_generating = 主色 + 脉冲动画
  - endframe_done = 主色浅
  - video_done = 琥珀色（待选择）
  - selected = 主色 + 勾号
  - error = 红色

#### Shot 行（列表视图）
- 表格形式：编号 | 首帧缩略 | 尾帧缩略 | 状态 | prompt 摘要 | 资产 | 视频候选数 | 操作

### 页面 3：Shot 详情 / 视频对比（/episode/:id/shot/:shotId）
- 左侧面板（40%宽）：
  - 首帧大图 + 尾帧大图（上下排列或左右并排切换）
  - Image Prompt 文本（可展开全文）
  - Video Prompt 文本（可展开全文）
  - 关联资产列表（带缩略图）
  - 镜头信息：运镜类型、时长、画幅比
- 右侧面板（60%宽）：
  - 视频候选列表，每个候选是一张卡片：
    - 视频播放器（内嵌）
    - 下方显示：模型名 / seed / 生成模式 / 生成时间
    - 「选定」按钮（选中后高亮主色边框）
  - 底部操作：
    - 「生成新视频」按钮（弹出配置面板：选择模式/模型/时长）
    - 「重新生成尾帧」按钮
- 上方切换到前/后 Shot 的导航箭头

### 页面 4：单帧重生（/episode/:id/shot/:shotId/regen）
- 或作为 Shot 详情页的 Modal/Drawer
- 布局：
  - 左列：当前首帧大图
  - 中列：
    - Image Prompt 文本编辑器（textarea，可修改）
    - 资产选择：复选框列表，显示该 Episode 所有资产，带缩略图，可勾选/取消
    - 「生成新首帧」主按钮（#168866）
  - 右列：生成的候选首帧图（可能有多个）
    - 每个候选下方有「采用此图」按钮
    - 采用后弹出确认："采用新首帧后，该 Shot 的尾帧和视频将被清除，需要重新生成。确认？"

### 页面 5：粗剪时间线（/episode/:id/timeline）
- 顶部预览播放器（拼接后的完整视频预览）
- 下方时间线：
  - 按 Scene 分组的横向时间轴
  - 每个 Shot 是时间线上的一个色块，宽度按 duration 比例
  - 色块内显示 Shot 编号 + 缩略图
  - 可拖拽调整顺序
  - 未选定视频的 Shot 显示为灰色虚线框
- 底部操作：
  - 「导出 MP4」按钮
  - 导出配置：分辨率选择、是否加转场

### 页面 6：设置（/settings）
- 后台连接配置（API 地址，默认 http://localhost:8000）
- 默认视频生成参数：模型、时长、分辨率
- 尾帧生成参数：yunwu 模型、图片尺寸
- 数据目录路径显示

## 组件规范

### 通用组件
- Button：主要按钮（#168866 背景白字）、次要按钮（白底#168866描边）、危险按钮（红色）、Ghost 按钮
- Badge：状态 badge，圆角全圆，5 种颜色对应 5 种状态
- Card：白底卡片，`rounded-xl shadow-sm hover:shadow-md transition`
- Dialog/Modal：居中弹出，遮罩层 `bg-black/40 backdrop-blur-sm`
- Toast：右上角通知，成功/错误/信息三种
- Tooltip：鼠标悬停提示
- Progress：线性进度条，带百分比文字
- Skeleton：加载骨架屏
- Empty State：空状态插画 + 引导文字 + CTA 按钮

### 业务组件
- ShotCard：Shot 卡片（分镜板用）
- ShotRow：Shot 行（列表视图用）
- VideoPlayer：视频播放器（支持 .mp4，带播放/暂停/进度条/全屏）
- ImagePreview：图片预览（点击放大 lightbox，支持首帧/尾帧/资产图）
- PromptEditor：Prompt 编辑 textarea，带字数统计
- AssetTag：资产标签（带图标区分 character/location/prop + 名字）
- AssetSelector：资产多选列表（带缩略图 + 复选框）
- StatusIndicator：状态指示灯（小圆点 + 脉冲动画）
- SceneGroup：Scene 折叠分组容器
- TimelineTrack：时间线轨道
- TimelineClip：时间线片段（可拖拽）

## 其他要求

1. 所有页面支持响应式，最小宽度 1024px，最大自适应
2. 图片/视频通过后台 `/api/files/` 代理访问本地文件，不要使用 file:// 协议
3. 长列表使用虚拟滚动（50+ Shot 时）
4. 视频播放器要轻量，不要引入重依赖，用 HTML5 <video> 标签即可
5. 支持键盘快捷键：
   - 分镜板页：← → 切换 Shot，Enter 进入详情，Space 播放视频
   - Shot 详情页：1-9 数字键快速选定候选，← → 切换 Shot
6. 所有异步操作要有 loading 状态和错误处理
7. 生成类操作（尾帧/视频）提交后，前端轮询任务状态（每 3 秒），状态更新后自动刷新对应 Shot 卡片
8. 项目名叫 "FV Studio"，侧边栏 Logo 用文字 logo 即可
9. 中文界面
```

---

## 补充说明

以上 Prompt 可以直接粘贴到 Cursor / v0 / Bolt 等 AI 工具中生成前端代码。生成后需要：

1. 配置 `vite.config.ts` 的 proxy，将 `/api` 代理到 `http://localhost:8000`
2. 后台的静态文件服务（`/api/files/`）需要挂载本地 `data/` 目录
3. 如果后台还没开发，可以先用 mock 数据跑前端
