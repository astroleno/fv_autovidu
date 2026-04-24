# hook_strategies

<!-- 消费者：EditMap · 静态挂载（不走 injection_map）· v5.0 -->
<!-- 脱敏：通用编剧方法论本地化改写，不引用任何外部源 -->

## 目的

首 1-2 个 block 的开场钩子判定。短剧前 15 秒决定留存。EditMap 必须识别钩子类型并打 `routing.structural`；缺钩子 → `diagnosis.notes` 登记 `hook_missing` 让 Director 在分镜做强补救。

## 受控词表

- `routing.structural`（钩子相关值）：`hook_block / cold_open / concept_first`
- `psychology_plan[0].group = "hook"`（首 block 近似固定）
- `diagnosis.notes` 关键词：`hook_missing / hook_type_<id> / hook_15s_test_failed`

## 钩子核心任务

> 任务**不是交代背景**，而是**在观众还不知道故事是什么时让他们无法移开目光**。

底线：开场必须有可被摄影机拍出的视觉内容（图像 / 动作 / 声音）。

**钩子 ≠ 爆炸开场**——安静也可以是钩子（一个不安的画面、一个困惑的日常细节），只要让观众产生"怎么回事？"。

## 五种开场钩子策略

| # | 代号 | 适用 | 核心手法 |
|---|---|---|---|
| H1 | **日常任务展示** | 商业 / 类型片 | 用低风险日常任务展示主角能力 + 全片节奏 |
| H2 | **危机压力** | 动作 / 悬疑 | 立即把主角扔进高压处境 |
| H3 | **结果先行** | 悬念 / 反转 | 先呈现离奇结果，全片回答"怎么发生" |
| H4 | **风格化视听** | 文艺 / 情感 | 用独特视听语言锚定全片影像系统 |
| H5 | **日常裂缝** | 生活流 / 情感短剧 | 日常细节暗示角色裂缝（"一切正常但哪里不对"） |

短剧（SD2 常见）适合 H2 / H3 / H5；H1 / H4 多用于长片。可组合；EditMap 登记主要 1-2 种。

## 冷开场（cold_open）额外规则

独立冷开场 block（先行播放、片花后才进正片）：
- `routing.structural` 同时含 `hook_block` 和 `cold_open`
- `psychology_plan[].group = hook`，`effects` 含 `information_asymmetry / curiosity_gap`
- 冷开场**不计入** `satisfaction_points` 首次兑现

## 前 15 秒"生死测试"

短剧首 block 通常映射到前 3-6 秒。5 项自检（任一不过 → 记 `hook_15s_test_failed`）：

1. 第一画面有视觉冲击 / 悬念感？（不是场景交代）
2. 前 30 秒能产生具体疑问（"这是怎么回事？"）？
3. 开场**在交代状态的同时就在制造张力**？（不是先交代再开始）
4. 开场基调与全片一致？（商业片开场不能像文艺片）
5. 开场单独拿出来本身是一段精彩视听内容？

## 与 status_curve / dramatic_action 联动

- 首 block 必须有戏剧动作，但**结果可悬而未决**（观众不知主角赢没赢才会继续）
- `status_curve[0].delta_from_prev` 固定为 `stable`（v5 约定）
- `position` 可 `up / mid / down` 任一；为 `down` 必须搭"有反击潜力"的动作信号

## 反例

- ❌ 首 block 纯交代人物关系 / 世界观而无戏剧动作
- ❌ 把旁白介绍主角背景当钩子（违反视听化底线）
- ❌ 首 block `delta_from_prev` 写成 `up` / `down`（必须 `stable`）
- ❌ 多个 block 都标 `hook_block`（钩子仅在首 1-2 个 block）
- ❌ 钩子类型与全片基调冲突（悬疑剧却用"日常裂缝"开场）
