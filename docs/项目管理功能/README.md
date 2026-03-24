# 项目（Project）管理功能 — 可落地实施文档

> 目标：在 FV Studio Web 端建立稳定的 **项目 -> 剧集 -> 分镜** 三级结构，并尽量复用现有本地数据模型、拉取脚本和分镜页面，避免为了“概念完整”重写已有能力。

---

## 1. 结论

该功能 **可做，且适合当前仓库**，但应按“最小可落地版本”推进，而不是一次性做成完整项目管理平台。

建议首版只做以下能力：

1. 首页改为项目列表。
2. 新增项目详情页，展示该项目下的远端剧集与本地拉取状态。
3. 从项目详情页进入现有分镜页面。
4. 保留旧路由 `/episode/:episodeId`，做兼容重定向。
5. 提供项目下一键拉取全部剧集。

首版 **不做**：

1. 项目创建、编辑、删除。
2. 美术风格相关接口接入。
3. 项目封面上传或复杂编辑能力。
4. “跨项目本地剧集管理中心”。

---

## 2. 当前代码基线

### 2.1 已有能力

当前仓库并不是从零开始，已有几块关键底座：

1. 本地数据目录天然按项目维度组织：
   `data/{projectId}/{episodeId}/episode.json`
2. `FeelingClient` 已支持读取项目下剧集：
   `get_project_episodes(project_id)`
3. `pull_project(project_id)` 已支持按项目批量拉取。
4. 前端各分镜页面本质都以 `episodeId` 为主键工作，业务逻辑可复用。

对应代码：

1. [src/feeling/client.py](/Users/zuobowen/Documents/GitHub/fv_autovidu/src/feeling/client.py)
2. [src/feeling/puller.py](/Users/zuobowen/Documents/GitHub/fv_autovidu/src/feeling/puller.py)
3. [web/server/services/data_service.py](/Users/zuobowen/Documents/GitHub/fv_autovidu/web/server/services/data_service.py)
4. [web/frontend/src/App.tsx](/Users/zuobowen/Documents/GitHub/fv_autovidu/web/frontend/src/App.tsx)

### 2.2 当前缺口

当前真正缺的是“项目层的 Web 暴露能力”，不是底层数据能力：

1. FastAPI 没有 `/api/projects` 路由。
2. 前端没有项目列表页和项目详情页。
3. 所有页面跳转都写死为 `/episode/...`。
4. 面包屑、侧边栏、资产库入口都默认只有剧集层级。

### 2.3 当前代码约束

这几个约束会直接影响方案设计：

1. `main.py` 统一用 `app.include_router(..., prefix="/api")` 挂载路由。
   因此新增 `projects.py` 时，路由文件内前缀应写 `/projects`，不能再写 `/api/projects`。
2. `data_service.get_episode(episode_id)` 按 `episodeId` 查本地唯一目录；同一 episodeId 由 puller 归一化保证不再多副本并存。
   这使旧路由兼容成为可能。
3. 前端很多跳转路径是硬编码字符串，不能只改 `App.tsx` 就结束。

---

## 3. 产品范围

### 3.1 MVP 范围

MVP 只交付以下用户路径：

1. 打开首页，看到项目列表。
2. 点击项目，进入项目详情页。
3. 在项目详情页看到：
   平台剧集列表、本地是否已拉取、拉取时间、进入分镜按钮。
4. 点击已拉取剧集，进入现有分镜板。
5. 点击“拉取单集”或“一键拉取全部”。
6. 旧书签 `/episode/:episodeId` 仍然可用。

### 3.2 明确不纳入 MVP

以下能力不进入首版，以避免范围膨胀：

1. 项目 CRUD。
2. 项目封面编辑。
3. 项目美术风格管理。
4. 项目活动摘要。
5. 本地孤儿剧集的独立管理页面。

---

## 4. 目标路由

### 4.1 新路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | `ProjectListPage` | 新首页，展示项目列表 |
| `/project/:projectId` | `ProjectDetailPage` | 项目详情页，展示该项目剧集 |
| `/project/:projectId/episode/:episodeId` | `StoryboardPage` | 复用现有分镜板 |
| `/project/:projectId/episode/:episodeId/assets` | `AssetLibraryPage` | 复用现有资产库 |
| `/project/:projectId/episode/:episodeId/shot/:shotId` | `ShotDetailPage` | 复用现有镜头详情 |
| `/project/:projectId/episode/:episodeId/shot/:shotId/regen` | `RegenPage` | 复用现有重生页 |
| `/project/:projectId/episode/:episodeId/timeline` | `TimelinePage` | 复用现有时间线 |
| `/settings` | `SettingsPage` | 保持不变 |

### 4.2 兼容路由

保留旧路由：

1. `/episode/:episodeId`
2. `/episode/:episodeId/assets`
3. `/episode/:episodeId/shot/:shotId`
4. `/episode/:episodeId/shot/:shotId/regen`
5. `/episode/:episodeId/timeline`

兼容策略：

1. 旧路由页面不再直接承载业务。
2. 统一跳转到 `LegacyEpisodeRedirect`。
3. 重定向组件通过 `GET /api/episodes/{episodeId}` 获取本地 `projectId`。
4. 找到则跳转到新路径。
5. 找不到则展示“本地未拉取，无法确定所属项目”的错误页。

这样做的好处是：

1. 不需要改后端 `get_episode()` 的索引方式。
2. 兼容旧书签和旧分享链接。
3. 不要求平台提供“episode -> project”反查接口。

---

## 5. 后端实施方案

### 5.1 FeelingClient 扩展

新增两个只读方法：

1. `get_projects()`
2. `get_project(project_id)`

位置：

1. [src/feeling/client.py](/Users/zuobowen/Documents/GitHub/fv_autovidu/src/feeling/client.py)

首版只做只读，不在 `FeelingClient` 中扩展项目写接口。

### 5.2 FastAPI 路由

新增文件：

1. `web/server/routes/projects.py`

注意：

1. 该路由文件内部前缀应为 `prefix="/projects"`。
2. 在 `main.py` 中通过 `app.include_router(projects.router, prefix="/api", tags=["projects"])` 挂载。

### 5.3 首版后端接口

#### GET `/api/projects`

返回项目列表，供首页使用。

响应建议：

```json
[
  {
    "projectId": "proj_123",
    "title": "行尸走肉 S2",
    "description": "测试项目",
    "coverImage": null,
    "episodeCount": 12,
    "pulledEpisodeCount": 5,
    "createdAt": "2026-03-20T12:00:00Z",
    "updatedAt": "2026-03-23T08:00:00Z"
  }
]
```

字段说明：

1. `episodeCount` 来自平台项目下剧集数。
2. `pulledEpisodeCount` 来自本地 `data/` 统计。
3. `coverImage` 首版允许为空。

#### GET `/api/projects/{projectId}`

返回项目基础信息，不强制把剧集列表塞进去。

响应建议：

```json
{
  "projectId": "proj_123",
  "title": "行尸走肉 S2",
  "description": "测试项目",
  "coverImage": null,
  "episodeCount": 12,
  "pulledEpisodeCount": 5,
  "createdAt": "2026-03-20T12:00:00Z",
  "updatedAt": "2026-03-23T08:00:00Z"
}
```

#### GET `/api/projects/{projectId}/episodes`

这是项目详情页的核心接口，返回“远端剧集 + 本地状态”的合并结果。

响应建议：

```json
{
  "project": {
    "projectId": "proj_123",
    "title": "行尸走肉 S2"
  },
  "episodes": [
    {
      "episodeId": "ep_001",
      "title": "第1集",
      "episodeNumber": 1,
      "source": "remote_and_local",
      "pulledLocally": true,
      "localProjectId": "proj_123",
      "pulledAt": "2026-03-23T08:00:00Z"
    },
    {
      "episodeId": "ep_002",
      "title": "第2集",
      "episodeNumber": 2,
      "source": "remote_only",
      "pulledLocally": false,
      "localProjectId": null,
      "pulledAt": null
    }
  ]
}
```

其中 `source` 取值：

1. `remote_and_local`
2. `remote_only`
3. `local_only`

首版页面默认只展示：

1. `remote_and_local`
2. `remote_only`

`local_only` 仅在确实扫描到本地项目目录但平台列表里不存在时返回，用于提示数据漂移，不作为主流程依赖。

#### POST `/api/projects/{projectId}/pull-all`

调用 `pull_project(project_id, DATA_ROOT)`。

响应建议：

```json
{
  "projectId": "proj_123",
  "requested": 12,
  "successCount": 10,
  "failedCount": 2,
  "failedEpisodes": [
    {
      "episodeId": "ep_011",
      "message": "拉取失败原因"
    }
  ]
}
```

这里不要设计成“任意一集失败就整批 500”。
更实用的策略是：

1. 仅当项目查询本身失败时返回 500。
2. 单集失败记录到结果里。
3. 前端按部分成功处理。

### 5.4 本地/远端剧集合并规则

`GET /api/projects/{projectId}/episodes` 使用以下规则：

1. 远端平台剧集列表是主数据源。
2. 本地剧集来自 `data_service.list_episodes()` 过滤 `projectId == 当前项目`。
3. 以 `episodeId` 为键做 union。
4. 若远端和本地同时存在：
   `source = remote_and_local`
5. 若仅远端存在：
   `source = remote_only`
6. 若仅本地存在：
   `source = local_only`

排序规则：

1. 优先按 `episodeNumber` 升序。
2. 缺少 `episodeNumber` 时，按标题。
3. 最后按 `episodeId` 保底。

### 5.5 Schema 建议

在 `web/server/models/schemas.py` 新增以下模型即可，不要一次性设计过多层级：

1. `ProjectSummary`
2. `ProjectDetail`
3. `ProjectEpisodeItem`
4. `ProjectEpisodeListResponse`
5. `PullProjectResponse`

---

## 6. 前端实施方案

### 6.1 页面策略

不要试图把现有 `EpisodeListPage` 改造成“既能当首页，又能当项目详情页”。

更稳妥的方案是：

1. 新增 `ProjectListPage` 作为首页。
2. 新增 `ProjectDetailPage` 作为项目下剧集页。
3. `StoryboardPage`、`AssetLibraryPage`、`ShotDetailPage`、`RegenPage`、`TimelinePage` 继续复用。

### 6.2 必须新增的前端模块

新增：

1. `web/frontend/src/types/project.ts`
2. `web/frontend/src/api/projects.ts`
3. `web/frontend/src/stores/projectStore.ts`
4. `web/frontend/src/pages/ProjectListPage.tsx`
5. `web/frontend/src/pages/ProjectDetailPage.tsx`
6. `web/frontend/src/pages/LegacyEpisodeRedirect.tsx`
7. `web/frontend/src/utils/routes.ts`

`routes.ts` 是这次改造里非常值得加的一个工具文件，用来统一生成路径，例如：

```ts
project(projectId)
episode(projectId, episodeId)
assets(projectId, episodeId)
shot(projectId, episodeId, shotId)
regen(projectId, episodeId, shotId)
timeline(projectId, episodeId)
```

这样能避免继续手写大量字符串路径。

### 6.3 路由重构原则

当前前端所有跳转大量写死 `/episode/...`，所以这次改造不能只改路由定义。

需要同步修改：

1. `App.tsx`
2. `EpisodeListPage.tsx` 中的入口跳转
3. `AssetLibraryPage.tsx`
4. `ShotDetailPage.tsx`
5. `ShotCard.tsx`
6. `ShotRow.tsx`
7. `ShotFrameCompare.tsx`
8. `SideNavBar.tsx`

### 6.4 面包屑与布局

当前 `TopNavBar` 是按 URL segment 直接翻译，无法展示“项目真实名称”和“剧集标题”。

因此首版应改为：

1. `AppLayout` 根据当前路由参数和 store 主动构造 breadcrumbs。
2. 在项目页展示：
   `首页 / 项目名`
3. 在剧集页展示：
   `首页 / 项目名 / 剧集名 / 分镜板`

不要继续依赖“把 path segment 生翻译成标签”的方式做复杂层级。

### 6.5 项目详情页交互规则

项目详情页建议只做下面几种操作：

1. 刷新项目剧集
2. 拉取单集
3. 一键拉取全部
4. 进入分镜板

页面规则：

1. `pulledLocally = true` 时显示“进入分镜板”。
2. `pulledLocally = false` 时显示“拉取后进入”。
3. 拉取单集成功后刷新当前项目剧集列表。
4. 一键拉取全部结束后刷新当前项目剧集列表。

---

## 7. 具体文件改动清单

### 7.1 后端

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/feeling/client.py` | 修改 | 增加 `get_projects` / `get_project` |
| `web/server/routes/projects.py` | 新增 | 项目相关 API |
| `web/server/main.py` | 修改 | 挂载 projects 路由 |
| `web/server/models/schemas.py` | 修改 | 增加项目相关 schema |

### 7.2 前端

| 文件 | 动作 | 说明 |
|------|------|------|
| `web/frontend/src/App.tsx` | 修改 | 新路由与兼容路由 |
| `web/frontend/src/types/project.ts` | 新增 | 项目类型定义 |
| `web/frontend/src/api/projects.ts` | 新增 | 项目 API |
| `web/frontend/src/stores/projectStore.ts` | 新增 | 项目 store |
| `web/frontend/src/pages/ProjectListPage.tsx` | 新增 | 项目列表页 |
| `web/frontend/src/pages/ProjectDetailPage.tsx` | 新增 | 项目详情页 |
| `web/frontend/src/pages/LegacyEpisodeRedirect.tsx` | 新增 | 旧路由兼容 |
| `web/frontend/src/utils/routes.ts` | 新增 | 路由生成工具 |
| `web/frontend/src/components/layout/AppLayout.tsx` | 修改 | 面包屑与顶部动作 |
| `web/frontend/src/components/layout/SideNavBar.tsx` | 修改 | 新入口与资产库链接 |
| `web/frontend/src/pages/AssetLibraryPage.tsx` | 修改 | 使用新路径 |
| `web/frontend/src/pages/ShotDetailPage.tsx` | 修改 | 使用新路径 |
| `web/frontend/src/components/business/ShotCard.tsx` | 修改 | 使用新路径 |
| `web/frontend/src/components/business/ShotRow.tsx` | 修改 | 使用新路径 |
| `web/frontend/src/components/business/ShotFrameCompare.tsx` | 修改 | 使用新路径 |

---

## 8. 实施顺序

### Phase 1：后端代理层

目标：先把前端所需 API 补齐。

任务：

1. `FeelingClient` 新增 `get_projects` / `get_project`
2. 增加 `projects.py`
3. 实现 `/api/projects`
4. 实现 `/api/projects/{projectId}`
5. 实现 `/api/projects/{projectId}/episodes`
6. 实现 `/api/projects/{projectId}/pull-all`

建议工时：

1. 0.5 到 1 天

### Phase 2：项目列表首页

目标：先打通“看到项目 -> 点击进入项目”的主路径。

任务：

1. 新增 `types/project.ts`
2. 新增 `api/projects.ts`
3. 新增 `projectStore.ts`
4. 实现 `ProjectListPage`
5. `App.tsx` 首页改为项目列表

建议工时：

1. 0.5 到 1 天

### Phase 3：项目详情页

目标：打通“项目 -> 剧集 -> 分镜”的主业务链路。

任务：

1. 实现 `ProjectDetailPage`
2. 展示远端+本地归并后的剧集状态
3. 支持拉取单集
4. 支持一键拉取全部
5. 已拉取剧集进入分镜页

建议工时：

1. 1 天

### Phase 4：路由统一与兼容

目标：解决 URL 改造带来的全局导航问题。

任务：

1. 新增 `routes.ts`
2. 全量替换 `/episode/...` 硬编码
3. 增加 `LegacyEpisodeRedirect`
4. 修改 `AppLayout` / `TopNavBar` / `SideNavBar`

建议工时：

1. 1 到 1.5 天

### Phase 5：联调与打磨

任务：

1. 拉取单集联调
2. 一键拉取全部联调
3. 旧路由重定向验证
4. 空态、错误态、加载态处理
5. 平台不可达与 token 失效提示

建议工时：

1. 0.5 到 1 天

### 总工时评估

更可信的估算是：

1. **3 到 5 天**

不是原先的理想化 3 天整。

---

## 9. 验收标准

满足以下条件即可认为首版完成：

1. 打开首页能看到项目列表。
2. 点击项目能进入项目详情页。
3. 项目详情页能正确显示项目下剧集和本地拉取状态。
4. 能从项目详情页拉取单集。
5. 能从项目详情页一键拉取全部。
6. 已拉取剧集能进入现有分镜板。
7. 旧的 `/episode/:episodeId` 链接仍能正确跳转。
8. 资产库、镜头详情、时间线等页面在新路由下仍正常工作。

---

## 10. 风险与处理

| 风险 | 影响 | 处理方式 |
|------|------|---------|
| 平台 `/api/projects` 返回结构与预期不一致 | 首页无法落地 | 先抓真实响应样例，再写 schema 映射 |
| 大量前端硬编码 `/episode/...` 漏改 | 页面跳转失效 | 必须引入 `routes.ts` 统一生成路径 |
| 一键拉取部分失败 | 用户误以为全部成功 | 返回逐集结果，不做全-or-无 |
| 旧路由找不到本地 episode | 无法重定向 | 展示清晰错误页，并提示从项目页重新拉取 |
| 平台有剧集，本地没有 `projectId` 对应目录 | 状态显示混乱 | 以平台列表为主，本地只做附加状态 |

---

## 11. 建议的开发顺序

如果按实际效率排优先级，我建议：

1. 先做后端 `/api/projects*`
2. 再做首页 `ProjectListPage`
3. 再做 `ProjectDetailPage`
4. 最后统一处理新旧路由和公共导航

原因很简单：

1. 先有项目 API，前端就有稳定契约。
2. 先打通主链路，再做兼容层，返工最少。

---

## 12. 备注

本方案是基于当前仓库真实结构收敛后的“可实施版”，不是平台能力的完整映射。

后续如果首版稳定，再考虑第二阶段扩展：

1. 项目创建与编辑
2. 封面展示优化
3. 美术风格与活动摘要
4. 本地孤儿剧集管理

