# 产物目录布局

执行成功后，`output/sd2/<slug>/` 下会有以下文件：

## 文件清单

| 路径 | 类型 | 重要性 | 说明 |
|------|------|--------|------|
| `sd2_final_report.md` | Markdown | ★★★ | **最终交付物**，人类可读分镜报告 |
| `sd2_final_report.json` | JSON | ★★★ | 同上的机器可读版（含 summary） |
| `edit_map_input.json` | JSON | ★★ | EditMap 输入快照（用于事后复盘） |
| `edit_map_sd2.json` | JSON | ★★ | EditMap 输出（Block 划分 + 时长分配） |
| `sd2_director_payloads.json` | JSON | ★ | Director 输入快照 |
| `sd2_director_all.json` | JSON | ★ | Director 输出汇总 |
| `sd2_payloads.json` | JSON | ★ | Prompter 输入快照 |
| `sd2_prompts_all.json` | JSON | ★ | Prompter 输出汇总 |
| `director_prompts/B01.json … BNN.json` | JSON 目录 | ★ | 每 Block Director 请求快照 |
| `prompts/B01.json … BNN.json` | JSON 目录 | ★ | 每 Block Prompter 请求快照 |
| `episode.json` | JSON | - | 最小 episode stub，仅含 episodeId |

## 汇报时需要读取的字段

成功执行后，Claude 从 `sd2_final_report.json` 读出以下字段回给用户：

```jsonc
{
  "summary": {
    "blockCount": 8,              // 总 Block 数
    "totalDurationSec": 120,      // 总时长
    "genre": "sweet_romance",     // 题材
    "renderingStyle": "真人电影",  // 风格
    "blocks": [/* 每 Block 的 id/title/duration */]
  }
}
```

汇报模板（Claude 输出给用户）：

```
✅ 分镜生成完成

📂 产物目录：output/sd2/<slug>/
📄 Markdown 报告：output/sd2/<slug>/sd2_final_report.md
📊 共 8 个 Block，总时长 120 秒
🎬 题材 / 风格：都市情感 / 真人电影

建议先打开 Markdown 报告通读一遍再进下游。
```

数字和风格以 `sd2_final_report.json` 为准。

## 事后复盘入口

- **改 Prompter 提示词后重跑**：用流水线脚本 `--skip-editmap --skip-director`
- **某个 Block 需要补跑**：`--block BXX --skip-editmap --skip-director`
- **改了 brief 想对比**：换一个 `--slug` 重跑，保留两次结果做 diff
