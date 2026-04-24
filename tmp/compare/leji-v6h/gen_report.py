"""生成 Doubao vs Qwen 对照报告（leji-v6h）。

运行：
    python3 tmp/compare/leji-v6h/gen_report.py > tmp/compare/leji-v6h/compare_doubao_vs_qwen.md

数据来源：
    output/sd2/leji-v6h        - Doubao (doubao_ark, doubao-seed-2-0-pro-260215)
    output/sd2/leji-v6h-qwen   - Qwen  (dashscope_qwen, qwen-plus)
两侧共用同一份 edit_map_sd2.json / normalized_script_package.json / edit_map_input.json，
仅 Stage 2/3 (Director + Prompter) 走不同后端，HOTFIX L/M/N/O/P/Q 全开无降级。
"""
from __future__ import annotations

import collections
import json
import os
from typing import Any


def load(path: str) -> dict:
    """读取 JSON 工具函数。"""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def gather(root: str) -> tuple[dict, dict, dict, dict, list[dict], dict]:
    """采集一个 run 的所有关键产物。

    返回：sd2_prompts_all, sd2_routing_trace, sd2_final_report, llm_trace,
    v6_hardgate_outcomes, per-code pass/fail 分布。
    """
    pr = load(os.path.join(root, "sd2_prompts_all.json"))
    rt = load(os.path.join(root, "sd2_routing_trace.json"))
    fr = load(os.path.join(root, "sd2_final_report.json"))
    llm = (pr.get("meta") or {}).get("llm_trace") or {}
    outcomes = rt.get("v6_hardgate_outcomes", [])
    dist: dict[str, collections.Counter] = collections.defaultdict(
        collections.Counter
    )
    for o in outcomes:
        dist[o.get("code", "?")][o.get("status", "?")] += 1
    return pr, rt, fr, llm, outcomes, dist


def total_shots(pr: dict) -> int:
    """统计所有 block 的 shot 总数。"""
    n = 0
    for b in pr.get("blocks", []):
        n += len((b.get("result") or {}).get("shots", []) or [])
    return n


def shots_per_block_hist(pr: dict) -> dict[int, int]:
    """shots/block 分布直方图。"""
    c: collections.Counter = collections.Counter()
    for b in pr.get("blocks", []):
        c[len((b.get("result") or {}).get("shots", []) or [])] += 1
    return dict(sorted(c.items()))


def shot_fields(pr: dict) -> list[str]:
    """采样前 5 个 block 的前 3 个 shot，采集 shot 对象字段集合。"""
    fields: set[str] = set()
    for b in pr.get("blocks", [])[:5]:
        for s in ((b.get("result") or {}).get("shots", []) or [])[:3]:
            fields.update(s.keys())
    return sorted(fields)


def fails_for_code(outs: list[dict], code: str) -> list[dict]:
    """过滤某条硬门的 fail 记录。"""
    return [o for o in outs if o.get("code") == code and o.get("status") == "fail"]


def partial_status(fr: dict) -> str | None:
    """读取 HOTFIX Q 的 partial.status。"""
    return (fr.get("meta", {}).get("partial", {}) or {}).get("status")


def file_stats(path: str) -> tuple[int, int]:
    """返回 (字节数, 行数)，文件不存在则返回 (0, 0)。"""
    try:
        size = os.path.getsize(path)
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = sum(1 for _ in f)
        return size, lines
    except OSError:
        return 0, 0


def render_line(s: str) -> None:
    """裸打印工具（避免 f-string 中反复出现引号嵌套）。"""
    print(s)


DOUBAO_ROOT = "output/sd2/leji-v6h"
QWEN_ROOT = "output/sd2/leji-v6h-qwen"


def main() -> None:
    """主渲染逻辑：按章节生成 Markdown。"""
    rd, _rt_d, fd, ld, od, dd = gather(DOUBAO_ROOT)
    rq, _rt_q, fq, lq, oq, dq = gather(QWEN_ROOT)

    render_line("# Doubao vs Qwen · leji-v6h 对照报告")
    render_line("")
    render_line(
        "> 对照条件：同一份 `edit_map_sd2.json` + `normalized_script_package.json` "
        "+ `edit_map_input.json`（leji-v6h 豆包轮次产出，两侧均 `--skip-editmap`）"
    )
    render_line(
        "> - Doubao: `provider={}`, `model={}`".format(
            ld.get("provider"), ld.get("model")
        )
    )
    render_line(
        "> - Qwen: `provider={}`, `model={}`".format(
            lq.get("provider"), lq.get("model")
        )
    )
    render_line("> - HOTFIX L/M/N/O/P/Q 全开，无降级 flag")
    render_line("")

    render_line("## 1 · 宏观产物一致性")
    render_line("")
    render_line("| 指标 | Doubao | Qwen |")
    render_line("|---|---|---|")
    render_line(
        "| blocks | {} | {} |".format(
            len(rd.get("blocks", [])), len(rq.get("blocks", []))
        )
    )
    render_line("| total shots | {} | {} |".format(total_shots(rd), total_shots(rq)))
    render_line(
        "| shots/block 分布 | `{}` | `{}` |".format(
            shots_per_block_hist(rd), shots_per_block_hist(rq)
        )
    )
    render_line(
        "| shot 对象字段 | `{}` | `{}` |".format(shot_fields(rd), shot_fields(rq))
    )
    render_line("")
    render_line("**关键结论**：")
    render_line(
        "- 两模型 Director 分镜结构**完全一致**（39 shots / 16 blocks / 同 "
        "shots-per-block 直方图）→ Director 阶段在这组输入上不是变量"
    )
    render_line(
        "- **Qwen 完整遵守 v6 新 schema**（`timecode` / `duration_sec` / "
        "`info_delta` / `five_stage_role`）；**Doubao 回退到 v5 旧 schema**"
        "（`start_sec` / `end_sec`），下游结构化消费时 qwen 零胶水代码，"
        "doubao 需额外解析"
    )
    render_line("")

    render_line("## 2 · v6 硬门通过/失败分布（全 16 block）")
    render_line("")
    focus: list[tuple[str, str, str]] = [
        ("director_segment_coverage", "Director · 段覆盖", ""),
        ("director_kva_coverage", "Director · KVA 覆盖", ""),
        ("director_info_density", "Director · 信息密度", ""),
        (
            "prompter_dialogue_fidelity",
            "Prompter · 对白保真（外部）",
            "**外部验证**，代码比对 SEG 实际是否落到 shot",
        ),
        (
            "prompter_self_dialogue_fidelity",
            "Prompter · 对白保真（自检）",
            "LLM 自评字段",
        ),
        (
            "prompter_self_segment_l2",
            "Prompter · 段覆盖 L2（自检）",
            "LLM 自评字段",
        ),
        (
            "prompter_self_segment_l3",
            "Prompter · 段覆盖 L3（自检）",
            "LLM 自评字段",
        ),
        (
            "prompter_self_kva_coverage",
            "Prompter · KVA 覆盖（自检）",
            "LLM 自评字段",
        ),
        (
            "max_dialogue_per_shot",
            "HOTFIX L · 每 shot 对白 ≤2",
            "本轮新增外部硬门",
        ),
        (
            "min_shots_per_block",
            "HOTFIX M · shots ≥ ceil(seg/4)",
            "本轮新增外部硬门",
        ),
        (
            "character_token_integrity",
            "HOTFIX N · 人名白名单",
            "本轮新增外部硬门",
        ),
    ]
    render_line("| 硬门 | Doubao (pass/fail) | Qwen (pass/fail) | 说明 |")
    render_line("|---|---:|---:|---|")
    for code, label, note in focus:
        d_pf = dd.get(code, {}) or {}
        q_pf = dq.get(code, {}) or {}
        render_line(
            "| {label} | {dp}/{df} | {qp}/{qf} | {note} |".format(
                label=label,
                dp=d_pf.get("pass", 0),
                df=d_pf.get("fail", 0),
                qp=q_pf.get("pass", 0),
                qf=q_pf.get("fail", 0),
                note=note,
            )
        )
    render_line("")
    render_line(
        "Pipeline 终态：Doubao=`{}`, Qwen=`{}`".format(
            partial_status(fd), partial_status(fq)
        )
    )
    render_line("")

    render_line("## 3 · 外部验证 · Prompter 对白保真 fail 细节")
    render_line("")
    for label, outs in (("Doubao", od), ("Qwen", oq)):
        fs = fails_for_code(outs, "prompter_dialogue_fidelity")
        render_line("### 3.{idx} {label} (fail {n})".format(
            idx=1 if label == "Doubao" else 2, label=label, n=len(fs)
        ))
        for o in fs:
            render_line(
                "- `{bid}` — {reason}".format(
                    bid=o.get("block_id"), reason=o.get("reason", "")
                )
            )
        render_line("")

    render_line("## 4 · HOTFIX N 人名白名单 fail 分析（观察模型书写风格差异）")
    render_line("")
    for label, outs in (("Doubao", od), ("Qwen", oq)):
        fs = fails_for_code(outs, "character_token_integrity")
        render_line("### {label} (fail {n})".format(label=label, n=len(fs)))
        for o in fs[:20]:
            det = o.get("detail", {}) or {}
            toks = det.get("unknown_tokens", []) or []
            render_line(
                "- `{bid}` · unknown_tokens=`{toks}`".format(
                    bid=o.get("block_id"), toks=",".join(toks)
                )
            )
        render_line("")

    render_line("**分析**：")
    render_line(
        "- Doubao 仅 1 次假阳性（`咬紧` / `眉心` — 顿号堆叠身体部位词被 "
        "CJK name-run 误判）"
    )
    render_line(
        "- Qwen 15/16 block 触发 → 几乎全部来自 `[BGM]` / `[SFX]` 段内的音效 / "
        "材质顿号串（`渐强、擦声、嗡鸣、瓷砖、金属 …`），**非人名幻觉**"
    )
    render_line(
        "- **书写风格差异**：Qwen 倾向把多个 SFX 元素用顿号串联，Doubao 倾向用句号 / "
        "逗号分句；本 gate 当前扫整段 `sd2_prompt`，对两种风格同用一把尺会误伤 qwen"
    )
    render_line(
        "- 本项不应被视作 Qwen 更差 —— 而是 gate 的一个已知假阳性模式；"
        "后续若需修，应做 `[BGM]` / `[SFX]` 段屏蔽或 stoplist 扩展，"
        "但**按用户要求本轮不做**（避免过拟合）"
    )
    render_line("")

    render_line("## 5 · 自评诚实度（对角线观察）")
    render_line("")
    render_line("| 指标 | Doubao | Qwen |")
    render_line("|---|---|---|")
    render_line("| prompter_self_segment_l2 pass | 16/16 | 6/16 |")
    render_line("| prompter_self_kva_coverage pass | 16/16 | 8/16 |")
    render_line("| prompter_dialogue_fidelity 外部 pass | 12/16 | 14/16 |")
    render_line("")
    render_line(
        "**观察**：Doubao 在 self_check 字段上**全填满分**（16/16），但外部验证的 "
        "dialogue_fidelity 仍 fail 4 次；Qwen 在自评上给出诚实的 0.14–0.67 小数，"
        "外部验证反而更好（fail 2）。"
    )
    render_line("")
    render_line(
        "**启示**：**Doubao 有自评虚高倾向**（倾向写 `coverage_ratio=1.0 pass=true`），"
        "Qwen 自评更贴近实际。外部硬门（`prompter_dialogue_fidelity` / "
        "`max_dialogue_per_shot` / `min_shots_per_block` / "
        "`character_token_integrity`）才是最终尺度。"
    )
    render_line("")

    render_line("## 6 · 资源与稳定性")
    render_line("")
    ds, dl = file_stats(os.path.join(DOUBAO_ROOT, "pipeline_run.log"))
    qs, ql = file_stats(os.path.join(QWEN_ROOT, "pipeline_run.log"))
    render_line(
        "- `pipeline_run.log`（HOTFIX O 生效）· Doubao={ds:,}B ({dl}行), "
        "Qwen={qs:,}B ({ql}行)".format(ds=ds, dl=dl, qs=qs, ql=ql)
    )
    render_line(
        "- `sd2_final_report`（HOTFIX Q 生效）· 两侧均生成；"
        "`meta.partial.status=ok`，block-chain 未过硬门不影响审计链落盘"
    )
    render_line(
        "- `_llm_trace`（HOTFIX P 生效）· 两侧每个 Bxx.json / sd2_payloads / "
        "sd2_routing_trace 全齐，provider / model 可审计"
    )
    render_line("")

    render_line("## 7 · 综合评价（同输入 · 同 hardgate 全开）")
    render_line("")
    render_line("| 维度 | Doubao pro | Qwen plus | 胜出方 |")
    render_line("|---|---|---|---|")
    render_line("| 结构一致性（分镜数 / 节奏） | ✓ | ✓ | 打平 |")
    render_line("| v6 schema 遵守度 | 旧 schema | 新 schema 完整 | **Qwen** |")
    render_line("| Director 段覆盖 | 15/16 pass | 13/16 pass | Doubao |")
    render_line("| Director KVA 覆盖 | 9/16 pass | 11/16 pass | Qwen |")
    render_line(
        "| Prompter 对白保真（外部） | 12/16 pass | 14/16 pass | **Qwen** |"
    )
    render_line(
        "| 自评诚实度 | 全填满分（虚高） | 给出实际比值 | **Qwen** |"
    )
    render_line(
        "| 人名 / token 白名单 | 1/16 fail（假阳性） | 15/16 fail"
        "（音效顿号假阳性） | — gate 对两种风格不对称 |"
    )
    render_line(
        "| 对白行上限守纪 | 16/16 pass | 16/16 pass | 打平（HOTFIX L 生效） |"
    )
    render_line("")

    render_line("## 8 · 建议")
    render_line("")
    render_line(
        "1. **不做定向修 gate**（按用户要求）：本次 `character_token_integrity` 对 "
        "qwen 的大量 fail 来自音效顿号堆叠风格不友好，不是真的人名幻觉；"
        "不改 gate，保留为『模型书写风格』的可观测指标"
    )
    render_line(
        "2. **模型选择**：就 v6 schema 遵守 / 对白外部保真 / 自评诚实这三条硬指标看，"
        "qwen-plus 优于 doubao-pro；但 Director KVA 覆盖上 qwen 略优、"
        "段覆盖上 doubao 略优，互有胜负"
    )
    render_line("3. **下一轮对比应**：")
    render_line(
        "   - 让 qwen 跑一遍**完整** pipeline（含 EditMap，而非跳过），看 qwen 的 "
        "EditMap 是否也会像 doubao 那样幻觉出 `SEG_063-SEG_072`"
    )
    render_line(
        "   - 增加一轮 `qwen-max` / `qwen3-max`（旗舰档）vs `doubao-pro` 公平对比，"
        "因为当前 qwen-plus 与 doubao-pro 并非同档"
    )
    render_line(
        "   - 不应为「让 doubao 看起来更好」去收紧 / 放松具体 gate（避免 Goodhart）"
    )


if __name__ == "__main__":
    main()
