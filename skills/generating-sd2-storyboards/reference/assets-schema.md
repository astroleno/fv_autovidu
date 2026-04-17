# 资产列表 Schema

本 skill 要求 `--assets-file` 指向一份标准 JSON。若用户给的是自然语言，**Claude 先在对话层完成转写**，写到临时文件再传入。

## JSON 结构

顶层是一个数组，每项为一个资产对象。

```json
[
  {
    "name": "秦若岚",
    "type": "character",
    "description": "妇产科主任，知性短发，无框眼镜，白大褂，约 32 岁。"
  },
  {
    "name": "副院长办公室",
    "type": "scene",
    "description": "副院长私人办公室，窗明几净，深木办公桌，真皮椅。"
  },
  {
    "name": "诊断书",
    "type": "prop",
    "description": "白底 A4 医院诊断书，抬头印院方 logo。"
  }
]
```

## 字段说明

| 字段 | 必填 | 枚举 / 格式 | 作用 |
|------|------|-------------|------|
| `name` | 是 | 字符串，不能为空 | 资产名；与剧本里出现的名称一一对应 |
| `type` | 是 | `character` / `scene` / `prop` / `vfx` | 资产类型；决定 EditMap 的 manifest 分桶 |
| `description` | 否 | 字符串 | 视觉描述；缺省时用 `name` 兜底（质量会打折） |

## type 的判定规则

| type | 用于 | 触发词示例 |
|------|------|------------|
| `character` | 角色/人物 | "角色"、"人物"、"主角"、"反派" |
| `scene` | 场景/环境 | "场景"、"地点"、"走廊"、"办公室"、"内景"、"外景"、"房间" |
| `prop` | 道具 | "道具"、"物品"、"手机"、"证件" 等具体物件 |
| `vfx` | 视觉特效 | "特效"、"光效"、"粒子"、"爆炸" 等非实体元素 |

判不准时，优先按剧本里实际出现的"人还是物还是场地"判断。

## 自然语言 → JSON 的转写示例

### 示例 1：简洁描述

**用户输入**：
> 有两个角色：秦若岚（女主，妇产科主任）、赵凯（男反，副院长）；场景是医院走廊、副院长办公室；道具有诊断书、手机。

**Claude 转写输出**（写入 `/tmp/assets-<slug>.json`）：

```json
[
  { "name": "秦若岚", "type": "character", "description": "女主，妇产科主任。" },
  { "name": "赵凯", "type": "character", "description": "男反，副院长。" },
  { "name": "医院走廊", "type": "scene", "description": "医院走廊。" },
  { "name": "副院长办公室", "type": "scene", "description": "副院长办公室。" },
  { "name": "诊断书", "type": "prop", "description": "诊断书。" },
  { "name": "手机", "type": "prop", "description": "手机。" }
]
```

### 示例 2：只给名字

**用户输入**：
> 角色：秦若岚、赵凯、许倩；场景：医院走廊、副院长办公室。

**Claude 转写输出**：

```json
[
  { "name": "秦若岚", "type": "character", "description": "秦若岚" },
  { "name": "赵凯", "type": "character", "description": "赵凯" },
  { "name": "许倩", "type": "character", "description": "许倩" },
  { "name": "医院走廊", "type": "scene", "description": "医院走廊" },
  { "name": "副院长办公室", "type": "scene", "description": "副院长办公室" }
]
```

`description` 用名字兜底是可以的，但告诉用户"视觉描述缺失会影响分镜质量，建议补充"。

### 示例 3：已有现成 JSON

若用户直接贴 JSON 或给 `.json` 路径，**不要**改写，直接透传 `--assets-file`。

## 校验清单（Claude 转写前自查）

- [ ] 每个资产都有 `name` 和 `type`
- [ ] `type` 只用 4 个枚举值之一
- [ ] 同名资产去重（按 `name` 去重，保留 `description` 更长的那条）
- [ ] 至少 1 个 `character`（无角色的分镜无意义）
- [ ] 至少 1 个 `scene`（无场景的分镜无法分 Block）

不满足这 5 条时，回去问用户补齐，不要强行生成。

## 临时文件路径约定

写到 `/tmp/assets-<slug>-<timestamp>.json`，`<slug>` 与 `--slug` 保持一致，`<timestamp>` 避免并发冲突。执行完成后不需要删除，便于事后复盘。
