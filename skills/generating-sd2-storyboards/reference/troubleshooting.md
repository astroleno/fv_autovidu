# 失败排查

## 退出码速查

| exit code | 常见原因 | 下一步 |
|-----------|----------|--------|
| `2` | 输入 Schema 不合法 | 把错误原样回给用户并要求修正 |
| `3` | 两次 LLM 调用都失败 | 按下文"症状定位"排查 |
| `4` | 前置条件缺失 | 检查 `.env` 与工作目录 |
| `1` | 其它未知错误 | 读日志尾部 50 行给用户 |

## 症状定位

### 1. `edit_map_sd2.json` 文件末尾 `...` 或 JSON 解析失败

**原因**：Opus thinking 模式下 token 被占满，输出被截断。

**自动处理**：`generate.mjs` 第 2 次重试会自动 `--no-thinking` + 把 `YUNWU_EDITMAP_MAX_TOKENS` 提到 48000。

**两次仍失败**：
- 看日志里的 `response_text` 长度，若 > 40000 说明 brief 太复杂，劝用户精简
- 或者手动在 `.env` 加 `YUNWU_EDITMAP_MAX_TOKENS=64000` 后**用 `run_sd2_pipeline` 直接重跑**（不再走本 skill）

### 2. `sd2_final_report.json` 存在但 Block 数少于预期

**原因**：EditMap 按时长自动决定 Block 数；一般 15 秒一个 Block，但算法有下限 4、上限 12。

**处置**：若用户一定要更多 Block，在 brief 里加 `目标 Block 数 8` 或用流水线的 `--target-block-count 8` 直接重跑。

### 3. 某个 Block 的 `sd2_prompt` 为空

**原因**：Prompter 对单 Block 的调用失败（通常是网络或 rate limit）。

**自动处理**：`generate.mjs` 不会自动补跑单 Block（链路太碎，容易引入不一致）。

**人工处置**：
```bash
node scripts/sd2_pipeline/run_sd2_pipeline.mjs \
  --edit-map-input output/sd2/<slug>/edit_map_input.json \
  --episode-json output/sd2/<slug>/episode.json \
  --output-dir output/sd2/<slug> \
  --sd2-version v4 --yunwu \
  --block B0X \
  --skip-editmap --skip-director
```

### 4. `YUNWU_API_KEY` 或 `DASHSCOPE_API_KEY` 缺失

**原因**：`.env` 未配置或仓库根目录不对。

**处置**：让用户检查仓库根下 `.env` 文件，必要时从 `.env.example` 复制。

### 5. 运行超过 20 分钟没结束

**原因**：`generate.mjs` 的 `PIPELINE_TIMEOUT_MS = 20min` 触发强制中止。

**处置**：
- 检查 `.env` 的 `YUNWU_BASE_URL` 是否可达
- 看 `output/sd2/<slug>/` 里已有产物到哪一步（`edit_map_sd2.json` 存在则说明 EditMap 已过，卡在 Block 链）
- 若卡在 Block 链，可以 `--skip-editmap --skip-director` 后单跑 Prompter 那一段

### 6. 产物目录为空

**原因**：前置条件检查（exit 4）已经退出，或 `--slug` 写法非法。

**处置**：看日志头部的前置条件报错信息。

## 日志与调试

- 完整运行日志 `generate.mjs` 会把 `run_sd2_pipeline` 的 stdout/stderr 透传
- 想保留日志文件：让用户手动用 `tee`：
  ```bash
  node skills/generating-sd2-storyboards/scripts/generate.mjs ... \
    2>&1 | tee output/sd2/<slug>/generate.log
  ```
- 关键产物的体检可以肉眼对照 [output-layout.md](output-layout.md) 的清单

## 何时升级为人工介入

下列情况 Claude 应停止自动重试，直接让用户自己接管：

1. 两次自动重试都失败
2. 用户反馈生成结果与 brief 严重不符（这是提示词问题，不是流水线问题）
3. 用户想改 `prompt/1_SD2Workflow/` 下的 system prompt（超出本 skill 范围）
