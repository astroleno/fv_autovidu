# v6 · KVA 正反例库（Director 知识切片）

> 条件注入 · 当 `scriptChunk.key_visual_actions.length > 0` 时注入，给 Director 兜底"如何把 KVA 兑现到 shot 画面描述"。
> 对应铁律：Director §A.2（§I.2.2 KVA 消费协议） + Prompter 铁律 13（KVA 可视化）。

---

## 0 · 通用原则

1. **1:1 消费**：P0 KVA 必须被至少 1 个 shot **在画面层**直接展现，不做语义替代。
2. **hint 命中**：shot 画面描述中要出现 `required_structure_hints[]` 中任一词的中文语义（不要求原词，但语义要在）。
3. **不得替代**：`forbidden_replacement[]` 枚举的"近似表达"一律禁止。

## 1 · 正例

### 1.1 `signature_entrance`（标志性登场）

```jsonc
{ "action_type": "signature_entrance",
  "summary": "一双高跟鞋出现，镜头逐渐上移",
  "required_structure_hints": ["low_angle","pan_up"],
  "forbidden_replacement": ["普通全景登场","面部直接特写"] }
```

✅ **正例 shot 描述**：
> "低角度仰拍，一双黑色高跟鞋踩在水磨石地面上，鞋跟敲击声清脆；镜头上移，停在女主腰间的白大褂下摆。"

命中元素：**低角度仰拍**（low_angle）✅ **镜头上移**（pan_up）✅ **高跟鞋**（summary 名词）✅

❌ **反例 shot 描述**：
> "女主走进走廊，面部特写，目光坚定。"

缺失：low_angle ❌ pan_up ❌ 高跟鞋 ❌（且命中了 forbidden: "面部直接特写"）

---

### 1.2 `evidence_drop`（证据抛出）

```jsonc
{ "action_type": "evidence_drop",
  "summary": "男主掏出录音笔，按下播放键",
  "required_structure_hints": ["close_up","slow_motion"],
  "forbidden_replacement": ["口述概述","黑屏转场"] }
```

✅ **正例 shot 描述**：
> "慢动作特写，男主右手将录音笔推入会议桌中央，拇指缓慢按下播放键，指示灯由灰转红。"

命中：**慢动作**（slow_motion）✅ **特写**（close_up）✅ **录音笔**（summary）✅

❌ **反例**："男主说'我有证据'"（命中 forbidden: 口述概述）

---

### 1.3 `ability_visualized`（能力可视化）

```jsonc
{ "action_type": "ability_visualized",
  "summary": "女主闭眼瞬间，听觉能力外化为声波涟漪",
  "required_structure_hints": ["close_up","sfx_visualization"],
  "forbidden_replacement": ["旁白解释","普通反应镜头"] }
```

✅ **正例**：
> "面部特写，女主缓慢闭眼；下一帧，以她耳部为中心扩散出淡蓝色声波涟漪，周围空间短暂失色。"

命中：**面部特写**（close_up）✅ **声波涟漪**（sfx_visualization）✅

---

### 1.4 `status_reveal`（身份揭示）

```jsonc
{ "action_type": "status_reveal",
  "summary": "男主胸前工牌翻转露出总裁头衔",
  "required_structure_hints": ["low_angle","close_up"],
  "forbidden_replacement": ["他人口述头衔","背景字幕"] }
```

✅ **正例**：
> "低角度仰拍，男主胸前工牌随动作翻面；特写，工牌底部三个字——"总裁"——刻字清晰。"

---

### 1.5 `split_screen_trigger`（分屏触发）

```jsonc
{ "action_type": "split_screen_trigger",
  "summary": "两条线同框：男主在审讯室 / 女主在走廊",
  "required_structure_hints": ["split_screen"],
  "forbidden_replacement": ["快速剪切交替","叠化转场"] }
```

✅ **正例**：
> "画面一分为二：左半边，男主坐在审讯室桌前，灯光冷蓝；右半边，女主在走廊快步行走，灯光冷白。两人神态同框对照。"

❌ **反例**：快速交替两个镜头（命中 forbidden: "快速剪切交替"）。

---

### 1.6 `freeze_frame_hook`（定格悬念）

```jsonc
{ "action_type": "freeze_frame_hook",
  "summary": "末 shot 画面定格于女主回头瞬间",
  "required_structure_hints": ["freeze_frame"],
  "forbidden_replacement": ["淡出黑场","缓推远"] }
```

✅ **正例**：
> "女主猛然回头，画面在她瞳孔反光瞬间**静止**——时间冻结，背景配乐戛然而止。"

命中：**画面静止 / 时间冻结**（freeze_frame）✅

---

## 2 · 混合例（KVA + 节奏锚点同 slot）

**场景**：本 block 同时是 `golden_open_3s` 且有 P0 KVA `signature_entrance`。

✅ **正例**（0–3s 两个 shot 合并消费）：
- shot 1（1.5s, `[A1]`, `info_delta: identity`）：低仰拍，高跟鞋特写 + 敲击声；
- shot 2（1.5s, `[A2]`, `info_delta: motion`）：镜头上移至女主面部半侧，眼神冷峻。

节奏锚（3s 黄金开场）✅ + KVA（signature_entrance）✅ + info_delta 连续 ✅

---

## 3 · 消费失败时的标注格式

若本 block 实在装不下某条 KVA：

```jsonc
"kva_consumption_report": [
  { "kva_id": "KVA_003", "consumed_at_shot": null,
    "priority": "P1",
    "deferred_to_block": "B02",
    "reason": "block B01 slot 已满（5 slot / 5 seg），P1 KVA 推迟到 B02" }
]
```

**注意**：P0 KVA **不允许** `consumed_at_shot == null`；若 payload 报出 P0 KVA 却没空间 → pipeline 上游责任，回报 EditMap 调整 `target_shot_count_range`。
