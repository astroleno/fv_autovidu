/**
 * SD2 / Seedance 提示词规范摘要：优先读外部 `sd2官方提示词.md`，不存在则用内置兜底。
 */
import fs from 'fs';
import path from 'path';

/** 内置最小规范（与业务文档一致的核心约束，避免离线失败） */
const FALLBACK_SPEC = `
# Seedance 2.0 / SD2 提示词工程化要点（摘要）

## 八大核心要素
1. 精准主体（谁）
2. 动作细节（在干什么）
3. 场景环境（在哪）
4. 光影色调（氛围）
5. 镜头运镜（怎么拍，**同一时间片仅一种运镜**）
6. 视觉风格（画风）
7. 画质参数
8. 约束条件（防崩）

## 输出结构（三段式）
1. **全局基础设定**：用 @图N 声明参考图与角色对应关系；首尾帧约束写在此处。
2. **时间片分镜脚本**：按时间段写动作与单一运镜；@图N 后必须紧跟角色名或名词，防分词歧义。
3. **画质、风格与约束**：4K、面部稳定、无穿模等。

## 禁止
- 单独裸露无语义的 asset id；须通过 @图N 搭桥。
- @图N 后直接接方位词导致歧义（错误示例：@图2位于…）。
`;

/**
 * @param {string} repoRoot
 * @returns {string} 规范全文或摘要
 */
export function loadSd2SpecText(repoRoot) {
  const candidates = [
    path.join(
      repoRoot,
      '..',
      'feeling_video_prompt',
      'reference',
      'character_prompt',
      'youxi',
      'sd2官方提示词.md',
    ),
    path.join(repoRoot, 'docs', 'sd2官方提示词.md'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf8');
      }
    } catch {
      // ignore
    }
  }
  return FALLBACK_SPEC;
}

/**
 * 控制注入长度，避免 token 浪费。
 *
 * @param {string} full
 * @param {number} [maxChars]
 * @returns {string}
 */
export function truncateSpecForPrompt(full, maxChars = 12000) {
  if (full.length <= maxChars) {
    return full;
  }
  return `${full.slice(0, maxChars)}\n\n…（已截断，完整版见 sd2官方提示词.md）`;
}
