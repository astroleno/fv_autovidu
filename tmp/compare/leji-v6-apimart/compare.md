# leji-v6-apimart · 豆包 vs 千问 对照报告

> 背景：EditMap 由 **APIMart · claude-opus-4-6-thinking**（Anthropic Messages API）生成一次，
> 随后 Director + Prompter 两路并发（互不干扰、独立进程、独立网关）共用该 EditMap。
> 两路均为 v6 pipeline，`--skip-editmap --no-normalizer`（Stage 0 产物复用），
> `--stagger-ms 100`，block 间全 fan-out 并发。

## 运行参数

| 维度             | 豆包 (Ark)                                | 千问 (DashScope)                         |
| ---------------- | ----------------------------------------- | ---------------------------------------- |
| 入口脚本         | `call_sd2_block_chain_v6_doubao.mjs`      | `call_sd2_block_chain_v6.mjs`            |
| 模型             | `doubao-seed-2-0-pro-260215`              | `qwen-plus`                              |
| Base URL         | `https://ark.cn-beijing.volces.com/api/v3`| `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `json_fmt_disabled` | true                                   | false                                    |
| `max_out`        | 65536                                     | null（default）                          |
| 输出目录         | `output/sd2/leji-v6-apimart-doubao/`      | `output/sd2/leji-v6-apimart-qwen/`       |

## 耗时

| 路线   | 启动             | 结束（final_report 落盘） | 总计   |
| ------ | ---------------- | ------------------------- | ------ |
| 千问   | 08:25:37.626Z    | 08:26:50.525Z             | ~73 s  |
| 豆包   | 08:30:12.943Z    | 08:33:06.847Z             | ~174 s |

共用 EditMap 源：`output/sd2/leji-v6-apimart/edit_map_sd2.json`（APIMart · 12m08s 生成，此处直接复用，零 LLM 重跑）。

## 硬门与路由审计

| 指标                     | 豆包 | 千问 | 差（千问-豆包） |
| ------------------------ | ---- | ---- | --------------- |
| v6 硬门失败项数          | 14   | 50   | +36             |
| 路由审计 warnings        | 30   | 66   | +36             |
| 路由审计 info            | 226  | 190  | −36             |

### 失败项按类型聚合

| 失败类型                         | 豆包 | 千问 |
| -------------------------------- | ---- | ---- |
| `prompter_dialogue_fidelity`     | 4    | 2    |
| `director_kva_coverage`          | 4    | 7    |
| `character_token_integrity`      | 3    | 13   |
| `director_segment_coverage`      | 2    | 4    |
| `director_info_density`          | 1    | 0    |
| `prompter_self_rhythm_density`   | 0    | 5    |
| `prompter_self_five_stage`       | 0    | 5    |
| `prompter_self_kva_coverage`     | 0    | 3    |
| `min_shots_per_block`            | 0    | 1    |

### 观察

1. **千问最大痛点仍是 `character_token_integrity` (13 项 fail)** — 之前 HOTFIX N（人名白名单）
   就是为了抓这种越界幻觉（qwen-plus 会在 Prompter 里凭空写出 asset 白名单外的角色名）。
   豆包同项只有 3 项，差距显著。
2. **千问的 Prompter 自检（rhythm_density / five_stage / kva_coverage）大量 fail** — 豆包全 pass。
   说明 qwen-plus 写出的 shot.sd2_prompt 结构信息量不够 / 节拍不明晰，
   Prompter 自检直接判定"不满足 v6 五幕锚 / 节奏密度"。
3. **豆包的 `prompter_dialogue_fidelity` 反而比千问多 2 项 fail** — 典型 `missing seg_ids`
   出现在 B12（SEG_046, SEG_049）。这是豆包偶发漏把对白挂到正确 shot 的毛病；
   但因为豆包整体 coverage 高，绝对问题量仍然比千问少。

## 产物清单

两路各自齐全：
```
edit_map_sd2.json（共用 APIMart 产物 + block chain 注解 routing.psychology_group）
sd2_director_payloads.json
sd2_director_all.json
sd2_prompts_all.json
sd2_payloads.json
sd2_final_report.{json,md}
sd2_routing_trace.json（含 llm_trace 审计链）
pipeline_run.log
```

## 结论

- **EditMap 共享策略有效**：一次 APIMart Opus 4.6-thinking 调用即可给两条下游复用，
  下游耗时仅决定于 Director/Prompter 两段。
- **豆包 v6 硬门失败数 ≈ 千问的 1/3.5**，与历史 leji-v6h vs leji-v6h-qwen 趋势一致；
  字符白名单（HOTFIX N）仍是拉开两家差距的主要门。
- 并发策略（`--stagger-ms 100`，block 全 fan-out）两路均无限流/重试日志，互不干扰。
