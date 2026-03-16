# fv_autovidu

基于 Vidu i2v（图生视频）API 的分镜批量生成工具。将分镜包中的 grid 图裁剪成单格，以首帧形式批量提交 i2v 任务。

## 项目结构

```
fv_autovidu/
├── config/default.yaml      # 模型、路径等配置
├── scripts/
│   ├── crop/crop_grid.py    # 裁剪 grid.png → 单格
│   ├── i2v/
│   │   ├── batch.py         # 批量 i2v（prompt.txt）
│   │   ├── prompt_test.py   # 3×2 提示词对比（prompt.md）
│   │   └── selected_1080p.py
│   ├── task/
│   │   ├── poll.py          # 轮询任务
│   │   └── download.py      # 下载视频
│   ├── run_full_test.py     # 完整测试：提交→轮询→下载
│   └── run.sh               # 一键：裁剪 → i2v
├── src/vidu/                # Vidu API 客户端
├── public/img/shot/         # 分镜包
├── output/frames/            # 裁剪输出
├── requirements.txt
└── .env.example
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置 API Key

```bash
cp .env.example .env
# 编辑 .env，填入 VIDU_API_KEY
```

### 3. 执行

**方式一：分步执行**

```bash
# 裁剪分镜 grid 为单格
python scripts/crop/crop_grid.py

# 批量提交 i2v（预览不调用 API）
python scripts/i2v/batch.py --dry-run

# 正式提交
python scripts/i2v/batch.py
```

**方式二：一键执行**

```bash
chmod +x scripts/run.sh
./scripts/run.sh
```

## 分镜包格式

每个 group 目录需包含：

- `grid.png`：多格拼接图，按 prompt 场景数自动推断行列裁剪
- `prompt.txt`：场景描述，格式 `S1:xxx`、`S2:xxx` ...

## 配置说明

见 `config/default.yaml` 及 [docs/vidu/i2v.md](docs/vidu/i2v.md)。
