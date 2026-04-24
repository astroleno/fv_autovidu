# v7 Autoresearch 质量迭代计划

> 目标：把 SD2Workflow 的迭代方式从“修一个问题跑一遍”升级为“固定真实样本 + 二元质量 eval + 单变量 mutation + keep/discard”的实验循环。评估对象是最终项目输出质量，不是工程通过率。

## 0. 当前基线

当前可用基线为：

- 真实输入：`output/sd2/leji-v6b-apimart-sa-doubao/edit_map_input.json`
- 输出目录：`output/sd2/leji-v7-actual-fixed/`
- 最终报告：`output/sd2/leji-v7-actual-fixed/sd2_final_report.md`
- 链路：`--skip-editmap` 后半链路完整运行，`Director -> Prompter -> hardgate -> final report`
- 当前结果：10 blocks / 63 frames / 120s
- 当前 hardgate：0 fail / 0 warn；仅保留不影响内容的 `psychology_group_synonym_fallback` 路由 warning

甲方分镜表只作为统计参照，不作为生成源：

- 甲方表：67 shots / 117.1s / avg 1.75s
- 当前输出：63 shots / 120s / avg 1.90s
- 禁止复制甲方镜头描述、镜号顺序、画面内容或对白拆法。

## 1. Autoresearch 方法迁移

借鉴 `autoresearch` skill 的核心循环，但优化对象从 skill prompt 改为 SD2 真实项目输出：

1. 固定测试输入集。
2. 固定二元 eval，不使用 1-10 分主观评分。
3. 每轮只改一个变量。
4. 每轮都完整跑链路，落盘 final report。
5. 对每个输出运行 eval。
6. 分数提升则 keep；持平或下降则 discard。
7. 记录 `results.tsv`、`results.json`、`changelog.md`，保留所有实验结论。

实验判断不能只看 hardgate。Hardgate 只保证合同未破，质量 eval 才判断是否“像短剧、节奏够不够、题材钩子是否有效”。

## 2. 固定测试集

第一期测试集至少 3 个，第二期扩到 5 个：

| Case | 类型 | 目的 | 输入 |
|---|---|---|---|
| C01 | 医疗婚恋背叛短剧 | 当前主线基准，防止回退 | `output/sd2/leji-v6b-apimart-sa-doubao/edit_map_input.json` |
| C02 | 高对白密度短剧 | 检查长对白拆句、对白保真、镜头节奏 | 待补一个 leji 高对白样本 |
| C03 | 强冲突/动作短剧 | 检查动作 beat 不被拍成静态对话 | 待补一个 leji 冲突样本 |
| C04 | 信息散、钩子弱脚本 | 检查 pipeline 是否能主动补结构，不丢主线 | 第二期补 |
| C05 | 结尾钩子弱脚本 | 检查 closing hook 强化能力 | 第二期补 |

所有 case 的输出必须写入独立实验目录：

```text
output/sd2/autoresearch-quality/runs/exp-XXX/<case_id>/
```

## 3. 二元 Eval 套件

每条 eval 只允许 yes/no。任何“差不多”“还行”都必须落成可检查条件。

| Eval | 问题 | Pass 条件 | Fail 条件 |
|---|---|---|---|
| E01 题材契合 | 输出是否明确按目标题材拍？ | 医院、夫妻、出轨/怀孕/手术/权力或利益交换等核心题材信号被可视化，并服务短剧冲突 | 拍成普通医疗、职场、文艺夫妻戏或泛化情绪片 |
| E02 节奏密度 | 镜头密度是否达到短剧节奏？ | 120s 输出在 55-70 shots；任意连续 3 个 shots 不得都是低信息静态镜头 | 少于 55 shots、超过 70 shots，或连续静态低信息 |
| E03 背叛证据 | 是否有足够可见证据锚点？ | 至少 8 个证据锚点：门缝、窥视、手机、腹部、衣领、扣子、病历/诊断书、办公室亲密动作、分屏等 | 证据只靠台词解释，画面没有物证 |
| E04 误会反差 | 女主误会和男反真相是否连续成立？ | B06-B10 或等价后半段同时成立“女主为爱冒险”和“男反为利益/小三布局” | 后半段只剩单线背叛，误会讽刺断裂 |
| E05 对白完整 | 关键对白是否保真？ | dialogue/vo/monologue 原文或合法拆句全部进入 `[DIALOG]`，不摘要化 | 漏关键句、改写语义、把对白哑剧化 |
| E06 非照抄 | 是否只借鉴统计，不复制甲方内容？ | 与参考表只在镜头密度/景别倾向上相似，画面描述来自原脚本生成 | 出现甲方镜头描述、镜号顺序或画面内容复刻 |

第一期 max score：

```text
3 cases * 6 evals = 18
```

进入 keep 的最低门槛：

- 总分必须高于当前 best。
- E05 和 E06 必须全 pass。
- Hardgate 不能出现 fail。

## 4. 实验变量池

每轮只允许选择一个变量，不允许多点同时改。

| 变量 | 变更范围 | 假设 | 风险 |
|---|---|---|---|
| V01 Director 题材语法 | `2_SD2Director-v6.md` / director user message | Director 更早把脚本映射成短剧证据链 | 过度夸张，医疗现实感下降 |
| V02 Prompter 证据锚点密度 | `2_SD2Prompter-v6.md` / prompter user message | final prompt 更少泛化表情，多出可拍物证 | 机械堆“门缝/手机/腹部” |
| V03 shotSlots 节奏分配 | `shot_slot_planner.mjs` | 高潮 block 1.5-1.8s 更贴短剧 | 过碎导致画面不可执行 |
| V04 Evidence Beat Allocator | 新增 pipeline 层派生字段 | 每 block 自动分配证据/反应/反差职责 | 结构变重，可能束缚模型 |
| V05 Judge-only Eval | 新增 eval harness，不影响生成 | 先稳定评分口径，再改生成 | 只能发现问题，不能直接提升 |
| V06 Closing Hook 强化 | Director/Prompter closing hook 局部规则 | B10/末段反差更狠 | 所有结尾都模板化分屏 |

## 5. 第一批实施计划

### Batch 1：记录计划与当前基线

产物：

- 新增本文档。
- 记录当前 `leji-v7-actual-fixed` 作为 baseline。
- 不改生成逻辑。

验证：

```bash
node scripts/sd2_pipeline/tests/test_prompter_shot_contract_v6.mjs
node scripts/sd2_pipeline/tests/test_shot_budget_derivation_v6.mjs
```

提交建议：

```bash
git add prompt/1_SD2Workflow/docs/v7/02_v7-autoresearch-quality-iteration-plan.md
git commit -m "docs: add v7 autoresearch quality iteration plan"
```

### Batch 2：质量 Eval Harness

产物：

- 新增 `scripts/sd2_pipeline/quality_autoresearch_eval.mjs`
- 新增 `scripts/sd2_pipeline/tests/test_quality_autoresearch_eval.mjs`
- 新增 `output/sd2/autoresearch-quality/README.md` 或 docs 说明，不提交实际 run 输出

最小功能：

- 输入 final report JSON。
- 输出每条 E01-E06 的 pass/fail 和 evidence。
- E02/E03/E05 先做确定性检查。
- E01/E04/E06 第一版允许人工 judge 字段，但必须落 JSON。

验证：

```bash
node scripts/sd2_pipeline/tests/test_quality_autoresearch_eval.mjs
node scripts/sd2_pipeline/quality_autoresearch_eval.mjs \
  --final-report output/sd2/leji-v7-actual-fixed/sd2_final_report.json
```

提交建议：

```bash
git add scripts/sd2_pipeline/quality_autoresearch_eval.mjs \
  scripts/sd2_pipeline/tests/test_quality_autoresearch_eval.mjs
git commit -m "feat: add sd2 autoresearch quality eval harness"
```

### Batch 3：实验 Runner 与日志

产物：

- 新增 `scripts/sd2_pipeline/run_quality_autoresearch.mjs`
- 生成但不提交：`output/sd2/autoresearch-quality/results.tsv`
- 生成但不提交：`output/sd2/autoresearch-quality/results.json`
- 生成但不提交：`output/sd2/autoresearch-quality/changelog.md`

最小功能：

- 读取 `cases.json` 和 `evals.json`
- 执行当前 pipeline 命令
- 跑 eval
- 写 results/changelog
- 不自动改 prompt；第一版只做 baseline runner

验证：

```bash
node scripts/sd2_pipeline/run_quality_autoresearch.mjs --baseline-only
```

提交建议：

```bash
git add scripts/sd2_pipeline/run_quality_autoresearch.mjs
git commit -m "feat: add sd2 quality autoresearch runner"
```

### Batch 4：第一轮 Mutation

优先顺序：

1. V05 Judge-only Eval：先稳定评分口径。
2. V02 Prompter 证据锚点密度：最可能提升实际观感，风险较低。
3. V01 Director 题材语法：如果 Prompter 后置修不动，再上游强化。
4. V03 shotSlots 节奏分配：只有当节奏仍慢时再动。

每次 mutation 必须写 changelog：

```markdown
## Experiment N - keep/discard

Change:
Hypothesis:
Cases:
Score:
Decision:
Remaining failures:
```

提交建议：

```bash
git add <one-variable-change-files> <tests>
git commit -m "exp: improve sd2 <specific-quality-axis>"
```

## 6. 当前已知风险

| 风险 | 说明 | 控制方式 |
|---|---|---|
| Eval 被模型投机 | 如果 eval 只查关键词，模型会堆关键词 | E03 关键词只做最低门槛，人工抽样检查证据是否服务剧情 |
| 过拟合当前边缘第一集 | 只跑一集会把规则调窄 | 第一批至少 3 个 leji case |
| 甲方表污染生成 | 参考表内容被误用为 source | E06 必须全 pass；任何 client alignment metadata 直接 fail |
| Prompt 越改越重 | 规则太多导致模型模板化 | 每轮只改一个变量，持平即 discard |
| Hardgate 与质量脱节 | 工程 pass 但实际不好看 | Hardgate 只作为必要条件，不作为质量分 |

## 7. 完成定义

第一期完成条件：

- 有 3 个真实 case。
- 有 E01-E06 eval 输出。
- baseline 结果可复现。
- 至少跑完 3 个 mutation experiments。
- 至少 1 个 mutation 被 keep，且总分提升。
- E05/E06 全 pass。
- `changelog.md` 能解释每次 keep/discard 的原因。

第二期完成条件：

- 测试集扩到 5 个 case。
- eval 尽量自动化，人工 judge 只保留在 E01/E04。
- 增加 dashboard，但 dashboard 只读 `results.json`，不参与评分。
- 对比当前 baseline，pass rate 稳定提升至少 15%。
