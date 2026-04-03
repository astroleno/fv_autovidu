# 万相 Wan 2.7 分镜批量首帧重生 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 FastAPI 中新增 `POST /generate/regen-batch-wan27`：对用户按顺序选中的 1～12 个镜头调用 DashScope 万相 2.7 **异步组图**，将返回的 PNG 按序写回各镜 `firstFrame`，并清空尾帧与视频候选；前端在分镜板用现有批量勾选 + 单次任务轮询接入。

**Architecture:** `src/wan27/` 提供与框架无关的 HTTP 客户端（`requests` + `run_with_http_retry`）；`web/server/services/wan27_batch_service.py` 负责从 `Episode` 拼 `messages.content`、本地图转 `data:image/...;base64`、调用客户端并下载 URL 得到 `list[bytes]`；`generate.py` 中 `_run_regen_batch_wan27` 与 `_run_regen_frame` 同模式（锁外调模型、锁内落盘 + `update_shot`），`task_store.kind=regen_wan27_batch`。

**Tech Stack:** Python 3.9+、`requests`（已在 `requirements.txt`）、FastAPI、Pydantic、Vitest（前端若有单测）、unittest（后端）。

**规格依据:** `docs/superpowers/specs/2026-04-03-wan27-storyboard-batch-design.md`

---

## 文件结构（创建 / 修改）

| 路径 | 职责 |
|------|------|
| `src/wan27/__init__.py` | 包导出（可选） |
| `src/wan27/client.py` | DashScope 地域 base、异步创建任务、GET 轮询、`extract_image_urls` |
| `src/wan27/types.py` |  TypedDict / 常量（可选，或并入 client） |
| `web/server/services/wan27_batch_service.py` | 拼 prompt、解析资产路径、编码参考图、调用 client、校验返回张数 |
| `web/server/models/schemas.py` | `RegenBatchWan27Request`、`RegenBatchWan27Response` |
| `web/server/routes/generate.py` | 路由、`_run_regen_batch_wan27`、校验 shot 顺序与数量 |
| `tests/test_wan27_client.py` | Mock HTTP：建任务 + 查询 SUCCEEDED + 解析 URL |
| `tests/test_wan27_batch_service.py` | Prompt 长度、张数不匹配时抛错（mock client） |
| `tests/test_generate_route_entrypoints.py` | 新路由立即返回 taskId + `BackgroundTasks` 注册 |
| `web/frontend/src/types/`（或 `episode` 旁） | 请求/响应 TypeScript 类型 |
| `web/frontend/src/api/generate.ts` | `regenBatchWan27` |
| `web/frontend/src/pages/StoryboardPage.tsx` | 按钮、确认弹窗、`startPolling` 单 taskId |

---

### Task 1: `src/wan27/client.py` — DashScope 异步客户端

**Files:**
- Create: `src/wan27/__init__.py`（可为空或 `from .client import ...`）
- Create: `src/wan27/client.py`
- Create: `tests/test_wan27_client.py`

- [ ] **Step 1: 写失败单测（轮询成功并解析两张图 URL）**

`tests/test_wan27_client.py`：

```python
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.wan27.client import (  # noqa: E402
    Wan27DashScopeClient,
    extract_image_urls_from_task_payload,
)


class TestWan27Client(unittest.TestCase):
    def test_poll_success_extracts_two_image_urls(self) -> None:
        create_resp = MagicMock()
        create_resp.raise_for_status = MagicMock()
        create_resp.json.return_value = {
            "output": {"task_id": "t1", "task_status": "PENDING"}
        }
        done_resp = MagicMock()
        done_resp.raise_for_status = MagicMock()
        done_resp.json.return_value = {
            "output": {
                "task_status": "SUCCEEDED",
                "choices": [
                    {
                        "message": {
                            "content": [
                                {"type": "image", "image": "https://a/1.png"},
                                {"type": "image", "image": "https://b/2.png"},
                            ]
                        }
                    }
                ],
            }
        }
        session = MagicMock()
        session.post.return_value = create_resp
        session.get.return_value = done_resp

        c = Wan27DashScopeClient(
            api_key="sk-test",
            base_url="https://dashscope.aliyuncs.com/api/v1",
            session=session,
        )
        body = {"model": "wan2.7-image-pro", "input": {"messages": []}, "parameters": {}}
        tid = c.create_async_task(body)
        self.assertEqual(tid, "t1")
        payload = c.poll_until_terminal("t1", interval_sec=0, timeout_sec=1)
        urls = extract_image_urls_from_task_payload(payload)
        self.assertEqual(urls, ["https://a/1.png", "https://b/2.png"])
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/zuobowen/Documents/GitHub/fv_autovidu && python -m pytest tests/test_wan27_client.py -v`  
Expected: `ImportError` 或 `AttributeError`（类未实现）

- [ ] **Step 3: 实现 `client.py`**

要点（与 `reference/wan2.7api/wan2.7_api.md` 一致）：

- `resolve_base_url()`：读 `DASHSCOPE_REGION` / `DASHSCOPE_BASE_URL`，北京默认 `https://dashscope.aliyuncs.com/api/v1`，新加坡 `https://dashscope-intl.aliyuncs.com/api/v1`。
- `POST {base}/services/aigc/image-generation/generation`，Headers：`Authorization: Bearer {key}`、`Content-Type: application/json`、`X-DashScope-Async: enable`。
- `create_async_task(body: dict) -> str`：从 JSON `output.task_id` 取 id；若顶层有 `code`/`message` 则抛 `RuntimeError`。
- `fetch_task(task_id) -> dict`：GET `{base}/tasks/{task_id}`，**HTTP 层**用 `src.utils.retry.run_with_http_retry` 包一层（仅对 429/5xx/RequestException）。
- `poll_until_terminal(task_id, interval_sec=3, timeout_sec=1200)`：循环 `fetch_task`，`PENDING`/`RUNNING` 则 sleep；`SUCCEEDED`/`FAILED`/`CANCELED`/`UNKNOWN` 返回整段 JSON；超时抛 `TimeoutError`。
- `extract_image_urls_from_task_payload(data: dict) -> list[str]`：遍历 `output.choices[0].message.content`，收集 `type=="image"` 的 `image` 字段（与同步响应结构对齐，见文档查询结果示例）。

构造函数注入 `session: requests.Session | None = None` 便于测试。

- [ ] **Step 4: 运行测试通过**

Run: `python -m pytest tests/test_wan27_client.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/wan27/ tests/test_wan27_client.py
git commit -m "feat(wan27): add DashScope async client and unit test"
```

---

### Task 2: `wan27_batch_service.py` — 组装请求与下载字节

**Files:**
- Create: `web/server/services/wan27_batch_service.py`
- Create: `tests/test_wan27_batch_service.py`

- [ ] **Step 1: 单测 — prompt 超 5000 字符时 `ValueError`**

```python
# tests/test_wan27_batch_service.py — 伪代码级断言
# build_wan27_sequential_body(..., shot_texts=["x" * 6000]) -> raises ValueError
```

- [ ] **Step 2: 实现服务模块**

职责：

1. `image_file_to_data_url(path: Path) -> str`：读二进制，按后缀设 `image/png` 或 `image/jpeg` 等（与 DashScope 文档一致）。
2. `build_batch_prompt(ordered_shots: list[Shot], *, panel_count: int, aspect_ratio_hint: str) -> str`：  
   - 头部：组图张数、画幅、无字幕、电影感等短说明；  
   - `参考（与上传顺序一致）：image1=…`（若有参考图）；  
   - 按 `shotNumber` / 顺序列出 `Shot N：{image_prompt}`，可附一行 `visualDescription` 截断；  
   - `len(prompt) <= 5000` 否则 `ValueError`。
3. `run_wan27_sequential_for_shots(...)`：  
   - 入参：`api_key`、`base_url`、`model`、`size`、`ordered_shots`、`ref_asset_paths: list[Path]`、`client: Wan27DashScopeClient`（可默认构造）。  
   - `content = [{"image": data_url}, ...] + [{"text": prompt}]`（**文档顺序**：多图在前，**text 在最后** — 对照 `wan27-cli.mjs` 的 `edit` 子命令为 `[...imgs, {text}]`；组图示例仅为 text，本任务为 **图 + 文** 与 walkingdead 脚本一致）。  
   - `parameters`: `enable_sequential=True`, `n=len(ordered_shots)`, `watermark=False`, `size` 默认 `"2K"`；**有参考图输入时不要设 `thinking_mode: true`**（官方说明该字段仅在「关闭组图且无图片输入」时生效，带图时省略或显式 `false` 避免歧义）。  
   - 创建任务 → 轮询 → `extract_image_urls` → `requests.get` 下载每张（可同样包 `run_with_http_retry`）→ `list[bytes]`。  
   - 若 `len(urls) != len(ordered_shots)`：`RuntimeError("期望 N 张，实际 M 张")`。

- [ ] **Step 3: pytest 通过 + commit**

```bash
git add web/server/services/wan27_batch_service.py tests/test_wan27_batch_service.py
git commit -m "feat(wan27): batch sequential body builder and image download"
```

---

### Task 3: `generate.py` 路由与后台任务

**Files:**
- Modify: `web/server/models/schemas.py`
- Modify: `web/server/routes/generate.py`
- Modify: `tests/test_generate_route_entrypoints.py`

- [ ] **Step 1: Pydantic 模型**

`RegenBatchWan27Request`：`episodeId: str`，`shotIds: list[str]`（长度 1～12，顺序有意义），`assetIds: list[str] = []`，`model: str = "wan2.7-image-pro"`，`size: str = "2K"`。

`RegenBatchWan27Response`：`taskId: str`，`episodeId: str`，`shotCount: int`。

- [ ] **Step 2: 路由校验**

`@router.post("/generate/regen-batch-wan27")`：

- 若 `not 1 <= len(shotIds) <= 12`：`HTTPException(400, detail="万相组图一批仅支持 1～12 个镜头")`。
- `task_id = f"wan27-{uuid.uuid4().hex[:12]}"`（或 `regen-wan27-` 前缀，全库唯一即可）。
- `set_task(..., kind="regen_wan27_batch", episode_id=..., payload={"shotIds": shotIds, ...})`。
- `background_tasks.add_task(_run_regen_batch_wan27, ...)`。

- [ ] **Step 3: `_run_regen_batch_wan27`**

逻辑要点：

- `data_service.get_episode` / `get_episode_dir`；按 `shotIds` 顺序 `get_shot`，缺失则 `failed`。
- **资产路径**：复用 `_resolve_regen_asset_paths(ep, first_shot, asset_ids, ep_dir)`，其中 `first_shot` = **shotIds[0] 对应 Shot**（与规格「同一解析规则」一致；镜头级资产以首镜为准）。
- `api_key = os.environ.get("DASHSCOPE_API_KEY")`；缺则 `failed`。
- 锁外：`run_wan27_sequential_for_shots(...)` 得到 `list[bytes]`。
- `episode_fs_lock` 内：对每个 `i`，`write_bytes` 到 `ep_dir / shots[i].firstFrame`，`update_shot(..., {"endFrame": None, "videoCandidates": [], "status": "pending"})` — **不强制改 imagePrompt**（与规格「可按镜更新」— v1 可只落盘不改 prompt，避免与用户文案漂移；若产品要同步，可把当前 `shot.imagePrompt` 原样写回）。
- `set_task(success, result={"shotIds": shotIds, "imageCount": n})`。

- [ ] **Step 4: 扩展 `test_generate_route_entrypoints`**

Mock `get_task_store`、`get_shot`（返回 minimal shot）、`get_episode`，断言返回 `taskId` 前缀、`shotCount==len(shotIds)`、`background_tasks.tasks` 长度为 1、`set_task` 的 `kind=="regen_wan27_batch"`。

- [ ] **Step 5: 运行测试**

Run: `python -m pytest tests/test_generate_route_entrypoints.py tests/test_wan27_client.py tests/test_wan27_batch_service.py -v`  
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add web/server/models/schemas.py web/server/routes/generate.py tests/test_generate_route_entrypoints.py
git commit -m "feat(api): POST /generate/regen-batch-wan27 with background task"
```

---

### Task 4: 前端 — API 类型、分镜板入口

**Files:**
- Modify: `web/frontend/src/types`（集中导出处，按项目惯例）
- Modify: `web/frontend/src/api/generate.ts`
- Modify: `web/frontend/src/pages/StoryboardPage.tsx`
- Optional: `web/frontend/src/components/business/BatchOperationConfirmDialog.tsx`（若可复用 `kind` 扩展）

- [ ] **Step 1: TypeScript 类型与 `generateApi.regenBatchWan27`**

对齐 Pydantic 字段名（camelCase）：`episodeId`, `shotIds`, `assetIds?`, `model?`, `size?`；响应 `taskId`, `episodeId`, `shotCount`。

- [ ] **Step 2: StoryboardPage 交互**

- 在批量工具区增加按钮，文案示例：**「万相组图重生（1～12 镜）」**，与「重试失败镜头」区分。
- 使用与尾帧类似的 **`BatchOperationConfirmDialog`** 或新建轻量确认：展示当前勾选/筛选下的目标镜头数；若 `n<1` 或 `n>12`：Toast 提示，不请求。
- 目标镜头列表：与 `pendingForBatch` 同源思路，用 **`filterShotsByBatchPick`** 在 **「有 firstFrame 的镜头」** 上过滤（可新建 `wan27BatchShots` = `allShots` 中有 `firstFrame` 且非生成中，再过 batch pick），**保持列表顺序与 `flattenShots` 叙事顺序一致**，再按勾选取子集时仍保持顺序。
- 提交：`generateApi.regenBatchWan27({ episodeId, shotIds })`；`startPolling([res.data.taskId], { episodeId, onAllSettled: () => toast + 可选打开简易结果 })`。单任务成功：`pushToast("万相组图重生已完成", "success")`；失败：展示 `error`。

- [ ] **Step 3: 前端校验**

Run: `pnpm --prefix web/frontend exec vitest run`（若有相关用例）或 `pnpm --prefix web/frontend run lint`

- [ ] **Step 4: Commit**

```bash
git add web/frontend/src/types web/frontend/src/api/generate.ts web/frontend/src/pages/StoryboardPage.tsx
git commit -m "feat(storyboard): Wan27 batch regen button and polling"
```

---

### Task 5: 文档与联调说明（短）

- [ ] 在 `docs/单帧重生.md` 末尾加一节「万相 2.7 批量组图」：依赖 `DASHSCOPE_API_KEY`、每批 ≤12 镜、与 yunwu 单帧重生并行。

- [ ] Commit: `docs: document Wan27 batch regen endpoint`

---

## 计划自检（对照规格）

| 规格章节 | 对应任务 |
|----------|----------|
| Python 直连、异步组图 | Task 1–3 |
| 1～12 镜、顺序写回 | Task 3 校验 + 落盘循环 |
| 张数不足则失败不落盘 | Task 2 `run_wan27_sequential_for_shots` |
| 资产解析与单帧一致 | Task 3 首镜 + `_resolve_regen_asset_paths` |
| task_store 异步轮询 | Task 3 kind + Task 4 `startPolling` |
| 前端最小集 | Task 4 |
| v1 不传资产 UI | Task 4 仅 `shotIds`；`assetIds` 留空，后端已支持 |

**占位符扫描：** 无 TBD；具体常量以官方文档为准。

**类型一致性：** `shotIds` 顺序贯穿 Pydantic、后台 `_run_regen_batch_wan27`、前端数组顺序。

---

## 执行方式（完成后由你选）

Plan 已保存至 `docs/superpowers/plans/2026-04-03-wan27-storyboard-batch.md`。

**1. Subagent-Driven（推荐）** — 每任务派生子代理，任务间人工过目，迭代快。  
**2. Inline Execution** — 本会话内按任务执行，配合 `executing-plans` 与检查点。

你更倾向哪一种？
