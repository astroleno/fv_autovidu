# 尾帧生成资产图

将角色/道具参考图放在此目录，供 `gen_tail.py` 在生成尾帧时附加到 yunwu API。

## 命名约定

- 文件名 = `{资产名}.png`，例如：`达里尔.png`、`格雷·金斯顿.png`
- 资产名来自 `assets_by_shot.json`（由 `scripts/endframe/extract_assets.py` 从 raw.txt 提取）

## 当前需要的资产列表

运行 `python scripts/endframe/extract_assets.py --list-unique` 可获取完整列表。

MVP 阶段每个 shot 最多附加 2 张资产图，优先使用首帧中不完整/未出现的关键角色或道具。
