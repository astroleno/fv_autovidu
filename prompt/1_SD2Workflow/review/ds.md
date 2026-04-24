deepseek1

好，这套 prompt 我仔细看完了。先说结论：**这是一个设计相当成熟的 pipeline，核心思路清晰，数据流和职责边界定义得很严格，上下游契约设计得很有章法。** 特别是 v7 把 EditMap 拆成 L1 (pure_md) + L2 (translator) 这一步，解决了一个很实际的工程痛点——一个模型又要做创作分析又要做 schema 填表，很容易两头不讨好。

不过，逻辑链路跑通是一回事，实际跑起来稳不稳是另一回事。以下是我发现的几个比较关键的风险点和设计上的张力，按严重程度排列：

---

### 1. Stage 0 的 `dialogue_char_count` 是一个潜在“地雷”

**问题：** `ScriptNormalizer-v2.md` 要求 LLM **手动计算**对白字数，而且规则很细：CJK 算 1，ASCII 1-7 算 1/4 取整，还要去括号、去说话人前缀。

**风险：** 这是典型的“让人做机器的事”。LLM 在 token 层面对字符计数天然不准，尤其是在中英混排、标点复杂的短剧剧本里。现在这个 `dialogue_char_count` 是下游 EditMap 推 `info_density_contract` 的入参（`README.md` 说的），但计数字段本身就不可靠，等于把地基建在了沙子上。

**建议：**
- **直接在 pipeline 代码里用脚本算。** 这比让 LLM 算既准又便宜。
- 如果非让 LLM 给，那它在 Normalizer 里只能是个**参考值**，下游对它要有容错，不要拿来当硬门入参。
- 或者，Normalizer 只负责给 `segments[]` 正文，下游让代码去补 `dialogue_char_count`，从数据流上看更干净。

---

### 2. Scene Architect 的微调范围可能太“细”了

**问题：** `1_5_SceneArchitect-v1.md` 允许对 `rhythm_timeline` 做 ±3 秒的微调。这很合理，但它在当前链路上有一个深层矛盾：

- `3s` 对一部 120s 的短剧来说不短（占 2.5% 片长），足以改变一个 mini_climax 的落点。
- 但 Scene Architect 看到的是**精简后的** `segments_compact`（`text_first_40`，只取前 40 字）。

**风险：** 让一个 LLM 基于“只看到前 40 字”的上下文，去微调一个在 120s 意义上很敏感的秒数，这是个信息量不对称的决策。它很可能把爆点调到一个精确但不正确的秒数上，只是因为前 40 字让它这样觉得。

**建议：**
- 在 `segments_compact` 里，对于被标记为 `trigger_source_seg_id` 的关键 seg，**保留完整 `text`**，而不是截断到 40 字。这能保证微调决策的信息基础是完整的。token 成本增加有限，但决策质量会好很多。

---

### 3. KVA 消费的校验链路有“断层”

**问题：** 整个系统对 KVA (Key Visual Action) 的重视程度很高，但校验是“事后”的。

**数据流现状：**
- **Normalizer** 抽取 KVA，并写 `forbidden_replacement` (告诉下游“不能怎样”)
- **Scene Architect** 编排 KVA，给 `suggested_block_id` 和 `suggested_shot_role`
- **Director** 必须消费 P0 KVA，并写 `kva_consumption_report`
- **Prompter** 做最终 `kva_visualization_check`，做最后的硬门校验

**风险：** 如果 Prompter 这里 `kva_visualization_check` 失败了，需要回滚。但 Director 当时是拿着自己写的 `kva_consumption_report`（自己说自己消费了）往下走的。Prompter 是最后一个环节，它发现“画面描述没命中”时，问题真正出在 Director 的镜头设计上，而不是 Prompter 的编译上。

这会导致一个**责任归属不清的断点**：回滚应该找 Director 重新设计镜头，还是只让 Prompter 改写画面描述？

**建议：**
- **在 Director 的 prompt 里，把 `kva_consumption_report` 和它对应 shot 的画面描述做一个“预对齐”硬门。** 比如加一条规则：“若 `kva_consumption_report` 声称第 3 镜消费了 `signature_entrance`，则第 3 镜的画面描述必须显式包含 `required_structure_hints` 的语义（如低仰、pan_up）。”
- 这样做的目的是把校验前移，问题在 Director 这一层就暴露出来，而不是等到 Prompter 编译完才发现画面根本没拍那个动作。

---

### 4. `injection_map.yaml` 匹配逻辑的隐含风险

**问题：**
```yaml
match:
  has_kva:
    equals: true
```
这里的 `has_kva` 是 pipeline 编排层根据 `scriptChunk.key_visual_actions.length > 0` 派生的。

**风险 1（边界情况）**：如果一个 block 里的 KVA 全是 P1（低优先级，允许 warning），`has_kva` 依然为 `true`，v6_kva_examples 切片会被注入。但这个切片的设计意图是教 Director 如何处理高优先级的 P0 KVA。在只有 P1 的场景下注入，可能会误导 Director 过度使用 KVA 正反例里的高优先级处理模式。

**风险 2（跨 block 的 KVA）**：Normalizer 明确写了：“跨 beat 触发的 KVA 归属到第一次出现关键词的 beat”。这意味着存在一种情况：B01 有一个 `signature_entrance` KVA 归到这里，但画面更好地落在 B02。Scene Architect 把它的 `suggested_block_id` 改成了 B02，但 `has_kva` 在 pipeline 构造 B01 payload 时就已经设为 `true` 了，B02 反而可能是 `false`（如果它自己没有 KVA）。这会导致知识注入错位。

**建议：**
- **在编排层构造 `has_kva` 时，同步参考 Scene Architect 的 `suggested_block_id`**。如果某 KVA 的 `suggested_block_id` 已经指向另一个 block，那当前 block 的 `has_kva` 应为 `false`。
- 或者更彻底地，把 `has_kva` 的判断从“这个 block 包含什么 KVA”改成“这个 block 被建议消费什么 KVA”，以后者为准。

---

### 5. v7 战略正确，但数据流文档可以更“硬”

**积极评价：** `1_EditMap-v7.md` 的设计非常好。
- “权威台账 + 导演说明”的分离解决了旧版的问题。
- “同一个事实只出现一次”是好的去冗余原则。
- “block 数可以大于 seg 数，但细分靠复用而非造新 seg”这一条，说明对并发链路保护有深入考虑。
- L1 (pure_md) 和 L2 (translator) 的分拆，是架构上的明智之举。

**潜在风险：** L1 输出的 `pure_md` 是 LLM 生成的自由文本，它的格式一致性依赖 prompt 的约束力。即使有严格的规范（如 `# Block Ledger` 下的键值格式），LLM 也可能在极端情况下产出格式漂移的 markdown（比如 `time：0-10` 用了全角冒号，或者 `present_assets` 多了空格）。

**建议：**
- **在 L2 Translator 里，或者更理想的是在 pipeline 代码层，加一个轻量级的 `pure_md` 格式校验。** 在调用 Translator 之前，先用正则扫一遍每个 `## Bxx` 的键值行格式。发现格式错误时，让 L1 重试，而不是让 Translator 去硬猜格式漂移的文本。这能显著降低链路失败率。
- `README.md` 里提到的 `meta.style_inference.genre_bias.value` 缺失的软警告，就是一个信号——严谨的数据流需要这种格式校验来兜底。

---

**总结一下：**

整体架构没问题，v7 的 ledger-first 分拆是点睛之笔。但在**对白字数计算**（让代码做）、**Scene Architect 的决策信息量**（给完整原文）、**KVA 跨层校验的前置**（Director 内自检）和 **knowledge injection 匹配逻辑的边界情况**（考虑跨 block 的 KVA）这四点，是当前最需要加固的地方。这些地方如果出问题，不是设计思路的问题，而是“最后一公里”的工程落地细节，但恰恰是这些细节会决定 pipeline 成品率的实际天花板。