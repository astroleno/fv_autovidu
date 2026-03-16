# scripts 脚本说明

## 目录结构

```
scripts/
├── README.md           # 本说明
├── run.sh              # 一键：裁剪 → 批量 i2v
├── run_full_test.py    # 完整测试：提交 → 轮询 → 下载
├── crop/               # 裁剪
│   └── crop_grid.py    # grid 裁为单格 (9:16 中心95%)
├── i2v/                # 图生视频
│   ├── batch.py        # 批量 i2v（prompt.txt）
│   ├── prompt_test.py  # 3×2 提示词对比（prompt.md）
│   └── selected_1080p.py # 选定任务固定种子 1080p
└── task/               # 任务管理
    ├── poll.py         # 轮询任务状态
    └── download.py     # 下载视频
```

## 常用命令

```bash
# 裁剪
python scripts/crop/crop_grid.py [--group group_01] [--max 3]

# 3×2 提示词测试（prompt.md）
python scripts/i2v/prompt_test.py [--model viduq3-pro] [--resolution 1080p] [--records s7/xxx.json]

# 选定任务 1080p 固定种子
python scripts/i2v/selected_1080p.py

# 轮询
python scripts/task/poll.py --records output/.../i2v_test_records.json

# 下载
python scripts/task/download.py --results output/.../poll_results.json --out-dir output/.../s7

# 完整流程
python scripts/run_full_test.py
./scripts/run.sh
```
