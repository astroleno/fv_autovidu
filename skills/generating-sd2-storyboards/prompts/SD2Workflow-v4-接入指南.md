# SD2Workflow v4 接入指南

**来源仓库**：`feeling_video_prompt/prompt/1_SD2Workflow/`
**同步日期**：2026-04-16
**权威合同**：`docs/SD2Workflow-v3.1-接口合同.md`（唯一执行基准）

---

## 一、目录结构

```
1_SD2Workflow/
├── 1_EditMap-SD2/
│   └── 1_EditMap-SD2-v4.md          ← 当前版本（v4）
├── 2_SD2Director/
│   └── 2_SD2Director-v4.md          ← 当前版本（v4）
├── 2_SD2Prompter/
│   └── 2_SD2Prompter-v4.md          ← 当前版本（v4）
├── 3_FewShotKnowledgeBase/
│   ├── 0_Retrieval-Contract-v2.md   ← FSKB 检索合同（受控词表在这里）
│   └── 1_Dialogue-v2.md ...         ← 各桶示例文件
├── 4_KnowledgeSlices/               ← v4 新增
│   ├── injection_map.yaml           ← 路由映射表
│   ├── director/
│   │   ├── structure_constraints.md ← 组结构硬约束（always 注入）
│   │   └── structure_fewshot.md     ← 组结构范式示例（条件注入）
│   └── prompter/
│       ├── iron_rules_full.md       ← 铁律合集（always 注入）
│       └── vertical_physical_rules.md ← 竖屏物理铁律（9:16 时注入）
├── docs/
│   └── SD2Workflow-v3.1-接口合同.md  ← 唯一执行基准
└── SD2Workflow-v4-接入指南.md        ← 本文档
```

## 二、v3 → v4 核心变更

| 变更 | 说明 |
|------|------|
| EditMap 职责收敛 | 不再输出光影基准/视觉增强/声画分离策略，只输出纯叙事信号 + 路由标签 |
| Director 独立设计 | 根据叙事信号 + 知识切片自行做镜头/光影/音效设计 |
| Prompter 铁律外移 | 铁律从 prompt 中移出为知识切片，通过编排层注入 |
| `block_index` 新增字段 | `scene_run_id`（并发调度）、`present_asset_ids`（资产子集）、`rhythm_tier`（节奏档位） |
| Director `continuity_out` | appendix 新增结构化连续性输出，编排层据此投影 prevBlockContext |
| Director Section Header | 冻结为 `## B{NN} \| {start}-{end}s \| {bucket}`，编排层正则切分 |
| 知识切片体系 | `4_KnowledgeSlices/` + `injection_map.yaml` 路由映射 |

## 三、编排层接入要点

### 3.1 调用顺序

```
EditMap（1 次调用，Opus 4.6）
  → 编排层拆分 + 注入
    → Director（按组调用，Qwen3.6-plus）
      → 编排层投影 prevBlockContext
        → Prompter（按组调用，轻量模型，全并发）
```

### 3.2 EditMap 调用

**System Prompt**：`1_EditMap-SD2-v4.md` 全文
**输入**：globalSynopsis + scriptContent + assetManifest + episodeDuration + 可选 directorBrief / referenceAssets
**输出**：`{ "markdown_body": "...", "appendix": {...} }`
**解析**：
- 用 `### 段落` 正则拆分 markdown_body 为组段落数组
- 读取 `appendix.block_index[]`，按 `scene_run_id` 分组

### 3.3 Director 调用（每组一次）

**System Prompt**：`2_SD2Director-v4.md` 全文 + 注入的知识切片
**知识切片注入**：读 `injection_map.yaml`，匹配条件后拼接到 system prompt 末尾
**输入参数**：

```typescript
interface DirectorInput {
  editMapParagraph: string;          // 当前组的 EditMap 段落
  blockIndex: BlockIndexEntry;       // 当前组的 block_index 条目
  assetTagMapping: AssetTagEntry[];  // 全局资产映射表
  parsedBrief: ParsedBrief;         // 画幅/风格/色调
  episodeForbiddenWords: ForbiddenWord[];
  knowledgeSlices: string[];         // 编排层拼接的知识切片 Markdown
  fewShotContext?: FewShotExample[]; // FSKB 示例
  prevBlockContext?: ContinuityOut;  // 前一组的连续性上下文
}
```

**并发规则**：
- 同一 `scene_run_id` 内 → **串行**（需要 prevBlockContext）
- 不同 `scene_run_id` → **可并发**
- 每组完成后提取 `appendix.continuity_out` → 构建下一组 `prevBlockContext`
- 若 `continuity_out.scene_exit_state == "cut"` → 下一组 `prevBlockContext = null`

### 3.4 Prompter 调用（每组一次，可全并发）

**System Prompt**：`2_SD2Prompter-v4.md` 全文 + 注入的知识切片
**输入参数**：

```typescript
interface PrompterInput {
  directorMarkdownSection: string;     // Director 单组分镜稿（按 ## B{NN} 切分）
  blockIndex: BlockIndexEntry;         // 含 present_asset_ids
  assetTagMapping: AssetTagEntry[];    // 全局资产映射表
  parsedBrief: ParsedBrief;
  episodeForbiddenWords: ForbiddenWord[];
  knowledgeSlices: string[];           // iron_rules_full 等
  fewShotContext?: FewShotExample[];
}
```

**`@图N` 重编号**：Prompter 基于 `blockIndex.present_asset_ids` 按顺序分配 Block 内编号（`@图1`、`@图2`...），不依赖文本匹配。

### 3.5 知识切片注入伪代码

```python
import yaml

def load_slices(consumer: str, block_index: dict, parsed_brief: dict) -> list[str]:
    """按 injection_map.yaml 加载知识切片"""
    with open("4_KnowledgeSlices/injection_map.yaml") as f:
        config = yaml.safe_load(f)

    slices = []
    consumer_config = config[consumer]

    # always 切片无条件加载
    for entry in consumer_config.get("always", []):
        slices.append(read_file(f"4_KnowledgeSlices/{entry['path']}"))

    # conditional 切片按路由标签匹配
    for entry in consumer_config.get("conditional", []):
        match = entry.get("match", {})
        if matches(match, block_index, parsed_brief):
            slices.append(read_file(f"4_KnowledgeSlices/{entry['path']}"))

    return slices

def matches(match: dict, block_index: dict, parsed_brief: dict) -> bool:
    """检查路由标签是否命中"""
    for key, condition in match.items():
        if key == "aspect_ratio":
            if parsed_brief.get("aspectRatio") != condition:
                return False
        elif key == "structural_tags":
            any_of = condition.get("any_of", [])
            if not set(any_of) & set(block_index.get("structural_tags", [])):
                return False
        elif key == "scene_bucket":
            if block_index.get("scene_bucket") != condition:
                return False
    return True
```

## 四、受控词表

所有路由标签必须使用 FSKB Retrieval Contract v2 中定义的受控词表：

- **scene_bucket**：`dialogue` / `emotion` / `reveal` / `action` / `transition` / `memory` / `spectacle` / `mixed`
- **structural_tags**：见 `3_FewShotKnowledgeBase/0_Retrieval-Contract-v2.md` 第 108-149 行
- **scene_archetype**：见同文档第 226-249 行

## 五、版本对应

| 组件 | 当前版本 | 文件 |
|------|---------|------|
| EditMap | **v4** | `1_EditMap-SD2-v4.md` |
| Director | **v4** | `2_SD2Director-v4.md` |
| Prompter | **v4** | `2_SD2Prompter-v4.md` |
| FSKB 合同 | v2 | `0_Retrieval-Contract-v2.md` |
| 接口合同 | v3.1 (冻结) | `SD2Workflow-v3.1-接口合同.md` |
| 知识切片 | P0 | `4_KnowledgeSlices/` |

v1-v3 文件保留供历史参考，**编排层只读 v4 文件**。
