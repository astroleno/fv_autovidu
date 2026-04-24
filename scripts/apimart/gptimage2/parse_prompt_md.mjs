/**
 * 从 `prompt.md` 中提取分镜项：每对 `shot` + `img_prompt` 构成一条记录。
 * 源文件常夹杂说明文字且 JSON 不合法，故使用正则按序扫描，不依赖 `JSON.parse`。
 */

/**
 * @typedef {{ shot: number, imgPrompt: string }} StoryboardShot
 */

/**
 * 匹配 `"shot": 数字` 与同一段中的 `"img_prompt": "..."`（img_prompt 内不含未转义双引号）。
 * @param {string} markdown
 * @returns {StoryboardShot[]}
 */
export function extractShotsFromPromptMarkdown(markdown) {
  /** @type {StoryboardShot[]} */
  const out = [];
  const re =
    /"shot"\s*:\s*(\d+)\s*,\s*"img_prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/gs;
  let m = re.exec(markdown);
  while (m !== null) {
    const shot = Number.parseInt(m[1], 10);
    const imgPrompt = m[2].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    if (Number.isFinite(shot) && imgPrompt.length > 0) {
      out.push({ shot, imgPrompt });
    }
    m = re.exec(markdown);
  }
  return out;
}
