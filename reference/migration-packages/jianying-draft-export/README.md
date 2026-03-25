# 剪映草稿导出（Jianying Draft Export）迁移包

本目录从 UGCFlow 仓库抽取「VEO 管线 → 剪映草稿 / ZIP 打包」相关实现，便于你合并到其他 Node.js 后端项目，并保留与当前仓库一致的行为与测试。

## 包内目录说明

| 路径 | 说明 |
|------|------|
| `server/services/` | 核心导出逻辑、剪映草稿路径探测、视频 `probeVideo`（供导出时读取分辨率等） |
| `server/utils/` | 草稿语义化命名、安全路径解析、素材路径解析（依赖项目 `config`） |
| `examples/` | 前端弹窗与 ZIP 目录选择器示例（需按目标项目调整 import） |
| `tests-from-repo/` | 仓库内原有路由/集成测试副本，供对照与迁移后回归 |

## 合并到目标项目的方式（重要）

这些文件的 `require` 路径按 **UGCFlow 的 `server/` 布局** 编写，例如：

- `server/services/jianyingDraftExportService.js` → `require("../config")`、`require("../utils/pathSafe")`、`require("../db/variantDAO")` 等

**推荐做法：** 将本包内 `server/services/`、`server/utils/` 中的文件 **原样复制** 到你目标项目的 `server/services/`、`server/utils/` 下，与现有 `config.js`、`db/variantDAO.js` 等并列，不要随意改子目录名，否则需要批量修改 `require` 路径。

若目标项目目录结构不同，请自行调整 `require`，或建立软链接/别名。

## npm 依赖

目标项目至少需要安装：

```bash
npm install archiver ffmpeg-static @ffprobe-installer/ffprobe
```

（与 UGCFlow `server/services/videoPreprocess.js` 中 `probeVideo` 使用的静态二进制一致。）

## `config` 必须提供的字段

以下模块会读取 `server/config`（或你的统一配置模块）：

| 模块 | 用到的配置 |
|------|------------|
| `server/utils/pathSafe.js` | `PROJECT_STORAGE_DIR`（项目根目录下的 `public/project` 一类路径） |
| `server/utils/assetPathResolver.js` | `PROJECT_STORAGE_DIR`、`PUBLIC_DIR`、`ROOT_DIR` |

请在你自己的 `config` 中导出上述字段，语义与 UGCFlow 一致即可（用于把 manifest 里的相对素材路径安全地解析为磁盘绝对路径）。

## 核心服务：`exportDraft` 入参

`jianyingDraftExportService.exportDraft` 约定：

```js
await jianyingDraftExportService.exportDraft({
  manifest,      // VEO 管线 manifest（见下）
  baseDir,       // 当前 variant 的运行时目录（如 veo-shot-pipeline 根）
  draftPath,     // 可选，剪映草稿根目录的绝对路径；仅打 ZIP 时可不传
  createZip,     // 是否生成 ZIP 包（与是否写入剪映目录独立）
});
```

### manifest 最小相关字段

导出会扫描 `manifest.veoOutputs`：仅 `status === "completed"` 且具备可导出素材的镜头会进入时间线。命名会使用 `productName`、`templateName`、`variantDimensions`、`templateId`、`variantId` 等（见 `draftNaming.js`）。

字幕文案优先级：`output.subtitleText` → `output.dub.sourceText` → **通过 `variantDAO.getVariant(manifest.variantId)` 读取 storyboard 中对应镜头的口播文案**（见 `resolveStoryboardSubtitleText`）。

因此迁移时 **必须保留对 `variantDAO` 的接入**，或自行改写 `jianyingDraftExportService.js` 中 `resolveStoryboardSubtitleText` 的数据来源。

## HTTP API（在 UGCFlow 中的形态）

以下为仓库中实际挂载的路径，供你对照实现：

| 方法 | 路径 | 作用 |
|------|------|------|
| `GET` | `/api/projects/:id/variants/:variantId/veo-shot-pipeline/jianying-draft` | 读取当前 manifest 中的 `draftExport` 状态 |
| `POST` | 同上 | Body: `{ draftPath?: string, createZip?: boolean }`，执行导出 |
| `GET` | `.../jianying-draft/download-zip` | 下载上次导出记录在 manifest 中的 ZIP（路径需在 variant 的 `draft-export` 目录内） |
| `GET` | `/api/system/jianying-draft-path` | 返回本机探测的剪映草稿根路径（`jianyingDraftPathService`） |

路由内的 **manifest 读写、variant 校验、运行时目录** 在 UGCFlow 中由 `veoShotPipelineService` 完成；迁移到其他项目时，你需要用等价服务替换（见 `examples/express-route-handlers.example.js` 注释）。

## 前端对接要点

- 请求/响应类型可参考 `examples/veo-draft-export-types.ts`。
- `examples/VeoDraftExportModal.tsx` 依赖 `@radix-ui/react-dialog`、项目内 `api`、`types/veo`，并配合 `zipDownloadDirectory.ts` 做 ZIP 保存；合并时请修改 import 路径与 API 封装。

## 运行单元测试

在 **已合并到完整 UGCFlow 结构** 的仓库根目录执行（路径以你克隆位置为准）：

```bash
npm test -- --runInBand server/services/jianyingDraftExportService.test.js
npm test -- --runInBand server/services/jianyingDraftPathService.test.js
```

`tests-from-repo/` 下的路由测试依赖完整应用与集成环境，迁移后需在目标项目中补齐路由再运行。

## 与 ZIP 下载的语义区分

仅勾选「打包 ZIP」、不填剪映路径时，成功/失败文案在 UGCFlow 中为「视频打包完成 / 视频打包失败」；写入剪映目录时为「草稿导出完成 / 剪映草稿导出失败」。逻辑见主仓库 `variantRoutes.js` 中 `postJianyingDraftExport` 与 `classifyDraftExportError`。

## 许可与来源

代码拷贝自 UGCFlow 内部实现；迁移到其他项目时请遵循你团队对该仓库的许可证与归属要求。
