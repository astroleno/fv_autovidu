# v6 · 节奏模板库（EditMap 知识切片）

> 静态拼接 · 由 `call_editmap_sd2_v6.mjs` 直接 `fs.readdirSync('editmap/')` 拼入 EditMap system prompt（不登记为 consumer，不占 `max_total_tokens_per_consumer` 预算）。
> 对应任务：T13（rhythm_timeline 推导） / T14（五段式 + 三选一） / T15（信息密度阈值）。

---

## 0 · 使用方式

EditMap 在完成 §0.7 `style_inference` 之后，读 `meta.style_inference.genre_bias.primary` 路由到以下 5 个模板之一（primary 为 `mixed` 时取 `confidence` 最高的一项；并列时按 whitelist 顺序：`short_drama_contrast_hook > mystery_investigative > artistic_psychological > slow_burn_longform > satisfaction_density_first`）。

模板只给出 **"信息密度基线 + 节拍锚点 + 五段式权重 + 三选一偏好"** 四件事；具体 block_id 由 `mini_climax_slot_formula / major_climax_slot_formula / closing_hook_slot_formula` 计算得出。

**index 约定（避免歧义）**：公式里的返回值都是 **1-based block_id 序号**（即 `1` → `B01`，`total_blocks` → 最后一个 block）；`floor` / `ceil` / 运算结果若超界，见 §6 边界规则。

---

## 1 · `short_drama_contrast_hook`（短剧反差钩子）

**画像**：女频 / 强对比 / 高饱和爽点 / 10–90 秒短剧。

```jsonc
{
  "template_id": "short_drama_contrast_hook",
  "info_density_contract": {
    "min_info_points_per_5s": 1,
    "max_none_ratio": 0.15,
    "dialogue_char_per_second_max": 12
  },
  "golden_open_3s": {
    "required": true,
    "required_elements_any_of": ["signature_entrance","status_reveal","split_screen_trigger"]
  },
  "mini_climaxes_target_count": 3,
  "mini_climax_slot_formula": "floor(total_blocks / 4 × {1,2,3})",
  "five_stage_weights": { "trigger":1, "amplify":1, "pivot":1, "payoff":2, "residue":1 },
  "major_climax_slot_formula": "total_blocks - 1",
  "major_climax_strategy_preference": ["evidence_drop","identity_reveal"],
  "closing_hook_slot_formula": "total_blocks",
  "closing_hook_elements_any_of": ["freeze_frame","split_screen","cliff_sentence"]
}
```

**心法**：每 mini_climax 都要有外部反转（身份/证据/关系翻牌），不要纯内心戏 mini_climax。短剧主爆点紧邻 closing_hook（倒数第二块），观众看完爆点立刻被定格钩子抓住。

---

## 2 · `satisfaction_density_first`（男频爽点密度）

**画像**：男频 / 爽感优先 / 升级流 / 打脸流。

```jsonc
{
  "template_id": "satisfaction_density_first",
  "info_density_contract": {
    "min_info_points_per_5s": 1,
    "max_none_ratio": 0.10,
    "dialogue_char_per_second_max": 14
  },
  "golden_open_3s": { "required": true,
    "required_elements_any_of": ["ability_visualized","status_reveal"] },
  "mini_climaxes_target_count": 4,
  "mini_climax_slot_formula": "floor(total_blocks / 5 × {1,2,3,4})",
  "five_stage_weights": { "trigger":1, "amplify":1, "pivot":1, "payoff":3, "residue":1 },
  "major_climax_slot_formula": "total_blocks - 1",
  "major_climax_strategy_preference": ["ability_visualized","identity_reveal"],
  "closing_hook_slot_formula": "total_blocks",
  "closing_hook_elements_any_of": ["freeze_frame","cliff_sentence"]
}
```

**心法**：payoff 权重高，单个爽点的"兑现 shot"至少 2 个。

---

## 3 · `mystery_investigative`（悬疑 / 推理 / 断案）

**画像**：谜题驱动 / 信息差 / 证据链。

```jsonc
{
  "template_id": "mystery_investigative",
  "info_density_contract": {
    "min_info_points_per_5s": 1,
    "max_none_ratio": 0.20,
    "dialogue_char_per_second_max": 11
  },
  "golden_open_3s": { "required": true,
    "required_elements_any_of": ["evidence_drop","freeze_frame_hook"] },
  "mini_climaxes_target_count": 3,
  "mini_climax_slot_formula": "floor(total_blocks / 4 × {1,2,3})",
  "five_stage_weights": { "trigger":1, "amplify":2, "pivot":2, "payoff":1, "residue":1 },
  "major_climax_slot_formula": "total_blocks - 1",
  "major_climax_strategy_preference": ["evidence_drop"],
  "closing_hook_slot_formula": "total_blocks",
  "closing_hook_elements_any_of": ["freeze_frame","cliff_sentence"]
}
```

**心法**：amplify + pivot 权重高，留给观众"自己推"的时间；payoff 不过度解释。

---

## 4 · `artistic_psychological`（艺术 / 心理向）

**画像**：人物弧光优先 / 内心戏 / 允许留白。

```jsonc
{
  "template_id": "artistic_psychological",
  "info_density_contract": {
    "min_info_points_per_5s": 1,
    "max_none_ratio": 0.25,
    "dialogue_char_per_second_max": 9
  },
  "golden_open_3s": { "required": false,
    "required_elements_any_of": [] },
  "mini_climaxes_target_count": 2,
  "mini_climax_slot_formula": "floor(total_blocks / 3 × {1,2})",
  "five_stage_weights": { "trigger":1, "amplify":1, "pivot":2, "payoff":1, "residue":2 },
  "major_climax_slot_formula": "total_blocks - 1",
  "major_climax_strategy_preference": ["ability_visualized"],
  "closing_hook_slot_formula": "total_blocks",
  "closing_hook_elements_any_of": ["freeze_frame"]
}
```

**心法**：residue 权重高，允许微表情密度高但仍要 5s 至少 1 个 info_delta。

---

## 5 · `slow_burn_longform`（慢热 / 长剧）

**画像**：分集累积 / 单集节奏平缓 / 依赖世界观搭建。

```jsonc
{
  "template_id": "slow_burn_longform",
  "info_density_contract": {
    "min_info_points_per_5s": 1,
    "max_none_ratio": 0.30,
    "dialogue_char_per_second_max": 10
  },
  "golden_open_3s": { "required": false, "required_elements_any_of": [] },
  "mini_climaxes_target_count": 2,
  "mini_climax_slot_formula": "floor(total_blocks / 3 × {1,2})",
  "five_stage_weights": { "trigger":1, "amplify":1, "pivot":1, "payoff":1, "residue":1 },
  "major_climax_slot_formula": "total_blocks - 1",
  "major_climax_strategy_preference": ["identity_reveal","evidence_drop","ability_visualized"],
  "closing_hook_slot_formula": "total_blocks",
  "closing_hook_elements_any_of": ["cliff_sentence"]
}
```

**心法**：五段式均衡；major_climax 允许 `strategy == null`（无强信号不硬造）。慢热剧的 major_climax 与 closing_hook 不强行拉开距离，但至少 major_climax 的 block 要有完整五段式，closing_hook 的 block 只要求悬念句。

---

## 6 · 公式符号 & 边界规则

- `total_blocks` = `block_index.length`（EditMap 本次产出的 block 总数）
- 返回值均为 **1-based** 序号（`1 → B01`，`total_blocks → 最后一个 block`）
- `floor(...)`, `ceil(...)`: 常规取整；结果 < 1 时取 1
- `{1,2,3}` 表示一组 block_id（对应 target_count=3）
- **结果超界** (> total_blocks) → 钳到 `total_blocks - 1`（避开 closing_hook）
- **mini_climax 与 major_climax 重合** → 该 mini_climax 删除（major 优先）
- **major_climax 与 closing_hook 重合** → major_climax 左移 1 个 block（`total_blocks - 2`）
- **total_blocks < 4**（极短剧）→ 降级：`mini_climaxes_target_count = 1`，`major_climax = total_blocks - 1`，`closing_hook = total_blocks`；若 total_blocks == 2 → major_climax = null，只留 golden_open + closing_hook

## 7 · `major_climax.strategy` 三选一判定规则

### 7.1 KVA `action_type` → `strategy` 映射表

| `strategy` 值 | 可由以下 KVA `action_type` 触发 | 或 beat 文本含关键词 |
|---|---|---|
| `identity_reveal` | `status_reveal` / `transformation` / `signature_entrance`（当附带身份信息时）| 身份 / 头衔 / 制服 / 工牌 / 真名 |
| `evidence_drop` | `evidence_drop` / `discovery_reveal` / `intimate_betrayal`（当承载"真相暴露"时）/ `confrontation_face` | 录音 / 文件 / 诊断书 / 伤痕 / 怀孕 / 亲子 / 真相 / 偷情 |
| `ability_visualized` | `ability_visualized` / `transformation`（当附带特效时）| 能力 / 觉醒 / 光效 / 特效 / 闪现 |

### 7.2 判定流程

1. 读取命中模板的 `major_climax_strategy_preference[]`（按偏好顺序）；
2. 在 `major_climax_slot` 指向的 block 的 KVA / structure_hints / beat 文本中按 §7.1 映射表寻找匹配证据；
3. 任一偏好匹配 → 取该 strategy；
4. 全部不匹配 → `strategy = null`（合法），`diagnosis.notice_msg_v6` 写 `major_climax_strategy_unresolved`；
5. **禁止**：因"模板要求有 major_climax"而硬造身份/证据/能力。

### 7.3 歧义处理

- 同一 block 同时触发 `evidence_drop` 和 `identity_reveal`（如 B09 "摸肚子=怀孕证据" 同时暗示"许倩真实身份"）→ 取 `major_climax_strategy_preference[0]`（偏好顺序优先）；
- 触发证据在 `rhythm_timeline.major_climax.block_id` 的**相邻 block**（±1）但不在本 block → 允许把 `major_climax.block_id` 微调到证据 block，并在 `diagnosis.notice_msg_v6` 写 `major_climax_slot_shifted`。

## 8 · `golden_open_3s.required_elements` 判定

当 `required == true` 时，首 block（block_index[0]）的 `beat_ledger` 或 KVA 必须含 `required_elements_any_of[]` 中任一；否则：
- 若首 block 的 `key_visual_actions[]` 为空 → `diagnosis.warnings[] += "golden_open_missing_signature"`；
- 仍允许输出，由 Director/Prompter 兜底。

## 9 · `info_density_contract` 的下游消费

- `min_info_points_per_5s`：Director 自检 Step 6 第 22 条；Prompter 铁律 17；
- `max_none_ratio`：Prompter `rhythm_density_check.none_ratio` 上限；
- `dialogue_char_per_second_max`：Director 按此对 `scriptChunk.segments[].dialogue_char_count` 做容量预估；若某 seg `char_count / shot_duration > max` → Director 在 `appendix.diagnostics.overlong_dialogue[]` 声明，并建议把 seg 拆到相邻 shot。
