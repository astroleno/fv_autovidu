# 台词拉取、本地化、提示词注入、配音与剪映原文字幕 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 Feeling 分镜 API 持久化台词字段；支持剧集级目标语与译文编辑；将译文用于 Vidu 视频提示词拼接与 ElevenLabs TTS；剪映导出增加**原文**字幕轨（丙）；分镜列表可编辑相关字段。

**Architecture:** 在 `Shot` / `Episode` 上扩展与 `puller` 对齐的台词字段；`update_shot` 仅合并已存在于 `Shot.model_dump()` 的键，故所有新字段必须加入 Pydantic `Shot` 与 TS `Shot`。剪映字幕使用已依赖的 **pyJianYingDraft** 的 `TextSegment` + `Timerange` 生成 `materials.texts` 与 `text` 轨道片段，时间轴与现有视频 segment 的 `target_timerange` 逐镜对齐。配音在 `tts_text` 缺省时回退到 `dialogueTranslation`（再回退 `dialogue` 由产品决定，本计划采用：**TTS 优先译文，无译文则跳过自动填词，避免用中文原文配英语音色**——见 Task 6）。

**Tech Stack:** Python 3.9+、FastAPI、Pydantic v2、React+TS、Vite、pytest、pyJianYingDraft（已存在于 `requirements.txt`）、现有 `episode.json` 读写与 `jianying_service._write_jianying_draft_pyjdraft`。

---

## 文件与职责总览

| 路径 | 职责 |
|------|------|
| `src/feeling/puller.py` | 从平台 `raw_shots` 提取 `dialogue` / `associatedDialogue`，写入 `shots_out` |
| `web/server/models/schemas.py` | `Shot`、`Episode` 新增字段 |
| `web/frontend/src/types/episode.ts` | 与后端一致的 TS 类型 |
| `web/server/services/data_service.py` | 无需改合并逻辑；仅新字段出现在 `Shot` 后即可 PATCH |
| `web/server/routes/generate.py` / `web/server/services/vidu_service.py` | 组装发往 Vidu 的 `prompt` 时拼接对白块 |
| `web/server/routes/dub_route.py` | TTS 默认文本来源 |
| `web/server/services/jianying_service.py` | `_write_jianying_draft_pyjdraft` 增加 text 轨；或抽 `jianying_text_track.py` |
| `web/frontend/src/components/business/ShotPromptCells.tsx` / `ShotRow.tsx` | 台词与译文列、注入辅助 |
| `web/frontend/src/pages/SettingsPage.tsx` 或剧集页 | 目标语入口（择一，见 Task 5） |
| `tests/test_puller_dialogue.py`（新建） | puller 台词解析 |
| `tests/test_jianying_text_track.py`（新建） | 剪映 JSON 含 texts 与 text 轨 |

---

### Task 1: Puller — 提取并写入 `dialogue` / `associatedDialogue`

**Files:**
- Create: `tests/test_puller_dialogue.py`
- Modify: `src/feeling/puller.py`

- [ ] **Step 1: 编写失败单测（从仓库已有 dump 取结构）**

在 `tests/test_puller_dialogue.py` 中内联最小 `sh` dict（可从 `docs/shots_api_dump.json` 复制一条含 `dialogue` 与 `associatedDialogue` 的 shot），测试新函数返回值。

```python
import pytest

from src.feeling import puller


def test_get_dialogue_fields_full_string():
    sh = {
        "dialogue": "卡尔：格雷·金斯顿。",
        "associatedDialogue": {"role": "卡尔", "content": "格雷·金斯顿。"},
    }
    d, ad = puller._get_dialogue_fields(sh)
    assert d == "卡尔：格雷·金斯顿。"
    assert ad == {"role": "卡尔", "content": "格雷·金斯顿。"}


def test_get_dialogue_fields_nested_metadata():
    sh = {
        "metadata": {
            "dialogue": "格雷：怎么了？",
            "shotMaster": {"raw": {"shot_list": [{"associated_dialogue": {"role": "格雷", "content": "怎么了？"}}]}},
        }
    }
    d, ad = puller._get_dialogue_fields(sh)
    assert "怎么了" in d
    assert ad.get("role") == "格雷"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/zuobowen/Documents/GitHub/fv_autovidu && python -m pytest tests/test_puller_dialogue.py -v`

Expected: `AttributeError` 或 `ImportError`（`_get_dialogue_fields` 不存在）

- [ ] **Step 3: 在 `puller.py` 实现 `_get_dialogue_fields` 并在组装 shot 时写入**

在 `_get_visual_description` 附近新增：

```python
def _get_dialogue_fields(sh: dict) -> tuple[str, dict | None]:
    """
    从平台 shot 提取台词字符串与结构化对白。
    优先顶层 dialogue / associatedDialogue，其次 metadata 内同名字段。
    Returns:
        (dialogue_line, associated_dialogue_or_none)
    """
    line = _get(sh, "dialogue", "Dialogue", default="") or ""
    assoc = sh.get("associatedDialogue") if isinstance(sh, dict) else None
    if not line or assoc is None:
        meta = sh.get("metadata") if isinstance(sh, dict) else None
        if isinstance(meta, dict):
            if not line:
                line = _get(meta, "dialogue", default="") or ""
            if assoc is None:
                raw = meta.get("shotMaster") if isinstance(meta.get("shotMaster"), dict) else None
                if isinstance(raw, dict):
                    sl = raw.get("raw") if isinstance(raw.get("raw"), dict) else None
                    if isinstance(sl, dict):
                        lst = sl.get("shot_list")
                        if isinstance(lst, list) and lst and isinstance(lst[0], dict):
                            ad = lst[0].get("associated_dialogue")
                            if isinstance(ad, dict):
                                assoc = {"role": str(ad.get("role", "")), "content": str(ad.get("content", ""))}
    if isinstance(assoc, dict) and assoc.get("role") is not None:
        assoc = {"role": str(assoc.get("role", "")), "content": str(assoc.get("content", ""))}
    else:
        assoc = None
    return (line or "", assoc)
```

Step 3 **仅**实现 `_get_dialogue_fields` 并通过单测；**不要**在 `shots_out` 里写临时键。

- [ ] **Step 4: 运行测试**

Run: `python -m pytest tests/test_puller_dialogue.py -v`

Expected: PASS

- [ ] **Step 5: Commit（仅函数 + 测试）**

```bash
git add src/feeling/puller.py tests/test_puller_dialogue.py
git commit -m "feat(puller): add _get_dialogue_fields helper for Feeling shots"
```

**Task 2** 中在 `shots_out.append` / `orphan_shots.append` 两处加入：

```python
dlg, ad = _get_dialogue_fields(sh)
# 与 AssociatedDialogue 模型对齐后序列化
"dialogue": dlg,
"associatedDialogue": ad,  # None 或 {"role": "...", "content": "..."}
"dialogueTranslation": "",  # 拉取时为空，由用户在 Web 填写
```

---

### Task 2: 数据模型 — `Shot` / `Episode` 字段（Pydantic + TypeScript）

**Files:**
- Modify: `web/server/models/schemas.py`
- Modify: `web/frontend/src/types/episode.ts`
- Modify: `src/feeling/puller.py`（shots_out 键与模型一致）

**新增字段（命名锁定全任务一致）：**

**Shot（episode.json 每镜）：**

- `dialogue: str = ""` — 平台原文台词行（字幕与编剧语言，丙）
- `associatedDialogue: Optional[dict[str, str]] = None` — `role` / `content`，可与 `dialogue` 同时存在
- `dialogueTranslation: str = ""` — 目标语译文，供 Vidu 拼接与 TTS；用户可编辑
- `videoPromptDialogueInjected: str = ""` — 可选：上次「注入」操作生成的后缀快照，便于 UI 显示差异（若 YAGNI 可省略，由前端只显示「当前 videoPrompt」）

本计划 **省略** `videoPromptDialogueInjected`，注入直接合并进 `videoPrompt` 或通过前端 PATCH `videoPrompt`（见 Task 5）。

**Episode（剧集级）：**

- `dubTargetLocale: str = ""` — BCP-47 或项目约定枚举（如 `en-US`、`ja`）；空表示「未设」
- `sourceLocale: str = ""` — 可选，台词原文语言，用于 UI 标签

在 `Shot` 的 Pydantic 模型中：

```python
class AssociatedDialogue(BaseModel):
    role: str = ""
    content: str = ""


class Shot(BaseModel):
    # ... existing ...
    dialogue: str = ""
    associatedDialogue: Optional[AssociatedDialogue] = None
    dialogueTranslation: str = ""
```

若希望 `episode.json` 中 `associatedDialogue` 可为空对象，使用 `Optional[AssociatedDialogue] = None`。

puller 中：

```python
dlg, ad_raw = _get_dialogue_fields(sh)
assoc_model = None
if isinstance(ad_raw, dict) and (ad_raw.get("role") or ad_raw.get("content")):
    assoc_model = {"role": ad_raw.get("role", ""), "content": ad_raw.get("content", "")}
```

Pydantic 可用 `AssociatedDialogue.model_validate(assoc_model)`。

- [ ] **Step 1: 更新 `schemas.py` 与 `episode.ts`，运行后端 import**

Run: `cd web/server && python -c "from models.schemas import Shot, Episode; print(Shot.model_fields.keys())"`

Expected: 含 `dialogue`、`associatedDialogue`、`dialogueTranslation`

- [ ] **Step 2: 前端 `npm run build` 或 `tsc --noEmit`**

在 `web/frontend` 执行项目既有类型检查命令。

- [ ] **Step 3: Commit**

```bash
git add web/server/models/schemas.py web/frontend/src/types/episode.ts src/feeling/puller.py
git commit -m "feat(schema): add dialogue fields to Shot and locale fields to Episode"
```

---

### Task 3: 回归测试 — 旧 `episode.json` 无新字段仍可加载

**Files:**
- Modify: `tests/test_data_service_legacy_namespace_compat.py` 或新建 `tests/test_episode_schema_dialogue_defaults.py`

- [ ] **Step 1: 断言反序列化缺省**

```python
def test_shot_missing_dialogue_fields_defaults():
    from models.schemas import Shot, ShotAsset
    s = Shot(
        shotId="a",
        shotNumber=1,
        imagePrompt="x",
        videoPrompt="y",
        firstFrame="frames/S001.png",
        assets=[],
    )
    assert s.dialogue == ""
    assert s.dialogueTranslation == ""
```

- [ ] **Step 2: pytest 通过并 commit**

---

### Task 4: Vidu — 生成请求中拼接对白（译文优先）

**Files:**
- Modify: `web/server/routes/generate.py`（所有传入 `shot.videoPrompt` 至 `vidu_service` 的分支）
- 可选新建: `web/server/services/prompt_compose.py`

**规则（可写单测）：**

```python
def append_dialogue_for_video_prompt(video_prompt: str, shot: Shot) -> str:
    """将译文对白块追加到视频提示词末尾（不删除原有内容）。"""
    chunk = (shot.dialogueTranslation or "").strip()
    if not chunk:
        return video_prompt
    block = f"\n\n[Dialogue for performance/lip-sync]\n{chunk}\n"
    if block.strip() in video_prompt:
        return video_prompt
    return (video_prompt or "").rstrip() + block
```

若产品要求「无译文则用原文注入」，将 `chunk` 改为 `(shot.dialogueTranslation or shot.dialogue).strip()`。

- [ ] **Step 1: 新建 `tests/test_prompt_compose.py` 测试三态：无译文、有译文、已包含块不重复**

- [ ] **Step 2: 在 `generate.py` 中每个调用视频生成处，将 `shot.videoPrompt` 换为 `append_dialogue_for_video_prompt(shot.videoPrompt, shot)`**

先用 `grep` 定位所有 `shot.videoPrompt` 传入点。

- [ ] **Step 3: pytest + commit**

---

### Task 5: 前端 — 分镜列表台词/译文列与剧集目标语

**Files:**
- Modify: `web/frontend/src/components/business/ShotPromptCells.tsx` 或 `ShotRow.tsx`
- Modify: `web/frontend/src/stores/episodeStore.ts` / `api/shots.ts`
- Modify: `web/frontend/src/pages/EpisodeListPage.tsx` 或 `StoryboardPage.tsx` 顶部栏 — 展示/编辑 `dubTargetLocale`（需 Episode PATCH API）

**若尚无 PATCH episode：** 在 `web/server/routes/episodes.py` 增加 `PATCH /episodes/{id}` 仅允许 `dubTargetLocale`、`sourceLocale`（与 `data_service.update_episode` 模式对齐，若不存在则新增最小实现）。

- [ ] **Step 1: 后端 Episode PATCH（若缺失）**

- [ ] **Step 2: 分镜行增加可编辑 `Input`：`dialogue`（只读可选若平台为准）、`dialogueTranslation`（可编辑）**

丙策略：**字幕导出用原文 `dialogue`**，UI 上标注「字幕原文」「配音/提示词译文」。

- [ ] **Step 3: 手动验证 PATCH 持久化 `episode.json`**

---

### Task 6: 配音 — TTS 默认文本

**Files:**
- Modify: `web/server/routes/dub_route.py`

在构建 `tts_text` 时：

```python
effective_tts = (tts_text or "").strip()
if not effective_tts:
    effective_tts = (getattr(shot, "dialogueTranslation", None) or "").strip()
```

若译文为空，**不**自动用 `dialogue` 填 TTS（避免语言错配）；保持现状或返回 400 提示「请先填写译文」。选后者时单测 `test_dub_tts_requires_translation_when_no_tts_text`。

- [ ] **Step 1: 单测 mock `data_service.get_shot` 返回带 `dialogueTranslation` 的 Shot**

- [ ] **Step 2: commit**

---

### Task 7: 剪映 — 原文 `TextSegment` 字幕轨

**Files:**
- Create: `web/server/services/jianying_text_track.py`
- Modify: `web/server/services/jianying_service.py` 中 `_write_jianying_draft_pyjdraft`

**实现要点：**

```python
from pyJianYingDraft.time_util import Timerange
from pyJianYingDraft.text_segment import TextSegment, TextStyle

def subtitle_lines_from_shot(shot: Shot) -> str:
    d = (shot.dialogue or "").strip()
    if d:
        return d
    if shot.associatedDialogue and (shot.associatedDialogue.content or shot.associatedDialogue.role):
        r = shot.associatedDialogue.role or ""
        c = shot.associatedDialogue.content or ""
        return f"{r}：{c}".strip("：") if r else c
    return ""
```

循环与 `_write_jianying_draft_pyjdraft` 中 `entries` **同一** `t_us` 累加逻辑：对每个 exportable 行，若 `subtitle_lines_from_shot(shot)` 非空，则 `TextSegment(text, Timerange(t_us, target_duration_us), style=TextStyle(size=8, align=1, auto_wrapping=True))`，收集 `segment.export_json()` 与 `segment.export_material()`。

将 `draft_info["materials"]["texts"]` 设为所有 text materials；新增 `text_track = _build_reference_track("text")`，`text_track["segments"] = [...]`，`draft_info["tracks"].append(text_track)`（**在 video 轨之后、或按剪映习惯 text 在最上**，与 pyJianYing `import_srt` 一致可参考 `script_file.py` 中 `relative_index=999`）。

- [ ] **Step 1: 单元测试：mock Shot + 最小 `draft_info`，断言 `materials["texts"]` 非空且 `tracks` 含 `type=="text"`**

- [ ] **Step 2: 实机导入剪映验证一条带字幕草稿**

- [ ] **Step 3: commit**

---

### Task 8: 文档与收尾

- [ ] **在 `docs/剪映与配音接入方案/接入方案.md` 末尾增加一小节「台词与字幕（2025-03）」：字段说明、丙策略、导出行为**

- [ ] **全量 `pytest` + 前端 `build`**

---

## Spec coverage（自检）

| 需求 | Task |
|------|------|
| Feeling 拉取台词 | 1, 2 |
| 目标语/译文持久化 | 2, 5, 6 |
| Vidu 提示词注入 | 4 |
| TTS 使用译文 | 6 |
| 剪映原文字幕 | 7 |
| 分镜可编辑 | 5 |

## Placeholder 扫描

无 TBD；剪映实现依赖 **pyJianYingDraft 已安装版本** 的 `TextSegment` API，若升级破坏 API，以该包 `text_segment.py` 为准调整 Task 7。

## 类型一致性

- JSON 键：`dialogue`, `associatedDialogue`, `dialogueTranslation`, `dubTargetLocale`, `sourceLocale` 在 TS 与 Pydantic 中保持一致。
- `associatedDialogue`：统一为 `{ role: string, content: string }` 或省略。

---

**Plan complete and saved to `docs/superpowers/plans/2025-03-26-dialogue-localization-jianying.md`.**

**执行方式任选：**

1. **Subagent-Driven（推荐）** — 每任务派生子代理，任务间人工/代理复核；需使用 **superpowers:subagent-driven-development**。
2. **Inline Execution** — 本会话内按任务执行；需使用 **superpowers:executing-plans**，并设检查点。

你希望采用哪一种？
